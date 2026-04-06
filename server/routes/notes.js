const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/notes/:date
router.get('/:date', (req, res) => {
  const row = db.prepare('SELECT note FROM day_notes WHERE date = ?').get(req.params.date);
  res.json({ note: row?.note || '' });
});

// PUT /api/notes/:date
router.put('/:date', (req, res) => {
  const { note = '' } = req.body;
  db.prepare(
    'INSERT INTO day_notes (date, note) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET note = excluded.note'
  ).run(req.params.date, note);
  res.json({ ok: true });
});

module.exports = router;
