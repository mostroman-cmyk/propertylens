const express = require('express');
const router = express.Router();
const db = require('../db/db');

router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT t.*, p.name AS property_name
      FROM transactions t
      LEFT JOIN properties p ON t.property_id = p.id
      ORDER BY t.date DESC, t.id DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { date, description, amount, type, category } = req.body;
  try {
    const result = await db.query(
      'INSERT INTO transactions (date, description, amount, type, category) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [date, description, amount, type, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { category, type, property_id } = req.body;
  if (!category || !type) return res.status(400).json({ error: 'category and type are required' });
  try {
    await db.query(
      'UPDATE transactions SET category=$1, type=$2, property_id=$3 WHERE id=$4',
      [category, type, property_id || null, req.params.id]
    );
    const result = await db.query(`
      SELECT t.*, p.name AS property_name
      FROM transactions t
      LEFT JOIN properties p ON t.property_id = p.id
      WHERE t.id = $1
    `, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
