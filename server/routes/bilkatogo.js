const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const db      = require('../db');

// ── Konstanter ────────────────────────────────────────────────────
const GIGYA_KEY    = '3_tA6BbV434FQqN73HnUG1KA3qFv8KiG4OqLu9eWPh7sKRqRizH5Vfv5Larmgrb4I2';
const GIGYA_BASE   = 'https://accounts.eu1.gigya.com';
const BILKA_BASE   = 'https://api.bilkatogo.dk';
const ALGOLIA_APP  = 'f9vbjlr1bk';
const ALGOLIA_KEY  = '1deaf41c87e729779f7695c00f190cc9';
const ALGOLIA_IDX  = 'prod_BILKATOGO_PRODUCTS';

// ── DB helpers ────────────────────────────────────────────────────
function getSetting(key) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? null;
}
function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(value));
}

// ── HMAC-SHA1 signering til Gigya REST API ────────────────────────
function gigyaSign(secret, url, params) {
  const nonce     = Date.now().toString() + Math.floor(Math.random() * 1e6);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const all       = { ...params, nonce, timestamp };
  const paramStr  = Object.keys(all).sort()
    .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join('&');
  const base = `POST&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  const key  = Buffer.from(secret, 'base64');
  const sig  = crypto.createHmac('sha1', key).update(base).digest('base64');
  return { ...all, sig };
}

// ── Gigya login → JWT (id_token) ──────────────────────────────────
async function gigyaLogin(email, password) {
  // Trin 1: accounts.login — bed om id_token direkte i svaret
  const loginRes = await fetch(`${GIGYA_BASE}/accounts.login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      loginID: email, password, apiKey: GIGYA_KEY, format: 'json',
      include: 'id_token,profile',
    }).toString()
  });
  const loginData = await loginRes.json();
  if (loginData.errorCode !== 0) throw new Error(`Gigya login: ${loginData.errorMessage || loginData.errorCode}`);

  // Hvis Gigya returnerer JWT direkte fra login — brug den
  if (loginData.id_token) return loginData.id_token;

  const si          = loginData.sessionInfo || {};
  const cookieValue = si.sessionToken || si.cookieValue;
  if (!cookieValue) throw new Error(`Gigya: intet token (sessionInfo keys: ${Object.keys(si).join(',')})`);

  // Trin 2: accounts.getJWT via EU1 FIDM-endpoint (producerer korrekt iss: fidm.eu1.gigya.com)
  // accounts.eu1.gigya.com/accounts.getJWT returnerer 403007 server-side,
  // men fidm.eu1.gigya.com er JWT-specifikt og har andre adgangskrav.
  const fidmUrl = 'https://fidm.eu1.gigya.com/accounts.getJWT';
  const jwtRes  = await fetch(fidmUrl, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie':       `glt_${GIGYA_KEY}=${cookieValue}`,
      'Origin':       'https://www.bilkatogo.dk',
      'Referer':      'https://www.bilkatogo.dk/',
      'User-Agent':   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
    body: new URLSearchParams({
      apiKey: GIGYA_KEY, format: 'json',
      fields: 'profile.email,profile.firstName',
      sdk: 'js_latest', targetEnv: 'jssdk',
    }).toString()
  });
  const jwtData = await jwtRes.json();
  if (jwtData.errorCode !== 0) throw new Error(`Gigya FIDM getJWT (${jwtData.errorCode}): ${jwtData.errorMessage}`);
  const jwt = jwtData.id_token;
  if (!jwt) throw new Error('Gigya FIDM getJWT returnerede intet id_token');
  return jwt;
}

// ── Bilka JWT-login → session cookie ─────────────────────────────
async function bilkaLogin(gigyaToken) {
  console.log('[bilka] token type:', typeof gigyaToken, '| length:', gigyaToken?.length, '| prefix:', gigyaToken?.slice(0, 30));

  const res = await fetch(`${BILKA_BASE}/api/auth/LoginJWT?u=w`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${gigyaToken}`,
      'Content-Type': 'application/json',
      'Origin':       'https://www.bilkatogo.dk',
      'Referer':      'https://www.bilkatogo.dk/',
      'User-Agent':   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    },
    body: JSON.stringify({ jwt_token: gigyaToken })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let claims = '';
    try {
      claims = Buffer.from(gigyaToken.split('.')[1], 'base64url').toString();
    } catch {}
    throw new Error(`Bilka LoginJWT fejlede: ${res.status} | JWT claims: ${claims} | Bilka: ${body.slice(0, 200)}`);
  }

  // Udpak session-cookies (name=value pairs)
  const rawCookies = res.headers.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')] : []);
  const cookie = rawCookies.map(c => c.split(';')[0].trim()).join('; ');
  if (!cookie) throw new Error('Ingen session-cookie fra Bilka');
  return cookie;
}

// ── Algolia-søgning — returnerer hits sorteret billigst først ─────
async function searchCheapest(query) {
  const res = await fetch(
    `https://${ALGOLIA_APP}-dsn.algolia.net/1/indexes/${ALGOLIA_IDX}/query`,
    {
      method: 'POST',
      headers: {
        'X-Algolia-Application-Id': ALGOLIA_APP,
        'X-Algolia-API-Key': ALGOLIA_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, hitsPerPage: 20 })
    }
  );
  if (!res.ok) throw new Error(`Algolia fejlede: ${res.status}`);
  const data = await res.json();
  return (data.hits || [])
    .filter(h => h.price > 0)
    .sort((a, b) => a.price - b.price);
}

