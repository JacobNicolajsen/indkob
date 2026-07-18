const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const Anthropic = require('@anthropic-ai/sdk');
const { assertPublicHttpUrl } = require('../urlGuard');

const MODEL = 'claude-haiku-4-5-20251001';

const VALID_UNITS = ['stk','g','kg','ml','dl','L','tsk','spsk','fed','bundt','dåse','pose','pakke','portion','knsp','sk'];
const VALID_SHOP  = ['Frugt & Grønt','Kød & Fisk','Mejeri & Æg','Brød & Bageri','Kolonial','Frost','Drikkevarer','Husholdning','Andet'];
const VALID_CAT   = ['Kød','Fjerkræ','Fisk','Vegetar','Pasta','Suppe','Salat','Tilbehør','Dessert','Morgenmad','Andet'];

function getClient(res) {
  if (!process.env.ANTHROPIC_API_KEY) {
    res.status(500).json({ error: 'ANTHROPIC_API_KEY er ikke sat på serveren' });
    return null;
  }
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

/** Fjerner evt. markdown-hegn og parser JSON fra Claudes svar */
function parseJsonReply(msg) {
  const raw     = msg.content[0].text.trim();
  const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr);
}

const RECIPE_JSON_SPEC = `{
  "name": "opskriftens navn på dansk",
  "description": "ALLE trin i fremgangsmåden som sammenhængende tekst — bevar nummerering og detaljer. Inkluder forberedelse, tilberedning og anretning.",
  "servings": 4,
  "category": "én af: ${VALID_CAT.join(', ')}",
  "image": "ét enkelt passende emoji",
  "ingredients": [
    {
      "name": "ingrediensens navn på dansk — kort og simpelt som på butikshylde (fx 'Hakkede tomater' ikke 'Dåse med hakkede tomater')",
      "amount": 400,
      "unit": "én af: ${VALID_UNITS.join(', ')}",
      "shop_category": "én af: ${VALID_SHOP.join(', ')}"
    }
  ]
}

Regler:
- amount skal være et tal (eller null hvis ikke angivet)
- Brug metriske enheder (g, ml, dl, L) frem for udenlandske
- Oversæt ingrediensnavne til dansk hvis de er på andet sprog
- Bevar alle mål præcist som angivet i opskriften`;

/**
 * Validerer parsed opskrift, opretter manglende produkter og gemmer
 * opskrift + ingredienser i én transaktion.
 * Returnerer { status, body } klar til res.status(...).json(...).
 */
function saveParsedRecipe(parsed, sourceUrl) {
  const name = parsed.name?.trim();
  if (!name) return { status: 422, body: { error: 'Ingen opskrift fundet' } };

  const servings = Math.max(1, Math.min(50, parseInt(parsed.servings) || 4));
  const category = VALID_CAT.includes(parsed.category)  ? parsed.category  : 'Andet';
  const image    = parsed.image?.trim()                  || '🍽️';
  const desc     = parsed.description?.trim()            || '';

  // Find eller opret produkter
  const ingredientRows = [];
  const newProducts    = [];

  for (const ing of (parsed.ingredients || [])) {
    const ingName = ing.name?.trim();
    if (!ingName) continue;

    const unit    = VALID_UNITS.includes(ing.unit)    ? ing.unit    : 'stk';
    const shopCat = VALID_SHOP.includes(ing.shop_category) ? ing.shop_category : 'Andet';
    const amount  = typeof ing.amount === 'number' && !isNaN(ing.amount) ? ing.amount : null;

    let product = db.prepare(
      'SELECT id FROM products WHERE LOWER(name) = LOWER(?)'
    ).get(ingName);

    if (!product) {
      const info = db.prepare(
        'INSERT OR IGNORE INTO products (name, default_unit, shop_category) VALUES (?, ?, ?)'
      ).run(ingName, unit, shopCat);

      if (info.changes > 0) {
        product = { id: info.lastInsertRowid };
        newProducts.push(ingName);
      } else {
        product = db.prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?)').get(ingName);
      }
    }

    if (product) ingredientRows.push({ product_id: product.id, amount, unit });
  }

  try {
    db.exec('BEGIN');
    let recipeId;
    try {
      const result = db.prepare(
        'INSERT INTO recipes (name, description, servings, category, image, source_url) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(name, desc, servings, category, image, sourceUrl || '');

      recipeId = result.lastInsertRowid;

      const insertIng = db.prepare(
        'INSERT INTO recipe_ingredients (recipe_id, product_id, amount, unit) VALUES (?, ?, ?, ?)'
      );
      for (const ing of ingredientRows) {
        insertIng.run(recipeId, ing.product_id, ing.amount, ing.unit);
      }
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }

    return { status: 200, body: {
      ok:                true,
      recipe_id:         recipeId,
      name,
      ingredients_count: ingredientRows.length,
      new_products:      newProducts,
    } };
  } catch (e) {
    return { status: 500, body: { error: 'Kunne ikke gemme opskriften: ' + e.message } };
  }
}

