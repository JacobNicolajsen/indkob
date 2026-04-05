const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { recalculateShoppingList } = require('../shoppingHelper');

// GET /api/shoppinglist
router.get('/', (req, res) => {
  const items = db.prepare(
    'SELECT * FROM shopping_list ORDER BY shop_category, checked, name COLLATE NOCASE'
  ).all();
  res.json(items);
});

// GET /api/shoppinglist/library  — FØR /items
router.get('/library', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM custom_item_library ORDER BY shop_category, name COLLATE NOCASE'
  ).all());
});

// POST /api/shoppinglist/items — tilføj custom vare manuelt
router.post('/items', (req, res) => {
  const { name, amount, unit = '', shop_category = 'Andet' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Navn er påkrævet' });

  const info = db.prepare(
    "INSERT INTO shopping_list (name, amount, unit, shop_category, source) VALUES (?, ?, ?, ?, 'custom')"
  ).run(name.trim(), amount ?? null, unit, shop_category);

  // Gem i bibliotek til auto-komplet næste gang
  db.prepare(
    'INSERT OR IGNORE INTO custom_item_library (name, unit, shop_category) VALUES (?, ?, ?)'
  ).run(name.trim(), unit, shop_category);

  res.status(201).json({ id: info.lastInsertRowid });
});

// PUT /api/shoppinglist/items/:id — afkryds eller opdater
router.put('/items/:id', (req, res) => {
  const { checked, name, amount, unit, shop_category } = req.body;
  if (!db.prepare('SELECT id FROM shopping_list WHERE id = ?').get(req.params.id)) {
    return res.status(404).json({ error: 'Vare ikke fundet' });
  }

  if (typeof checked !== 'undefined') {
    db.prepare('UPDATE shopping_list SET checked = ? WHERE id = ?')
      .run(checked ? 1 : 0, req.params.id);
  } else {
    db.prepare(
      'UPDATE shopping_list SET name=?, amount=?, unit=?, shop_category=? WHERE id=?'
    ).run(name, amount ?? null, unit || '', shop_category || 'Andet', req.params.id);
  }
  res.json({ ok: true });
});

// DELETE /api/shoppinglist/items/:id
router.delete('/items/:id', (req, res) => {
  db.prepare('DELETE FROM shopping_list WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// DELETE /api/shoppinglist?only_checked=true|false
router.delete('/', (req, res) => {
  if (req.query.only_checked === 'true') {
    db.prepare('DELETE FROM shopping_list WHERE checked = 1').run();
  } else {
    db.prepare('DELETE FROM shopping_list').run();
  }
  res.json({ ok: true });
});

// POST /api/shoppinglist/recalculate — manuel genberegning (kan stadig bruges)
router.post('/recalculate', (req, res) => {
  try {
    recalculateShoppingList(db);
    const count = db.prepare("SELECT COUNT(*) as n FROM shopping_list WHERE source='recipe'").get().n;
    res.json({ ok: true, count });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Bibliotek ──────────────────────────────────────────────────────

router.post('/library', (req, res) => {
  const { name, unit = '', shop_category = 'Andet' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Navn er påkrævet' });
  try {
    const info = db.prepare(
      'INSERT INTO custom_item_library (name, unit, shop_category) VALUES (?, ?, ?)'
    ).run(name.trim(), unit, shop_category);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: 'Vare findes allerede i biblioteket' });
  }
});

router.delete('/library/:id', (req, res) => {
  db.prepare('DELETE FROM custom_item_library WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
