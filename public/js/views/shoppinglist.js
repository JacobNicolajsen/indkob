import { shoppinglist as api, products as productsApi, bilkatogo as bilkaApi, settings as settingsApi } from '../api.js';
import { openSheet, closeSheet, toast, setTopActions, printHtml } from '../app.js';
import { UNITS } from '../constants.js';

// ── Gigya browser-auth via server-session + JSONP ─────────────────
// Gigya blokerer: SDK (forkert domæne), fetch (CORS), server (403007).
// Løsning: server henter session-token (virker) → browser kalder
// accounts.getJWT via JSONP <script>-tag som bypasser CORS.
const GIGYA_KEY = '3_tA6BbV434FQqN73HnUG1KA3qFv8KiG4OqLu9eWPh7sKRqRizH5Vfv5Larmgrb4I2';

async function gigyaBrowserAuth() {
  // Trin 1: Server logger ind og returnerer session-token
  const r = await fetch('/api/bilkatogo/get-session', { method: 'POST' });
  const { sessionToken, error } = await r.json();
  if (error) throw new Error(error);

  // Trin 2: accounts.getJWT via JSONP (omgår CORS og 403007)
  return new Promise((resolve, reject) => {
    const cb = `_gc${Date.now()}`;
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      script.remove(); delete window[cb];
      reject(new Error('Gigya getJWT JSONP timeout'));
    }, 15000);
    window[cb] = (data) => {
      clearTimeout(timer); script.remove(); delete window[cb];
      if (data.errorCode === 0 && data.id_token) resolve(data.id_token);
      else reject(new Error(`Gigya getJWT (${data.errorCode}): ${data.errorMessage}`));
    };
    const params = new URLSearchParams({
      apiKey: GIGYA_KEY, format: 'json',
      fields: 'profile.email,profile.firstName',
      oauth_token: sessionToken, callback: cb,
    });
    script.src = `https://accounts.eu1.gigya.com/accounts.getJWT?${params}`;
    script.onerror = () => { clearTimeout(timer); reject(new Error('JSONP script fejlede')); };
    document.head.appendChild(script);
  });
}

const SHOP_CATEGORIES = [
  'Frugt & Grønt', 'Kød & Fisk', 'Mejeri & Æg', 'Brød & Bageri',
  'Kolonial', 'Frost', 'Drikkevarer', 'Husholdning', 'Andet'
];

const CAT_ICONS = {
  'Frugt & Grønt': '🥕', 'Kød & Fisk': '🥩', 'Mejeri & Æg': '🥛',
  'Brød & Bageri': '🍞', 'Kolonial': '🥫', 'Frost': '❄️',
  'Drikkevarer': '🍺', 'Husholdning': '🧴', 'Andet': '📦'
};

let items = [];

export async function renderShoppinglist(container) {
  container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--ink-muted)">Henter indkøbsliste…</div>';

  setTopActions(`
    <button class="top-action" id="btn-bilka"      title="Send til BilkaToGo">🛒</button>
    <button class="top-action" id="btn-shop-print" title="Print indkøbsliste">🖨️</button>
    <button class="top-action" id="btn-shop-menu"  title="Muligheder">⋯</button>
  `);

  try {
    items = await api.list();
  } catch (e) {
    container.innerHTML = `<div class="card" style="color:red">${e.message}</div>`;
    return;
  }

  renderList(container);

  document.getElementById('btn-bilka')?.addEventListener('click', () => {
    showBilkaSheet(container);
  });
  document.getElementById('btn-shop-print')?.addEventListener('click', () => {
    printShoppingList();
  });
  document.getElementById('btn-shop-menu')?.addEventListener('click', () => {
    showMenu(container);
  });
}

function renderList(container) {
  container.innerHTML = '';

  if (items.length === 0) {
    container.innerHTML = `
      <div style="text-align:center;padding:60px 20px;color:var(--ink-muted)">
        <div style="font-size:3.5rem;margin-bottom:16px">🛒</div>
        <div style="font-weight:600;font-size:1.05rem;margin-bottom:6px">Indkøbslisten er tom</div>
        <div style="font-size:0.9rem">Generer fra madplanen eller tilføj varer manuelt</div>
      </div>`;
  } else {
    // Gruppér
    const groups = {};
    for (const item of items) {
      const cat = item.shop_category || 'Andet';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(item);
    }

    const unchecked = items.filter(i => !i.checked).length;
    const summary = document.createElement('div');
    summary.style.cssText = 'padding:12px 16px 4px;font-size:0.85rem;color:#6B7280';
    summary.textContent = `${unchecked} af ${items.length} varer mangler`;
    container.appendChild(summary);

    for (const cat of SHOP_CATEGORIES) {
      if (!groups[cat]) continue;
      const section = document.createElement('div');
      section.innerHTML = `<div class="section-header">${CAT_ICONS[cat] || '📦'} ${cat}</div>`;

      const listEl = document.createElement('div');
      listEl.style.cssText = 'background:#fff;border-radius:12px;margin:0 16px 8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)';

      for (const item of groups[cat]) {
        listEl.appendChild(buildShopItem(item, container));
      }

      section.appendChild(listEl);
      container.appendChild(section);
    }
  }

  // FAB — tilføj vare
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Tilføj vare';
  fab.textContent = '+';
  fab.addEventListener('click', () => openAddItemSheet(container));
  container.appendChild(fab);

  // Bund-padding
  const spacer = document.createElement('div');
  spacer.style.height = '80px';
  container.appendChild(spacer);
}

