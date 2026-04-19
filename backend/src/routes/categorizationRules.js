const express = require('express');
const router = express.Router();
const db = require('../db/db');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM categorization_rules ORDER BY priority DESC, keyword ASC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { keyword, category, type, priority, property_scope } = req.body;
  if (!keyword || !category || !type) return res.status(400).json({ error: 'keyword, category, and type are required' });
  try {
    const result = await db.query(
      'INSERT INTO categorization_rules (keyword, category, type, priority, property_scope) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [keyword.toUpperCase(), category, type, priority || 0, property_scope || 'single']
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM categorization_rules WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
