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
    const { status } = req.query;
    let query = WITH_PROPERTY;
    const params = [];
    if (status) {
      query += ` WHERE (t.status = $1 OR ($1 = 'active' AND t.status IS NULL))`;
      params.push(status);
    }
    query += ' ORDER BY p.id, t.unit';
    const result = await db.query(query, params);
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
  const { property_id, name, unit, monthly_rent, bedrooms_bathrooms, status, lease_start_date, lease_end_date, notes } = req.body;
  if (!property_id || !name || !unit || monthly_rent == null)
    return res.status(400).json({ error: 'property_id, name, unit, monthly_rent are required' });
  try {
    const result = await db.query(
      `INSERT INTO tenants (property_id, name, unit, monthly_rent, bedrooms_bathrooms, status, lease_start_date, lease_end_date, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [property_id, name, unit, monthly_rent, bedrooms_bathrooms || null,
       status || 'active', lease_start_date || null, lease_end_date || null, notes || null]
    );
    const id = result.rows[0]?.id;
    const full = await db.query(WITH_PROPERTY + ' WHERE t.id = $1', [id]);
    res.status(201).json(full.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { property_id, name, unit, monthly_rent, bedrooms_bathrooms, status, lease_start_date, lease_end_date, notes } = req.body;
  if (!property_id || !name || !unit || monthly_rent == null)
    return res.status(400).json({ error: 'property_id, name, unit, monthly_rent are required' });
  try {
    await db.query(
      `UPDATE tenants SET property_id=$1, name=$2, unit=$3, monthly_rent=$4, bedrooms_bathrooms=$5,
       status=$6, lease_start_date=$7, lease_end_date=$8, notes=$9 WHERE id=$10`,
      [property_id, name, unit, monthly_rent, bedrooms_bathrooms || null,
       status || 'active', lease_start_date || null, lease_end_date || null, notes || null, req.params.id]
    );
    const full = await db.query(WITH_PROPERTY + ' WHERE t.id = $1', [req.params.id]);
    if (!full.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(full.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Alias management for tenant matching
router.get('/:id/aliases', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT id, alias, created_at FROM tenant_aliases WHERE tenant_id=$1 ORDER BY created_at',
      [req.params.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:id/aliases', async (req, res) => {
  const alias = (req.body.alias || '').trim().toLowerCase();
  if (!alias) return res.status(400).json({ error: 'alias is required' });
  try {
    const { rows } = await db.query(
      'INSERT INTO tenant_aliases (tenant_id, alias) VALUES ($1, $2) RETURNING *',
      [req.params.id, alias]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Alias already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/aliases/:aliasId', async (req, res) => {
  try {
    await db.query(
      'DELETE FROM tenant_aliases WHERE id=$1 AND tenant_id=$2',
      [req.params.aliasId, req.params.id]
    );
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