function buildShopItem(item, container) {
  const el = document.createElement('div');
  el.className = `shop-item ${item.checked ? 'checked' : ''}`;
  el.dataset.id = item.id;

  const amountText = item.amount
    ? `${Number(item.amount) % 1 === 0 ? item.amount : item.amount} ${item.unit || ''}`.trim()
    : item.unit || '';

  // Kilde-labels (hvilke retter + datoer)
  let sourcesHtml = '';
  if (item.source === 'recipe' && item.sources) {
    try {
      const srcs = typeof item.sources === 'string' ? JSON.parse(item.sources) : item.sources;
      if (srcs?.length) {
        const DAY = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
        const labels = srcs.map(s => {
          const d   = new Date(s.date + 'T00:00:00');
          const day = DAY[d.getDay()];
          const dt  = d.toLocaleDateString('da-DK', { day:'numeric', month:'numeric' });
          return `${s.recipe_name} · ${day} ${dt}`;
        });
        sourcesHtml = `<span class="shop-sources">${labels.join(' &nbsp;·&nbsp; ')}</span>`;
      }
    } catch { /* ignorer parse-fejl */ }
  }

  el.innerHTML = `
    <div class="shop-check" title="Marker"></div>
    <div class="shop-name-wrap">
      <span class="shop-name">${item.name}</span>
      ${sourcesHtml}
    </div>
    ${amountText ? `<span class="shop-amount">${amountText}</span>` : ''}
    <button class="shop-delete" title="Fjern">🗑</button>
  `;

  el.querySelector('.shop-check').addEventListener('click', async (e) => {
    e.stopPropagation();
    const newVal = !item.checked;
    item.checked = newVal;
    el.classList.toggle('checked', newVal);
    try {
      await api.toggleCheck(item.id, newVal);
    } catch { item.checked = !newVal; el.classList.toggle('checked', !newVal); }
  });

  el.querySelector('.shop-delete').addEventListener('click', async (e) => {
    e.stopPropagation();
    await api.deleteItem(item.id);
    items = items.filter(i => i.id !== item.id);
    renderList(container);
  });

  return el;
}