// GET /api/ai/models — vis tilgængelige modeller
router.get('/models', async (req, res) => {
  const client = getClient(res);
  if (!client) return;
  try {
    const list = await client.models.list();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/ai/import-recipe  { url }
router.post('/import-recipe', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url er påkrævet' });

  const client = getClient(res);
  if (!client) return;

  // ── 1. Hent siden ────────────────────────────────────────────────
  try {
    await assertPublicHttpUrl(url);
  } catch (e) {
    return res.status(422).json({ error: e.message });
  }

  let html;
  try {
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'da-DK,da;q=0.9,en;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    html = await r.text();
  } catch (e) {
    return res.status(422).json({ error: `Kunne ikke hente siden: ${e.message}` });
  }

  // Begræns størrelse og strip scripts/styles for at spare tokens
  const cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 60000);

  // ── 2. Claude parser opskriften ──────────────────────────────────
  let parsed;
  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system: `Du er en præcis opskrifts-ekstraktor. Du returnerer KUN valid JSON — ingen markdown, ingen forklaring, ingen kommentarer.`,
      messages: [{
        role: 'user',
        content: `Udtræk opskriften fra denne tekst og returner præcis denne JSON-struktur:\n\n${RECIPE_JSON_SPEC}\n\nTekst fra siden:\n${cleaned}`
      }],
    });
    parsed = parseJsonReply(msg);
  } catch (e) {
    return res.status(500).json({ error: 'Kunne ikke analysere opskriften: ' + e.message });
  }

  const { status, body } = saveParsedRecipe(parsed, url);
  res.status(status).json(body);
});

// POST /api/ai/import-recipe-photo  { image_base64, media_type }
router.post('/import-recipe-photo', async (req, res) => {
  const { image_base64, media_type } = req.body;
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(media_type)) {
    return res.status(400).json({ error: 'Ugyldigt billedformat' });
  }
  if (!image_base64 || typeof image_base64 !== 'string' || image_base64.length > 8_000_000) {
    return res.status(400).json({ error: 'Billedet mangler eller er for stort' });
  }

  const client = getClient(res);
  if (!client) return;

  let parsed;
  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: 4096,
      system: `Du er en præcis opskrifts-ekstraktor. Du returnerer KUN valid JSON — ingen markdown, ingen forklaring, ingen kommentarer.`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type, data: image_base64 } },
          { type: 'text', text: `Udtræk opskriften fra billedet (fx en kogebogsside eller håndskrevet opskrift) og returner præcis denne JSON-struktur:\n\n${RECIPE_JSON_SPEC}` },
        ],
      }],
    });
    parsed = parseJsonReply(msg);
  } catch (e) {
    return res.status(500).json({ error: 'Kunne ikke analysere billedet: ' + e.message });
  }

  const { status, body } = saveParsedRecipe(parsed, '');
  res.status(status).json(body);
});

