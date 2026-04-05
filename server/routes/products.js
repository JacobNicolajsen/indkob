const express = require('express');
const router  = express.Router();
const db      = require('../db');

// GET /api/products?search=
router.get('/', (req, res) => {
  const { search } = req.query;
  let query  = 'SELECT * FROM products WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND name LIKE ?';
    params.push(`%${search}%`);
  }
  query += ' ORDER BY shop_category, name COLLATE NOCASE';

  res.json(db.prepare(query).all(...params));
});

// GET /api/products/:id
router.get('/:id', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!product) return res.status(404).json({ error: 'Produkt ikke fundet' });
  res.json(product);
});

// POST /api/products
router.post('/', (req, res) => {
  const { name, default_unit = 'stk', shop_category = 'Andet' } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Navn er påkrævet' });

  try {
    const info = db.prepare(
      'INSERT INTO products (name, default_unit, shop_category) VALUES (?, ?, ?)'
    ).run(name.trim(), default_unit, shop_category);
    res.status(201).json({ id: info.lastInsertRowid });
  } catch {
    res.status(409).json({ error: `"${name}" findes allerede i kataloget` });
  }
});

// PUT /api/products/:id
router.put('/:id', (req, res) => {
  const { name, default_unit, shop_category } = req.body;
  const existing = db.prepare('SELECT id FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Produkt ikke fundet' });

  try {
    db.prepare(
      'UPDATE products SET name=?, default_unit=?, shop_category=? WHERE id=?'
    ).run(name?.trim() || '', default_unit || 'stk', shop_category || 'Andet', req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(409).json({ error: `"${name}" findes allerede i kataloget` });
  }
});

// DELETE /api/products/:id
router.delete('/:id', (req, res) => {
  const used = db.prepare(
    'SELECT COUNT(*) as n FROM recipe_ingredients WHERE product_id = ?'
  ).get(req.params.id);

  if (used.n > 0) {
    return res.status(409).json({
      error: `Produktet bruges i ${used.n} opskrift${used.n === 1 ? '' : 'er'} og kan ikke slettes`
    });
  }

  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