// ── Ændre antal i kurv ────────────────────────────────────────────
async function changeLineCount(cookie, productId, count) {
  const url = `${BILKA_BASE}/api/shop/v6/ChangeLineCount?u=w&productId=${productId}&count=${count}&fullCart=0`;
  const res = await fetch(url, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`ChangeLineCount (${productId}) fejlede: ${res.status}`);
  return res.json().catch(() => ({}));
}

// ── Hent nuværende kurv ───────────────────────────────────────────
async function getCart(cookie) {
  const res = await fetch(
    `${BILKA_BASE}/api/shop/v6/Cart?u=w&extra=deliveryAddress,deliveryDate`,
    { headers: { Cookie: cookie } }
  );
  if (!res.ok) return { lines: [] };
  return res.json().catch(() => ({ lines: [] }));
}

// ─────────────────────────────────────────────────────────────────
// GET /api/bilkatogo/status
// ─────────────────────────────────────────────────────────────────
router.get('/status', (req, res) => {
  const raw = getSetting('bilkatogo_last_fill');
  res.json(raw ? JSON.parse(raw) : null);
});

// ─────────────────────────────────────────────────────────────────
// POST /api/bilkatogo/fill
// Fylder BilkaToGo-kurven med det billigste alternativ per vare
// ─────────────────────────────────────────────────────────────────
router.post('/fill', async (req, res) => {
  const email    = getSetting('bilkatogo_email');
  const password = getSetting('bilkatogo_password');
  if (!email || !password) {
    return res.status(400).json({ error: 'BilkaToGo login er ikke konfigureret under Mere.' });
  }

  // Hent kun ikke-afkrydsede varer
  const items = db.prepare(
    "SELECT * FROM shopping_list WHERE checked = 0 ORDER BY shop_category, name"
  ).all();
  if (items.length === 0) {
    return res.status(400).json({ error: 'Indkøbslisten er tom eller alle varer er afkrydset.' });
  }

  try {
    // 1. Autentificering
    const gigyaToken = await gigyaLogin(email, password);
    const cookie     = await bilkaLogin(gigyaToken);

    // 2. Snapshot af nuværende kurv (til rollback)
    const cart    = await getCart(cookie);
    const prevMap = {};
    for (const cat of cart.lines || []) {
      for (const grp of cat.lines || []) {
        for (const ol of grp.orderlines || []) {
          if (ol.product?.objectID) prevMap[ol.product.objectID] = ol.quantity || 0;
        }
      }
    }

    // 3. Søg og tilføj
    const results  = [];
    const rollback = [];

    for (const item of items) {
      let hits;
      try {
        hits = await searchCheapest(item.name);
      } catch (e) {
        results.push({ item: item.name, status: 'søgefejl', error: e.message });
        continue;
      }

      if (!hits.length) {
        results.push({ item: item.name, status: 'ikke_fundet' });
        continue;
      }

      const cheapest = hits[0];
      const qty      = item.unit === 'stk' && item.amount ? Math.ceil(item.amount) : 1;
      const newCount = (prevMap[cheapest.objectID] || 0) + qty;

      try {
        await changeLineCount(cookie, cheapest.objectID, newCount);
        rollback.push({
          productId: cheapest.objectID,
          name:      cheapest.name,
          prevCount: prevMap[cheapest.objectID] || 0
        });
        results.push({
          item:       item.name,
          status:     'tilføjet',
          product:    cheapest.name,
          brand:      cheapest.brand || '',
          priceDKK:   (cheapest.price / 100).toFixed(2),
          qty,
          objectID:   cheapest.objectID
        });
      } catch (e) {
        results.push({ item: item.name, status: 'kurv_fejl', error: e.message });
      }
    }

    // 4. Gem rollback-log
    const session = {
      time:     new Date().toISOString(),
      added:    rollback.length,
      rollback,
      results
    };
    setSetting('bilkatogo_last_fill', JSON.stringify(session));

    res.json({ ok: true, added: rollback.length, results });

  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────
// POST /api/bilkatogo/rollback
// Fortryder seneste fill — sætter alle tilføjede varer tilbage
// ─────────────────────────────────────────────────────────────────
router.post('/rollback', async (req, res) => {
  const raw = getSetting('bilkatogo_last_fill');
  if (!raw) return res.status(400).json({ error: 'Ingen tidligere session at fortryde.' });

  const session = JSON.parse(raw);
  if (!session.rollback?.length) return res.json({ ok: true, restored: 0 });

  const email    = getSetting('bilkatogo_email');
  const password = getSetting('bilkatogo_password');
  if (!email || !password) return res.status(400).json({ error: 'Login ikke konfigureret.' });

  try {
    const gigyaToken = await gigyaLogin(email, password);
    const cookie     = await bilkaLogin(gigyaToken);

    let restored = 0;
    for (const entry of session.rollback) {
      try {
        await changeLineCount(cookie, entry.productId, entry.prevCount);
        restored++;
      } catch { /* fortsæt */ }
    }

    // Ryd session
    setSetting('bilkatogo_last_fill', '');
    res.json({ ok: true, restored });

  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
