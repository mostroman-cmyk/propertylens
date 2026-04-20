const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { predictAll, jaccardSimilarity } = require('../prediction/engine');
const { triggerLearnAsync, triggerFullRetrainAsync } = require('../prediction/learner');
const { learnPattern } = require('../matching/rentMatcher');

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
    // Log as a manual retrain event
    try {
      const H = result.counts.HIGH || 0, M = result.counts.MEDIUM || 0, L = result.counts.LOW || 0;
      await db.query(
        `INSERT INTO prediction_activity (event_type, tx_id, tx_desc, affected, high_count, medium_count, low_count)
         VALUES ('manual_retrain', NULL, 'Full re-train triggered manually', $1, $2, $3, $4)`,
        [result.total, H, M, L]
      );
    } catch {}
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recent learning activity log
router.get('/activity', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM prediction_activity ORDER BY created_at DESC LIMIT 30'
    );
    res.json(rows);
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
  const { category, property_id, tenant_id, property_scope } = req.body;
  try {
    const { rows } = await db.query('SELECT * FROM transactions WHERE id=$1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const tx = rows[0];

    const finalCategory   = category    ?? tx.predicted_category;
    const finalPropertyId = property_id !== undefined ? (property_id || null) : tx.predicted_property_id;
    const finalTenantId   = tenant_id   !== undefined ? (tenant_id   || null) : tx.predicted_tenant_id;
    const finalScope      = property_scope !== undefined ? property_scope : (tx.predicted_property_scope || 'single');
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
    // Background: learn payer pattern if a tenant was assigned, then re-predict similar
    if (finalTenantId) {
      learnPattern(parseInt(req.params.id), finalTenantId, tx.description).catch(() => {});
    }
    triggerLearnAsync(parseInt(req.params.id), 'accept');
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
    // Background: full retrain now that multiple transactions are classified
    if (result.rowCount > 0) triggerFullRetrainAsync('bulk_accept');
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
    if (result.rowCount > 0) triggerFullRetrainAsync('accept_all_high');
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Similar past classified transactions for a given normalized description
router.get('/similar-training', async (req, res) => {
  const { norm } = req.query;
  if (!norm) return res.status(400).json({ error: 'norm required' });
  try {
    const { rows } = await db.query(`
      SELECT tx.id, tx.date, tx.description, tx.display_description, tx.amount,
             tx.category, tx.property_id, tx.tenant_id,
             tx.normalized_description,
             p.name AS property_name, t.name AS tenant_name
      FROM transactions tx
      LEFT JOIN properties p ON tx.property_id = p.id
      LEFT JOIN tenants t ON tx.tenant_id = t.id
      WHERE tx.category NOT IN ('Other', 'Other Income')
        AND tx.normalized_description IS NOT NULL
      ORDER BY tx.date DESC
      LIMIT 500
    `);
    const scored = rows
      .map(r => ({ ...r, similarity: jaccardSimilarity(norm, r.normalized_description || '') }))
      .filter(r => r.similarity >= 0.50)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 10);
    res.json(scored);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Merchant patterns with inconsistent property/category assignments (for "Fix Misclassified" UI)
router.get('/misclassified-patterns', async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        tx.normalized_description,
        COUNT(*) AS count,
        COUNT(DISTINCT COALESCE(tx.property_id::text, 'null')) AS distinct_properties,
        COUNT(DISTINCT tx.category) AS distinct_categories,
        array_agg(DISTINCT p.name ORDER BY p.name) FILTER (WHERE p.name IS NOT NULL) AS properties,
        array_agg(DISTINCT tx.category ORDER BY tx.category) AS categories,
        MIN(tx.amount::numeric) AS min_amount,
        MAX(tx.amount::numeric) AS max_amount
      FROM transactions tx
      LEFT JOIN properties p ON tx.property_id = p.id
      WHERE tx.category NOT IN ('Other', 'Other Income')
        AND tx.normalized_description IS NOT NULL
        AND tx.normalized_description <> ''
      GROUP BY tx.normalized_description
      HAVING (
        COUNT(DISTINCT COALESCE(tx.property_id::text, 'null')) > 1
        OR COUNT(DISTINCT tx.category) > 1
      ) AND COUNT(*) >= 2
      ORDER BY COUNT(*) DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk fix: correct predictions for a group and optionally fix historical misclassifications
router.post('/bulk-fix', async (req, res) => {
  const { norm_key, category, property_id, property_scope, tenant_id, fix_historical, amount_filter, save_as_rule, rerun_predictions } = req.body;
  if (!norm_key) return res.status(400).json({ error: 'norm_key required' });

  const effectivePropId = property_scope === 'portfolio' ? null : (property_id || null);
  const effectiveScope  = property_scope || 'single';

  try {
    // Update all pending (unaccepted) predictions with this norm key
    let predQuery = `
      UPDATE transactions
      SET predicted_category=$1, predicted_property_id=$2, predicted_property_scope=$3, predicted_tenant_id=$4
      WHERE normalized_description=$5
        AND (prediction_accepted IS NULL OR prediction_accepted = false)
        AND prediction_confidence IS NOT NULL
    `;
    const predParams = [category || null, effectivePropId, effectiveScope, tenant_id || null, norm_key];

    if (amount_filter != null) {
      predQuery += ` AND ABS(ABS(amount::numeric) - $6) <= 2`;
      predParams.push(parseFloat(amount_filter));
    }

    const { rowCount: predUpdated } = await db.query(predQuery, predParams);

    let histUpdated = 0;
    if (fix_historical) {
      let histQuery = `
        UPDATE transactions
        SET category=$1, property_id=$2, property_scope=$3, tenant_id=$4
        WHERE normalized_description=$5
          AND (prediction_accepted = true OR (category NOT IN ('Other','Other Income')))
          AND (
            category IS DISTINCT FROM $1
            OR property_id IS DISTINCT FROM $2
            OR tenant_id IS DISTINCT FROM $4
          )
      `;
      const histParams = [category || null, effectivePropId, effectiveScope, tenant_id || null, norm_key];

      if (amount_filter != null) {
        histQuery += ` AND ABS(ABS(amount::numeric) - $6) <= 2`;
        histParams.push(parseFloat(amount_filter));
      }

      const { rowCount } = await db.query(histQuery, histParams);
      histUpdated = rowCount;
    }

    // Save as permanent merchant rule
    let ruleCreated = false;
    if (save_as_rule && norm_key) {
      const keyword = norm_key.split(' ').filter(w => w.length > 2).slice(0, 4).join(' ').toUpperCase() || norm_key.toUpperCase();
      await db.query(`
        INSERT INTO pattern_amount_rules (merchant_pattern, amount, amount_tolerance, category, property_id, property_scope, tenant_id, note)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        keyword,
        amount_filter != null ? parseFloat(amount_filter) : null,
        amount_filter != null ? 2 : null,
        category || null,
        effectivePropId,
        effectiveScope,
        tenant_id || null,
        `Auto-created via Fix Group for: ${norm_key}`,
      ]).catch(() => {}); // ignore duplicate errors
      ruleCreated = true;
    }

    res.json({ predictions_updated: predUpdated, historical_updated: histUpdated, rule_created: ruleCreated });

    // Background re-predict
    if (rerun_predictions || histUpdated > 0) {
      setImmediate(() => predictAll().catch(console.error));
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
