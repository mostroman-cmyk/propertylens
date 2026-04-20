const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { normalizeCategory } = require('../utils/normalizeCategory');

router.get('/', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT r.*, p.name AS property_name, t.name AS tenant_name
      FROM pattern_amount_rules r
      LEFT JOIN properties p ON r.property_id = p.id
      LEFT JOIN tenants t ON r.tenant_id = t.id
      ORDER BY r.merchant_pattern, r.amount NULLS LAST
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { merchant_pattern, amount, amount_tolerance, category, property_id, property_scope, tenant_id, note } = req.body;
  if (!merchant_pattern || !merchant_pattern.trim()) {
    return res.status(400).json({ error: 'merchant_pattern required' });
  }
  try {
    const { rows } = await db.query(`
      INSERT INTO pattern_amount_rules
        (merchant_pattern, amount, amount_tolerance, category, property_id, property_scope, tenant_id, note)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      merchant_pattern.trim().toUpperCase(),
      amount != null && amount !== '' ? parseFloat(amount) : null,
      amount_tolerance != null && amount_tolerance !== '' ? parseFloat(amount_tolerance) : 2,
      normalizeCategory(category) || null,
      property_id || null,
      property_scope || 'single',
      tenant_id || null,
      note || null,
    ]);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { merchant_pattern, amount, amount_tolerance, category, property_id, property_scope, tenant_id, note } = req.body;
  try {
    const { rows } = await db.query(`
      UPDATE pattern_amount_rules
      SET merchant_pattern=$1, amount=$2, amount_tolerance=$3, category=$4,
          property_id=$5, property_scope=$6, tenant_id=$7, note=$8
      WHERE id=$9 RETURNING *
    `, [
      (merchant_pattern || '').trim().toUpperCase(),
      amount != null && amount !== '' ? parseFloat(amount) : null,
      amount_tolerance != null && amount_tolerance !== '' ? parseFloat(amount_tolerance) : 2,
      normalizeCategory(category) || null,
      property_id || null,
      property_scope || 'single',
      tenant_id || null,
      note || null,
      req.params.id,
    ]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM pattern_amount_rules WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