function openAddItemSheet(container) {
  const frag = document.createElement('div');

  const catOptions = SHOP_CATEGORIES.map(c =>
    `<option value="${c}">${CAT_ICONS[c]} ${c}</option>`
  ).join('');

  frag.innerHTML = `
    <div class="form-group">
      <label class="form-label">Varenavn *</label>
      <input class="form-input" id="item-name" placeholder="fx Mælk" autocomplete="off">
      <div id="item-suggestions" style="margin-top:4px"></div>
    </div>
    <div style="display:flex;gap:10px">
      <div class="form-group" style="flex:1">
        <label class="form-label">Mængde</label>
        <input class="form-input" id="item-amount" type="number" step="any" placeholder="2">
      </div>
      <div class="form-group" style="flex:1">
        <label class="form-label">Enhed</label>
        <input class="form-input" id="item-unit" placeholder="stk / L / kg">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Kategori</label>
      <select class="form-select" id="item-category">${catOptions}</select>
    </div>
    <button class="btn btn-primary btn-full" id="btn-add-item">Tilføj vare</button>
    <div style="height:12px"></div>
  `;

  openSheet('Tilføj vare', frag);

  // Auto-komplet fra produktkatalog
  let suggestTimeout;
  frag.querySelector('#item-name').addEventListener('input', e => {
    clearTimeout(suggestTimeout);
    const q = e.target.value.trim();
    const sugg = frag.querySelector('#item-suggestions');
    if (!q) { sugg.innerHTML = ''; return; }

    suggestTimeout = setTimeout(async () => {
      let matches = [];
      try { matches = await productsApi.list({ search: q }); } catch { return; }
      matches = matches.slice(0, 6);
      sugg.innerHTML = matches.map(m =>
        `<div class="list-item" style="border-radius:8px;padding:10px 12px;font-size:0.9rem"
              data-name="${m.name}" data-unit="${m.default_unit}" data-cat="${m.shop_category}">
          ${CAT_ICONS[m.shop_category] || '📦'} ${m.name}
          <span style="color:var(--ink-muted);font-size:0.8rem">${m.default_unit}</span>
        </div>`
      ).join('');

      sugg.querySelectorAll('.list-item').forEach(el => {
        el.addEventListener('click', () => {
          frag.querySelector('#item-name').value = el.dataset.name;
          frag.querySelector('#item-unit').value = el.dataset.unit;
          const sel = frag.querySelector('#item-category');
          [...sel.options].forEach(o => { if (o.value === el.dataset.cat) o.selected = true; });
          sugg.innerHTML = '';
        });
      });
    }, 250);
  });

  frag.querySelector('#btn-add-item').addEventListener('click', async () => {
    const name = frag.querySelector('#item-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }
    try {
      const newItem = await api.addItem({
        name,
        amount:        parseFloat(frag.querySelector('#item-amount').value) || null,
        unit:          frag.querySelector('#item-unit').value.trim(),
        shop_category: frag.querySelector('#item-category').value,
      });
      items.push({
        id:            newItem.id,
        name,
        amount:        parseFloat(frag.querySelector('#item-amount').value) || null,
        unit:          frag.querySelector('#item-unit').value.trim(),
        shop_category: frag.querySelector('#item-category').value,
        checked:       false,
        source:        'custom'
      });
      closeSheet();
      renderList(container);
      toast(`${name} tilføjet`);
    } catch (e) {
      toast('Fejl: ' + e.message);
    }
  });
}

function showMenu(container) {
  const frag = document.createElement('div');
  frag.innerHTML = `
    <div style="padding-bottom:8px">
      <div class="list-item" id="m-clear-checked">
        <span style="font-size:1.3rem">✓</span>
        <div>
          <div style="font-weight:600">Fjern afkrydsede varer</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Beholder ikke-afkrydsede</div>
        </div>
      </div>
      <div class="list-item" id="m-clear-all" style="color:#B71C1C">
        <span style="font-size:1.3rem">🗑</span>
        <div>
          <div style="font-weight:600">Ryd hele listen</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Sletter alle varer</div>
        </div>
      </div>
      <div class="list-item" id="m-library">
        <span style="font-size:1.3rem">📚</span>
        <div>
          <div style="font-weight:600">Varebiblotek</div>
          <div style="font-size:0.8rem;color:var(--ink-muted)">Administrer faste varer</div>
        </div>
      </div>
    </div>
  `;

  openSheet('Indkøbsliste — muligheder', frag);

  frag.querySelector('#m-clear-checked').addEventListener('click', async () => {
    await api.clear(true);
    items = items.filter(i => !i.checked);
    closeSheet();
    renderList(container);
    toast('Afkrydsede varer fjernet');
  });

  frag.querySelector('#m-clear-all').addEventListener('click', async () => {
    if (!confirm('Ryd hele indkøbslisten?')) return;
    await api.clear(false);
    items = [];
    closeSheet();
    renderList(container);
    toast('Listen er ryddet');
  });

  frag.querySelector('#m-library').addEventListener('click', () => {
    closeSheet();
    openLibrarySheet(container);
  });
}

function printShoppingList() {
  if (items.length === 0) { toast('Indkøbslisten er tom'); return; }

  const groups = {};
  for (const item of items) {
    const cat = item.shop_category || 'Andet';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(item);
  }

  const activeCats = SHOP_CATEGORIES.filter(c => groups[c]);

  const makeCatHtml = cat => {
    const rowsHtml = groups[cat].map(item => {
      const amt = item.amount
        ? `${item.amount} ${item.unit || ''}`.trim()
        : (item.unit || '');
      return `<div class="item${item.checked ? ' done' : ''}">
        <span class="chk">${item.checked ? '☑' : '☐'}</span>
        <span class="nm">${item.name}</span>
        ${amt ? `<span class="am">${amt}</span>` : ''}
      </div>`;
    }).join('');
    return `<div class="cat">
      <div class="ch">${CAT_ICONS[cat] || '📦'} ${cat}</div>
      ${rowsHtml}
    </div>`;
  };

  // Split manuelt i to kolonner så iOS print-renderer respekterer layoutet
  const mid = Math.ceil(activeCats.length / 2);
  const leftHtml  = activeCats.slice(0, mid).map(makeCatHtml).join('');
  const rightHtml = activeCats.slice(mid).map(makeCatHtml).join('');

  const unchecked = items.filter(i => !i.checked).length;
  const dateStr   = new Date().toLocaleDateString('da-DK', { weekday:'long', day:'numeric', month:'long' });

  const html = `
<style>
*{box-sizing:border-box;margin:0;padding:0}
body,#print-overlay{font-family:Arial,Helvetica,sans-serif;color:#111;font-size:13px}
.pr-wrap{max-width:900px;margin:0 auto;padding:20px 24px}
h1{font-size:1.4rem;font-weight:700;margin-bottom:2px}
.sub{font-size:.85rem;color:#555;margin-bottom:16px}
.cols{display:table;width:100%;table-layout:fixed}.col{display:table-cell;width:50%;vertical-align:top;padding-right:20px}.col+.col{padding-right:0;padding-left:12px}
.cat{margin-bottom:16px;break-inside:avoid}
.ch{font-size:.75rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#555;margin-bottom:5px;padding-bottom:4px;border-bottom:2px solid #ccc}
.item{display:flex;align-items:baseline;gap:8px;padding:5px 0;border-bottom:1px solid #eee}
.chk{font-size:.95rem;flex-shrink:0;color:#444;width:16px}
.nm{flex:1;font-size:.92rem;line-height:1.3}
.am{font-size:.88rem;color:#444;font-weight:600;text-align:right;flex-shrink:0;white-space:nowrap}
.done .nm{text-decoration:line-through;opacity:.35}
.foot{margin-top:20px;font-size:.7rem;color:#aaa;border-top:1px solid #eee;padding-top:8px}
</style>
<div class="pr-wrap">
<h1>🛒 Indkøbsliste</h1>
<p class="sub">${unchecked} af ${items.length} varer mangler · ${dateStr}</p>
<div class="cols"><div class="col">${leftHtml}</div><div class="col">${rightHtml}</div></div>
<p class="foot">Udskrevet ${new Date().toLocaleDateString('da-DK', {weekday:'long',day:'numeric',month:'long',year:'numeric'})}</p>
</div>`;

  printHtml(html);
}

async function showBilkaSheet(container) {
  // Tjek eksisterende session
  let session = null;
  try { session = await bilkaApi.status(); } catch { /* ignorer */ }

  const frag = document.createElement('div');

  const renderContent = (state) => {
    if (state === 'filling') {
      frag.innerHTML = `
        <div style="text-align:center;padding:32px 16px">
          <div style="font-size:2.5rem;margin-bottom:12px">⏳</div>
          <div style="font-weight:600;font-size:1.05rem;margin-bottom:8px">Fylder kurven…</div>
          <div style="font-size:0.85rem;color:var(--ink-muted)">Søger og tilføjer varer til BilkaToGo</div>
        </div>`;
      return;
    }
    if (state === 'rolling') {
      frag.innerHTML = `
        <div style="text-align:center;padding:32px 16px">
          <div style="font-size:2.5rem;margin-bottom:12px">↩️</div>
          <div style="font-weight:600;font-size:1.05rem">Fortryder…</div>
        </div>`;
      return;
    }

    const hasSession = session?.rollback?.length > 0;
    const results    = session?.results || [];

    const rowsHtml = results.map(r => {
      if (r.status === 'tilføjet') {
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <span style="color:#22c55e;font-size:1.1rem">✓</span>
          <div style="flex:1">
            <div style="font-weight:500;font-size:0.9rem">${r.item}</div>
            <div style="font-size:0.78rem;color:var(--ink-muted)">${r.product}${r.brand ? ' · ' + r.brand : ''} — ${r.priceDKK} kr</div>
          </div>
          <span style="font-size:0.82rem;color:var(--ink-muted)">${r.qty} stk</span>
        </div>`;
      }
      const icon  = r.status === 'ikke_fundet' ? '🔍' : '⚠️';
      const label = r.status === 'ikke_fundet' ? 'Ikke fundet' : r.error || r.status;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:1.1rem">${icon}</span>
        <div style="flex:1">
          <div style="font-weight:500;font-size:0.9rem">${r.item}</div>
          <div style="font-size:0.78rem;color:var(--ink-muted)">${label}</div>
        </div>
      </div>`;
    }).join('');

    const sessionInfo = hasSession
      ? `<div style="background:#f0fdf4;border-radius:10px;padding:12px 14px;margin-bottom:14px;font-size:0.85rem">
           <span style="color:#16a34a;font-weight:600">✓ ${session.added} varer tilføjet</span>
           <span style="color:var(--ink-muted)"> · ${new Date(session.time).toLocaleString('da-DK', {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span>
         </div>`
      : '';

    frag.innerHTML = `
      ${sessionInfo}
      <button class="btn btn-primary" id="btn-bilka-fill" style="width:100%;margin-bottom:${hasSession ? '10px' : '16px'}">
        🛒 Fyld BilkaToGo-kurven
      </button>
      ${hasSession ? `<button class="btn" id="btn-bilka-rollback" style="width:100%;margin-bottom:16px;background:var(--surface-muted)">
        ↩️ Fortryd seneste fyldning (${session.rollback.length} varer)
      </button>` : ''}
      ${rowsHtml ? `<div style="font-weight:600;margin-bottom:8px;font-size:0.9rem">Seneste resultat</div>
      <div style="max-height:300px;overflow-y:auto">${rowsHtml}</div>` : ''}
      <div style="height:8px"></div>
    `;

    frag.querySelector('#btn-bilka-fill')?.addEventListener('click', async () => {
      renderContent('filling');
      try {
        // Hent credentials og autentificer via Gigya SDK i browseren
        const jwt = await gigyaBrowserAuth();
        const result = await bilkaApi.fill(jwt);
        session = await bilkaApi.status();
        renderContent('done');
        toast(`✓ ${result.added} varer tilføjet til BilkaToGo`);
      } catch (e) {
        renderContent('done');
        toast('Fejl: ' + e.message);
      }
    });

    frag.querySelector('#btn-bilka-rollback')?.addEventListener('click', async () => {
      renderContent('rolling');
      try {
        const result = await bilkaApi.rollback();
        session = null;
        renderContent('done');
        toast(`↩️ ${result.restored} varer fjernet fra kurven`);
      } catch (e) {
        renderContent('done');
        toast('Fejl: ' + e.message);
      }
    });
  };

  renderContent('done');
  openSheet('BilkaToGo', frag);
}

async function openLibrarySheet(container) {
  let library = [];
  try { library = await api.library.list(); } catch { library = []; }

  const frag = document.createElement('div');

  const renderLib = () => {
    const list = frag.querySelector('#lib-list');
    list.innerHTML = library.length === 0
      ? '<p style="color:var(--ink-muted);text-align:center;padding:16px">Biblioteket er tomt</p>'
      : library.map(item => `
          <div class="list-item" style="gap:10px">
            <span>${CAT_ICONS[item.shop_category] || '📦'}</span>
            <div style="flex:1">
              <div style="font-weight:500">${item.name}</div>
              <div style="font-size:0.8rem;color:var(--ink-muted)">${item.shop_category}${item.unit ? ' · ' + item.unit : ''}</div>
            </div>
            <button class="btn btn-sm btn-danger lib-del" data-id="${item.id}">✕</button>
          </div>`
        ).join('');

    list.querySelectorAll('.lib-del').forEach(btn => {
      btn.addEventListener('click', async () => {
        await api.library.delete(btn.dataset.id);
        library = library.filter(i => i.id != btn.dataset.id);
        renderLib();
      });
    });
  };

  const catOptions = SHOP_CATEGORIES.map(c =>
    `<option value="${c}">${CAT_ICONS[c]} ${c}</option>`
  ).join('');

  frag.innerHTML = `
    <div style="background:#f4f6f4;border-radius:12px;padding:14px;margin-bottom:12px">
      <div style="font-weight:600;margin-bottom:10px">Tilføj til bibliotek</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="form-input" id="lib-name" placeholder="Varenavn" style="flex:2;min-width:120px">
        <input class="form-input" id="lib-unit" placeholder="Enhed" style="flex:1;min-width:70px">
        <select class="form-select" id="lib-cat" style="flex:2;min-width:120px">${catOptions}</select>
        <button class="btn btn-primary" id="lib-add">Tilføj</button>
      </div>
    </div>
    <div id="lib-list"></div>
    <div style="height:12px"></div>
  `;

  openSheet('Varebiblotek', frag);
  renderLib();

  frag.querySelector('#lib-add').addEventListener('click', async () => {
    const name = frag.querySelector('#lib-name').value.trim();
    if (!name) { toast('Navn er påkrævet'); return; }
    try {
      await api.library.add({
        name,
        unit:          frag.querySelector('#lib-unit').value.trim(),
        shop_category: frag.querySelector('#lib-cat').value,
      });
      library = await api.library.list();
      frag.querySelector('#lib-name').value = '';
      frag.querySelector('#lib-unit').value = '';
      renderLib();
      toast(`${name} tilføjet til bibliotek`);
    } catch (e) {
      toast(e.message);
    }
  });
}
