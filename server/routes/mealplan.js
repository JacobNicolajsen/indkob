const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { recalculateShoppingList, addMealToShoppingList } = require('../shoppingHelper');

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

  // Er slotten tom? → inkrementel tilføjelse. Ellers (replace/portioner) → fuld genberegning.
  const existing = db.prepare('SELECT recipe_id, servings FROM meal_plan WHERE date = ? AND meal_type = ?').get(date, meal_type);
  const isNewSlot = !existing;

  db.prepare(`
    INSERT INTO meal_plan (date, meal_type, recipe_id, servings)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(date, meal_type)
    DO UPDATE SET recipe_id = excluded.recipe_id, servings = excluded.servings
  `).run(date, meal_type, recipe_id, servings);

  // ── Auto-opdater indkøbsliste ──────────────────────────────────
  try {
    if (isNewSlot) {
      addMealToShoppingList(db, date, meal_type, recipe_id, servings);
    } else {
      recalculateShoppingList(db);
    }
  } catch (e) { console.warn('Shopping update:', e.message); }

  res.json({ ok: true });
});

// DELETE /api/mealplan/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM meal_plan WHERE id = ?').run(req.params.id);
  try { recalculateShoppingList(db); } catch (e) { console.warn('Shopping recalc:', e.message); }
  res.json({ ok: true });
});

// DELETE /api/mealplan/slot/:date/:meal_type
router.delete('/slot/:date/:meal_type', (req, res) => {
  db.prepare('DELETE FROM meal_plan WHERE date = ? AND meal_type = ?')
    .run(req.params.date, req.params.meal_type);
  try { recalculateShoppingList(db); } catch (e) { console.warn('Shopping recalc:', e.message); }
  res.json({ ok: true });
});

module.exports = router;
