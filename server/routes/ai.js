const express   = require('express');
const router    = express.Router();
const db        = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

const VALID_UNITS = ['stk','g','kg','ml','dl','L','tsk','spsk','fed','bundt','dåse','pose','pakke','portion','knsp','sk'];
const VALID_SHOP  = ['Frugt & Grønt','Kød & Fisk','Mejeri & Æg','Brød & Bageri','Kolonial','Frost','Drikkevarer','Husholdning','Andet'];
const VALID_CAT   = ['Kød','Fjerkræ','Fisk','Vegetar','Pasta','Suppe','Salat','Tilbehør','Dessert','Morgenmad','Andet'];

// POST /api/ai/import-recipe  { url }
router.post('/import-recipe', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'url er påkrævet' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY er ikke sat på serveren' });
  }

  // ── 1. Hent siden ────────────────────────────────────────────────
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
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let parsed;
  try {
    const msg = await client.messages.create({
      model:      'claude-3-haiku-20240307',
      max_tokens: 4096,
      system: `Du er en præcis opskrifts-ekstraktor. Du returnerer KUN valid JSON — ingen markdown, ingen forklaring, ingen kommentarer.`,
      messages: [{
        role: 'user',
        content: `Udtræk opskriften fra denne tekst og returner præcis denne JSON-struktur:

{
  "name": "opskriftens navn på dansk",
  "description": "ALLE trin i fremgangsmåden som sammenhængende tekst — bevar nummerering og detaljer. Inkluder forberedelse, tilberedning og anretning.",
  "servings": 4,
  "category": "én af: Kød, Fjerkræ, Fisk, Vegetar, Pasta, Suppe, Salat, Tilbehør, Dessert, Morgenmad, Andet",
  "image": "ét enkelt passende emoji",
  "ingredients": [
    {
      "name": "ingrediensens navn på dansk — kort og simpelt som på butikshylde (fx 'Hakkede tomater' ikke 'Dåse med hakkede tomater')",
      "amount": 400,
      "unit": "én af: stk, g, kg, ml, dl, L, tsk, spsk, fed, bundt, dåse, pose, pakke, portion, knsp, sk",
      "shop_category": "én af: Frugt & Grønt, Kød & Fisk, Mejeri & Æg, Brød & Bageri, Kolonial, Frost, Drikkevarer, Husholdning, Andet"
    }
  ]
}

Regler:
- amount skal være et tal (eller null hvis ikke angivet)
- Brug metriske enheder (g, ml, dl, L) frem for udenlandske
- Oversæt ingrediensnavne til dansk hvis de er på andet sprog
- Bevar alle mål præcist som angivet i opskriften

Tekst fra siden:
${cleaned}`
      }],
    });

    const raw     = msg.content[0].text.trim();
    const jsonStr = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/, '').trim();
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    return res.status(500).json({ error: 'Kunne ikke analysere opskriften: ' + e.message });
  }

  // ── 3. Valider ───────────────────────────────────────────────────
  const name = parsed.name?.trim();
  if (!name) return res.status(422).json({ error: 'Ingen opskrift fundet på denne side' });

  const servings = Math.max(1, Math.min(50, parseInt(parsed.servings) || 4));
  const category = VALID_CAT.includes(parsed.category)  ? parsed.category  : 'Andet';
  const image    = parsed.image?.trim()                  || '🍽️';
  const desc     = parsed.description?.trim()            || '';

  // ── 4. Find eller opret produkter ───────────────────────────────
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
        // Parallel insert — hent den eksisterende
        product = db.prepare('SELECT id FROM products WHERE LOWER(name) = LOWER(?)').get(ingName);
      }
    }

    if (product) ingredientRows.push({ product_id: product.id, amount, unit });
  }

  // ── 5. Opret opskriften ──────────────────────────────────────────
  try {
    const result = db.prepare(
      'INSERT INTO recipes (name, description, servings, category, image) VALUES (?, ?, ?, ?, ?)'
    ).run(name, desc, servings, category, image);

    const recipeId = result.lastInsertRowid;

    const insertIng = db.prepare(
      'INSERT INTO recipe_ingredients (recipe_id, product_id, amount, unit) VALUES (?, ?, ?, ?)'
    );
    for (const ing of ingredientRows) {
      insertIng.run(recipeId, ing.product_id, ing.amount, ing.unit);
    }

    res.json({
      ok:               true,
      recipe_id:        recipeId,
      name,
      ingredients_count: ingredientRows.length,
      new_products:     newProducts,
    });
  } catch (e) {
    res.status(500).json({ error: 'Kunne ikke gemme opskriften: ' + e.message });
  }
});

module.exports = router;
