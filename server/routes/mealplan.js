const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { recalculateShoppingList, addMealToShoppingList, removeMealFromShoppingList } = require('../shoppingHelper');

// GET /api/mealplan?from=YYYY-MM-DD&to=YYYY-MM-DD
router.get('/', (req, res) => {
  const { from, to } = req.query;
  let query  = `
    SELECT mp.*, r.name AS recipe_name, r.category, r.image
    FROM meal_plan mp
    JOIN recipes r ON r.id = mp.recipe_id
  `;
  const params = [];

  if (from && to) {
    query += ' WHERE mp.date BETWEEN ? AND ?';
    params.push(from, to);
  } else if (from) {
    query += ' WHERE mp.date >= ?';
    params.push(from);
  }
  query += ' ORDER BY mp.date, mp.meal_type';

  res.json(db.prepare(query).all(...params));
});

// POST /api/mealplan — tilføj eller erstat en slot
router.post('/', (req, res) => {
  const { date, meal_type, recipe_id, servings = 4 } = req.body;
  if (!date || !meal_type || !recipe_id) {
    return res.status(400).json({ error: 'date, meal_type og recipe_id er påkrævet' });
  }
  if (!['breakfast', 'lunch', 'dinner'].includes(meal_type)) {
    return res.status(400).json({ error: 'Ugyldig meal_type' });
  }
  if (!db.prepare('SELECT id FROM recipes WHERE id = ?').get(recipe_id)) {
    return res.status(404).json({ error: 'Opskrift ikke fundet' });
  }

  // Gem eksisterende slot INDEN upsert (bruges til at fjerne gammelt bidrag præcist)
  const existing = db.prepare('SELECT recipe_id, servings FROM meal_plan WHERE date = ? AND meal_type = ?').get(date, meal_type);

  db.prepare(`
    INSERT INTO meal_plan (date, meal_type, recipe_id, servings)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, meal_type)
    DO UPDATE SET recipe_id = excluded.recipe_id, servings = excluded.servings
  `).run(date, meal_type, recipe_id, servings);

  // ── Auto-opdater indkøbsliste (inkrementelt — ingen fuld genberegning) ──
  try {
    if (!existing) {
      // Ny slot — tilføj ingredienser
      addMealToShoppingList(db, date, meal_type, recipe_id, servings);
    } else if (existing.recipe_id !== recipe_id || existing.servings !== servings) {
      // Ret eller portioner ændret — fjern gammelt bidrag, tilføj nyt
      removeMealFromShoppingList(db, date, meal_type, existing.recipe_id, existing.servings);
      addMealToShoppingList(db, date, meal_type, recipe_id, servings);
    }
    // Samme ret + samme portioner → ingen ændring i indkøbslisten
  } catch (e) { console.warn('Shopping update:', e.message); }

  res.json({ ok: true });
});

// DELETE /api/mealplan/:id
router.delete('/:id', (req, res) => {
  const mp = db.prepare('SELECT date, meal_type, recipe_id, servings FROM meal_plan WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM meal_plan WHERE id = ?').run(req.params.id);
  if (mp) {
    try { removeMealFromShoppingList(db, mp.date, mp.meal_type, mp.recipe_id, mp.servings); }
    catch (e) { console.warn('Shopping remove:', e.message); }
  }
  res.json({ ok: true });
});

// DELETE /api/mealplan/slot/:date/:meal_type
router.delete('/slot/:date/:meal_type', (req, res) => {
  const mp = db.prepare('SELECT recipe_id, servings FROM meal_plan WHERE date = ? AND meal_type = ?')
    .get(req.params.date, req.params.meal_type);
  db.prepare('DELETE FROM meal_plan WHERE date = ? AND meal_type = ?')
    .run(req.params.date, req.params.meal_type);
  if (mp) {
    try { removeMealFromShoppingList(db, req.params.date, req.params.meal_type, mp.recipe_id, mp.servings); }
    catch (e) { console.warn('Shopping remove:', e.message); }
  }
  res.json({ ok: true });
});

module.exports = router;
