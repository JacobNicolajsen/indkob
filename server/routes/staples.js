const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/staples
router.get('/', (req, res) => {
  res.json(db.prepare(
    'SELECT * FROM staple_items ORDER BY shop_category, name COLLATE NOCASE'
  ).all());
});

// POST /api/staples — opret ny basisvare
router.post('/', (req, res) => {
  const { name, amount, unit = '', shop_category = 'Andet' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Navn er påkrævet' });

  const info = db.prepare(
    'INSERT INTO staple_items (name, amount, unit, shop_category) VALUES (?, ?, ?, ?)'
  ).run(name.trim(), amount ?? null, unit, shop_category);

  res.status(201).json({ id: info.lastInsertRowid });
});

// DELETE /api/staples/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM staple_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/staples/add-to-list — tilføj alle (eller valgte) til indkøbslisten
router.post('/add-to-list', (req, res) => {
  const { ids } = req.body; // valgfrit: array af id'er; ellers alle
  const items = ids?.length
    ? db.prepare(`SELECT * FROM staple_items WHERE id IN (${ids.map(() => '?').join(',')})`)
        .all(...ids)
    : db.prepare('SELECT * FROM staple_items').all();

  const insert = db.prepare(
    "INSERT INTO shopping_list (name, amount, unit, shop_category, source) VALUES (?, ?, ?, ?, 'custom')"
  );
  const addedIds = [];
  db.exec('BEGIN');
  try {
    for (const item of items) {
      const info = insert.run(item.name, item.amount, item.unit, item.shop_category);
      addedIds.push(info.lastInsertRowid);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: e.message });
  }

  res.json({ ok: true, added: addedIds.length });
});

module.exports = router;
