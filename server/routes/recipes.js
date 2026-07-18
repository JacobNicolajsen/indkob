const express = require('express');
const router  = express.Router();
const db      = require('../db');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const { recalculateShoppingList } = require('../shoppingHelper');

const uploadDir = path.join(__dirname, '../../public/uploads');

// GET /api/recipes?search=&category=
router.get('/', (req, res) => {
  const { search, category } = req.query;
  let query  = 'SELECT * FROM recipes WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (name LIKE ? OR description LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  query += ' ORDER BY name COLLATE NOCASE';

  res.json(db.prepare(query).all(...params));
});

// GET /api/recipes/categories/list  — skal stå FØR /:id
router.get('/categories/list', (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT category FROM recipes WHERE category != '' ORDER BY category"
  ).all();
  res.json(rows.map(r => r.category));
});

// GET /api/recipes/stats/usage — hvor ofte hver ret har været på madplanen
router.get('/stats/usage', (req, res) => {
  res.json(db.prepare(`
    SELECT recipe_id, COUNT(*) AS times, MAX(date) AS last_used
    FROM meal_plan GROUP BY recipe_id
  `).all());
});

// POST /api/recipes/upload-image  { image_base64, media_type }
// Gemmer et opskriftsbillede (klienten har allerede skaleret det ned)
router.post('/upload-image', (req, res) => {
  const { image_base64, media_type } = req.body;
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[media_type];
  if (!ext) return res.status(400).json({ error: 'Ugyldigt billedformat' });
  if (!image_base64 || typeof image_base64 !== 'string' || image_base64.length > 8_000_000) {
    return res.status(400).json({ error: 'Billedet mangler eller er for stort' });
  }

  try {
    fs.mkdirSync(uploadDir, { recursive: true });
    const name = 'r_' + crypto.randomBytes(8).toString('hex') + '.' + ext;
    fs.writeFileSync(path.join(uploadDir, name), Buffer.from(image_base64, 'base64'));
    res.status(201).json({ url: 'uploads/' + name });
  } catch (e) {
    res.status(500).json({ error: 'Kunne ikke gemme billedet: ' + e.message });
  }
});

// GET /api/recipes/:id  — inkl. ingredienser med produkt-info
router.get('/:id', (req, res) => {
  const recipe = db.prepare('SELECT * FROM recipes WHERE id = ?').get(req.params.id);
  if (!recipe) return res.status(404).json({ error: 'Opskrift ikke fundet' });

  recipe.ingredients = db.prepare(`
    SELECT ri.id, ri.amount, ri.unit,
           p.id AS product_id, p.name, p.shop_category, p.default_unit
    FROM recipe_ingredients ri
    JOIN products p ON p.id = ri.product_id
    WHERE ri.recipe_id = ?
    ORDER BY ri.id
  `).all(req.params.id);

  res.json(recipe);
});

// POST /api/recipes
router.post('/', (req, res) => {
  const { name, description = '', servings = 4, category = '', image = '', ingredients = [] } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Navn er påkrævet' });

  db.exec('BEGIN');
  try {
    const info = db.prepare(
      'INSERT INTO recipes (name, description, servings, category, image) VALUES (?, ?, ?, ?, ?)'
    ).run(name.trim(), description, servings, category, image);

    const recipeId  = info.lastInsertRowid;
    const insertIng = db.prepare(
      'INSERT INTO recipe_ingredients (recipe_id, product_id, amount, unit) VALUES (?, ?, ?, ?)'
    );

    for (const ing of ingredients) {
      if (!ing.product_id) continue;
      insertIng.run(recipeId, ing.product_id, ing.amount ?? null, ing.unit || '');
    }

    db.exec('COMMIT');
    res.status(201).json({ id: recipeId });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

// PUT /api/recipes/:id
router.put('/:id', (req, res) => {
  const { name, description, servings, category, image, ingredients } = req.body;
  if (!db.prepare('SELECT id FROM recipes WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Opskrift ikke fundet' });
  }

  db.exec('BEGIN');
  try {
    db.prepare(
      'UPDATE recipes SET name=?, description=?, servings=?, category=?, image=? WHERE id=?'
    ).run(name?.trim() || '', description ?? '', servings ?? 4, category ?? '', image ?? '', req.params.id);

    if (Array.isArray(ingredients)) {
      db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(req.params.id);
      const insertIng = db.prepare(
        'INSERT INTO recipe_ingredients (recipe_id, product_id, amount, unit) VALUES (?, ?, ?, ?)'
      );
      for (const ing of ingredients) {
        if (!ing.product_id) continue;
        insertIng.run(req.params.id, ing.product_id, ing.amount ?? null, ing.unit || '');
      }
    }

    db.exec('COMMIT');

    // Opskriften kan indgå i madplanen — genberegn indkøbslisten
    try { recalculateShoppingList(db); }
    catch (e) { console.warn('Shopping recalc:', e.message); }

    res.json({ ok: true });
  } catch (e) {
    db.exec('ROLLBACK');
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/recipes/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM recipes WHERE id = ?').run(req.params.id);

  // Sletning kaskaderer til madplanen — genberegn indkøbslisten
  try { recalculateShoppingList(db); }
  catch (e) { console.warn('Shopping recalc:', e.message); }

  res.json({ ok: true });
});

module.exports = router;
