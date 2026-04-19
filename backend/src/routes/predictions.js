const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { predictAll } = require('../prediction/engine');

const SELECT_PRED = `
  SELECT tx.*,
    tx.normalized_description,
    p.name  AS property_name,
    t.name  AS tenant_name,
    pp.name AS predicted_property_name,
    pt.name AS predicted_tenant_name
  FROM transactions tx
  LEFT JOIN properties  p  ON tx.property_id          = p.id
  LEFT JOIN tenants     t  ON tx.tenant_id             = t.id
  LEFT JOIN properties  pp ON tx.predicted_property_id = pp.id
  LEFT JOIN tenants     pt ON tx.predicted_tenant_id   = pt.id
`;

// Run prediction engine on all uncategorized transactions
router.post('/predict-all', async (req, res) => {
  try {
    const result = await predictAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// List all pending predictions (sorted HIGH → MEDIUM → LOW, then date desc)
router.get('/', async (req, res) => {
  try {
    const result = await db.query(
      SELECT_PRED + `
      WHERE tx.prediction_confidence IS NOT NULL
        AND (tx.prediction_accepted IS NULL OR tx.prediction_accepted = false)
      ORDER BY
        CASE tx.prediction_confidence WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        tx.date DESC
      `
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept a prediction — optionally override predicted values in body
router.post('/:id/accept', async (req, res) => {
  const { category, property_id, tenant_id } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM transactions WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const tx = rows[0];

    const finalCategory   = category    ?? tx.predicted_category;
    const finalPropertyId = property_id !== undefined ? (property_id || null) : tx.predicted_property_id;
    const finalTenantId   = tenant_id   !== undefined ? (tenant_id   || null) : tx.predicted_tenant_id;
    const finalScope      = tx.predicted_property_scope || 'single';
    const effectivePropertyId = finalScope === 'portfolio' ? null : finalPropertyId;

    await db.query(`
      UPDATE transactions
      SET category=$1, property_id=$2, tenant_id=$3, property_scope=$4,
          match_confidence = CASE WHEN $3::integer IS NOT NULL THEN 'exact' ELSE match_confidence END,
          needs_review = false, prediction_accepted=true
      WHERE id=$5
    `, [finalCategory, effectivePropertyId, finalTenantId, finalScope, req.params.id]);

    const result = await db.query(SELECT_PRED + ' WHERE tx.id=$1', [req.params.id]);
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reject a prediction — clear all prediction fields
router.post('/:id/reject', async (req, res) => {
  try {
    await db.query(`
      UPDATE transactions
      SET predicted_category=NULL, predicted_property_id=NULL, predicted_tenant_id=NULL,
          prediction_confidence=NULL, prediction_reasoning=NULL, prediction_accepted=false
      WHERE id=$1
    `, [req.params.id]);
    res.json({ id: parseInt(req.params.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-accept a list of prediction IDs
router.post('/bulk-accept', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids required' });
  try {
    const result = await db.query(`
      UPDATE transactions
      SET category = COALESCE(predicted_category, category),
          property_id = CASE WHEN predicted_property_scope = 'portfolio' THEN NULL ELSE COALESCE(predicted_property_id, property_id) END,
          tenant_id = COALESCE(predicted_tenant_id, tenant_id),
          property_scope = COALESCE(predicted_property_scope, property_scope, 'single'),
          match_confidence = CASE WHEN predicted_tenant_id IS NOT NULL THEN 'exact' ELSE match_confidence END,
          needs_review = false, prediction_accepted = true
      WHERE id = ANY($1::int[])
        AND (prediction_accepted IS NULL OR prediction_accepted = false)
      RETURNING id
    `, [ids]);
    res.json({ accepted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk-accept all HIGH confidence predictions
router.post('/accept-all-high', async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE transactions
      SET category = COALESCE(predicted_category, category),
          property_id = COALESCE(predicted_property_id, property_id),
          tenant_id = COALESCE(predicted_tenant_id, tenant_id),
          match_confidence = CASE WHEN predicted_tenant_id IS NOT NULL THEN 'exact' ELSE match_confidence END,
          needs_review = false, prediction_accepted = true
      WHERE prediction_confidence = 'HIGH'
        AND (prediction_accepted IS NULL OR prediction_accepted = false)
      RETURNING id
    `);
    res.json({ accepted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
