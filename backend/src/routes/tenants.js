const express = require('express');
const router = express.Router();
const db = require('../db/db');

const WITH_PROPERTY = `
  SELECT t.*, p.name AS property_name, p.address AS property_address
  FROM tenants t
  JOIN properties p ON t.property_id = p.id
`;

router.get('/', async (req, res) => {
  try {
    const result = await db.query(WITH_PROPERTY + ' ORDER BY p.id, t.unit');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/property/:propertyId', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT * FROM tenants WHERE property_id = $1 ORDER BY unit',
      [req.params.propertyId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { property_id, name, unit, monthly_rent, bedrooms_bathrooms } = req.body;
  if (!property_id || !name || !unit || monthly_rent == null)
    return res.status(400).json({ error: 'property_id, name, unit, monthly_rent are required' });
  try {
    const result = await db.query(
      'INSERT INTO tenants (property_id, name, unit, monthly_rent, bedrooms_bathrooms) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [property_id, name, unit, monthly_rent, bedrooms_bathrooms || null]
    );
    const id = result.rows[0]?.id;
    const full = await db.query(WITH_PROPERTY + ' WHERE t.id = $1', [id]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { property_id, name, unit, monthly_rent, bedrooms_bathrooms } = req.body;
  if (!property_id || !name || !unit || monthly_rent == null)
    return res.status(400).json({ error: 'property_id, name, unit, monthly_rent are required' });
  try {
    await db.query(
      'UPDATE tenants SET property_id=$1, name=$2, unit=$3, monthly_rent=$4, bedrooms_bathrooms=$5 WHERE id=$6',
      [property_id, name, unit, monthly_rent, bedrooms_bathrooms || null, req.params.id]
    );
    const full = await db.query(WITH_PROPERTY + ' WHERE t.id = $1', [req.params.id]);
    if (!full.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(full.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
