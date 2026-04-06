const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/settings
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const obj  = {};
  for (const r of rows) obj[r.key] = r.value;
  res.json(obj);
});

// PUT /api/settings/:key
router.put('/:key', (req, res) => {
  const { value = '' } = req.body;
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(req.params.key, value);
  res.json({ ok: true });
});

module.exports = router;