// POST /api/ai/suggest-week  { dates: ["YYYY-MM-DD", ...] }
// Foreslår aftensmad til de angivne datoer ud fra kataloget og historikken.
router.post('/suggest-week', async (req, res) => {
  const { dates } = req.body;
  if (!Array.isArray(dates) || dates.length === 0 || dates.length > 7 ||
      !dates.every(d => /^\d{4}-\d{2}-\d{2}$/.test(d))) {
    return res.status(400).json({ error: 'dates skal være 1-7 datoer (YYYY-MM-DD)' });
  }

  const recipes = db.prepare('SELECT id, name, category, servings FROM recipes').all();
  if (recipes.length === 0) {
    return res.status(422).json({ error: 'Ingen opskrifter i kataloget endnu' });
  }

  const client = getClient(res);
  if (!client) return;

  // Historik: hvor ofte og hvornår retter senest er brugt
  const history = db.prepare(`
    SELECT recipe_id, COUNT(*) AS times, MAX(date) AS last_used
    FROM meal_plan WHERE meal_type = 'dinner'
    GROUP BY recipe_id
  `).all();
  const histById = {};
  for (const h of history) histById[h.recipe_id] = h;

  // Dagnoter for de ønskede datoer (kan indeholde hints som "travl dag")
  const notes = {};
  for (const d of dates) {
    const row = db.prepare('SELECT note FROM day_notes WHERE date = ?').get(d);
    if (row?.note?.trim()) notes[d] = row.note.trim().slice(0, 200);
  }

  const DAY_NAMES = ['søndag','mandag','tirsdag','onsdag','torsdag','fredag','lørdag'];
  const dateLines = dates.map(d => {
    const day = DAY_NAMES[new Date(d + 'T00:00:00').getDay()];
    return `- ${d} (${day})${notes[d] ? ` — note: "${notes[d]}"` : ''}`;
  }).join('\n');

  const recipeLines = recipes.map(r => {
    const h = histById[r.id];
    return `${r.id} | ${r.name} | ${r.category || 'Andet'}${h ? ` | brugt ${h.times}x, senest ${h.last_used}` : ' | aldrig brugt'}`;
  }).join('\n');

  let parsed;
  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      system: `Du er en madplans-assistent for en dansk familie. Du returnerer KUN valid JSON — ingen markdown, ingen forklaring.`,
      messages: [{
        role: 'user',
        content: `Vælg en aftensmadsret til hver af disse datoer:\n${dateLines}\n\nOpskriftskatalog (id | navn | kategori | historik):\n${recipeLines}\n\nRegler:\n- Variation: ikke samme kategori to dage i træk, og ikke samme ret to gange\n- Undgå retter brugt inden for de sidste 7 dage, hvis muligt\n- Favoritter (ofte brugt) må gerne indgå, men bland med variation\n- Tidskrævende retter passer bedst fredag/lørdag/søndag\n- Tag hensyn til dagnoter (fx "travl dag" = nem/hurtig ret)\n- Retter som "Rester", "Take away" o.l. må kun bruges hvis intet andet passer\n\nReturner præcis: [{"date": "YYYY-MM-DD", "recipe_id": 1, "reason": "kort begrundelse på dansk (maks 8 ord)"}]`
      }],
    });
    parsed = parseJsonReply(msg);
  } catch (e) {
    return res.status(500).json({ error: 'Kunne ikke lave forslag: ' + e.message });
  }

  const validIds = new Set(recipes.map(r => r.id));
  const seen     = new Set();
  const suggestions = (Array.isArray(parsed) ? parsed : [])
    .filter(s => dates.includes(s.date) && validIds.has(s.recipe_id) && !seen.has(s.date) && seen.add(s.date))
    .map(s => ({ date: s.date, recipe_id: s.recipe_id, reason: String(s.reason || '').slice(0, 120) }));

  if (suggestions.length === 0) {
    return res.status(500).json({ error: 'Fik ingen brugbare forslag — prøv igen' });
  }
  res.json({ suggestions });
});

// POST /api/ai/parse-items  { text }
// Oversætter fritekst ("2 L mælk og rugbrød") til indkøbsvarer.
router.post('/parse-items', async (req, res) => {
  const text = String(req.body.text || '').trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: 'text er påkrævet' });

  const client = getClient(res);
  if (!client) return;

  let parsed;
  try {
    const msg = await client.messages.create({
      model:      MODEL,
      max_tokens: 1500,
      system: `Du omdanner fritekst til indkøbsvarer. Du returnerer KUN valid JSON — ingen markdown, ingen forklaring.`,
      messages: [{
        role: 'user',
        content: `Opdel denne tekst i enkelte indkøbsvarer:\n"${text}"\n\nReturner præcis: [{"name": "varenavn på dansk, kort som på butikshylde", "amount": 2, "unit": "én af: ${VALID_UNITS.join(', ')} — eller tom streng", "shop_category": "én af: ${VALID_SHOP.join(', ')}"}]\n\nRegler:\n- amount er et tal eller null hvis ikke angivet\n- Gæt en fornuftig shop_category for hver vare`
      }],
    });
    parsed = parseJsonReply(msg);
  } catch (e) {
    return res.status(500).json({ error: 'Kunne ikke forstå teksten: ' + e.message });
  }

  const items = (Array.isArray(parsed) ? parsed : [])
    .filter(i => i.name?.trim())
    .slice(0, 30)
    .map(i => ({
      name:          String(i.name).trim().slice(0, 100),
      amount:        typeof i.amount === 'number' && !isNaN(i.amount) ? i.amount : null,
      unit:          VALID_UNITS.includes(i.unit) ? i.unit : '',
      shop_category: VALID_SHOP.includes(i.shop_category) ? i.shop_category : 'Andet',
    }));

  if (items.length === 0) {
    return res.status(422).json({ error: 'Fandt ingen varer i teksten' });
  }
  res.json({ items });
});

module.exports = router;
