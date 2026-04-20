const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { autoMatchAll, learnPattern } = require('../matching/rentMatcher');
const { bulkCategorize } = require('../categorization/ruleEngine');
const { backfillPropertyTenant } = require('../matching/backfill');
const { calculateRentMonth, recalculateRentMonths } = require('../matching/rentMonth');
const { triggerLearnAsync } = require('../prediction/learner');

const SELECT_TX = `
  SELECT tx.*, p.name AS property_name, t.name AS tenant_name
  FROM transactions tx
  LEFT JOIN properties p ON tx.property_id = p.id
  LEFT JOIN tenants t ON tx.tenant_id = t.id
`;

router.get('/', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    let where = '';
    if (startDate) { params.push(startDate); where += ` AND tx.date >= $${params.length}`; }
    if (endDate)   { params.push(endDate);   where += ` AND tx.date <= $${params.length}`; }
    const result = await db.query(
      SELECT_TX + (where ? ' WHERE 1=1' + where : '') + ' ORDER BY tx.date DESC, tx.id DESC',
      params
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { date, description, amount, type, category } = req.body;
  try {
    const { normalizeDescription } = require('../prediction/engine');
    const result = await db.query(
      'INSERT INTO transactions (date, description, normalized_description, amount, type, category) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [date, description, normalizeDescription(description), amount, type, category]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  const { category, type, property_id, property_scope } = req.body;
  if (!category || !type) return res.status(400).json({ error: 'category and type are required' });
  const scope = property_scope || 'single';
  const effectivePropertyId = scope === 'portfolio' ? null : (property_id || null);
  try {
    await db.query(
      'UPDATE transactions SET category=$1, type=$2, property_id=$3, property_scope=$4 WHERE id=$5',
      [category, type, effectivePropertyId, scope, req.params.id]
    );
    const result = await db.query(SELECT_TX + ' WHERE tx.id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
    // Background: re-predict similar unclassified transactions using the new classification
    if (category && !['Other', 'Other Income'].includes(category)) {
      triggerLearnAsync(parseInt(req.params.id), 'manual_classify');
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually assign a tenant to a transaction; auto-fills property_id from tenant if not set
router.put('/:id/assign-tenant', async (req, res) => {
  const { tenant_id, learn_pattern } = req.body;
  try {
    const confidence = tenant_id ? 'exact' : null;
    if (tenant_id) {
      const { rows: [tx] } = await db.query('SELECT date FROM transactions WHERE id=$1', [req.params.id]);
      const { rent_month, needs_month_review } = calculateRentMonth(tx.date);
      await db.query(
        `UPDATE transactions
         SET tenant_id=$1, match_confidence=$2, needs_review=false,
             property_id = COALESCE(property_id, (SELECT property_id FROM tenants WHERE id = $1)),
             rent_month=$3, needs_month_review=$4
         WHERE id=$5`,
        [tenant_id, confidence, rent_month, needs_month_review, req.params.id]
      );
      if (learn_pattern) {
        await learnPattern(req.params.id, tenant_id);
      }
    } else {
      await db.query(
        'UPDATE transactions SET tenant_id=NULL, match_confidence=NULL, needs_review=false, rent_month=NULL, needs_month_review=false WHERE id=$1',
        [req.params.id]
      );
    }
    const result = await db.query(SELECT_TX + ' WHERE tx.id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Run rent auto-matching on all unmatched income transactions
router.post('/auto-match', async (req, res) => {
  try {
    const result = await autoMatchAll();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Backfill property_id and tenant_id via cross-inference
router.post('/backfill-property-tenant', async (req, res) => {
  try {
    const result = await backfillPropertyTenant();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Apply categorization rules to expense transactions
router.post('/bulk-categorize', async (req, res) => {
  try {
    const reapplyAll = req.body.reapply_all === true;
    const result = await bulkCategorize(reapplyAll);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Bulk update category/property/tenant for multiple transactions
router.post('/bulk-update', async (req, res) => {
  const { ids, category, property_id, tenant_id, clear } = req.body;
  if (!ids?.length) return res.status(400).json({ error: 'ids required' });
  try {
    if (clear) {
      await db.query(
        `UPDATE transactions SET category='Other', property_id=NULL, tenant_id=NULL, match_confidence=NULL, needs_review=false WHERE id = ANY($1::int[])`,
        [ids]
      );
    } else {
      const sets = [];
      const params = [ids];
      if (category    !== undefined) { params.push(category);          sets.push(`category=$${params.length}`);    }
      if (property_id !== undefined) { params.push(property_id||null); sets.push(`property_id=$${params.length}`); }
      if (tenant_id   !== undefined) { params.push(tenant_id||null);   sets.push(`tenant_id=$${params.length}`);   }
      if (!sets.length) return res.status(400).json({ error: 'Nothing to update' });
      await db.query(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ANY($1::int[])`, params);
    }
    res.json({ updated: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually override rent_month for a single transaction
router.put('/:id/rent-month', async (req, res) => {
  const { rent_month } = req.body;
  try {
    await db.query(
      'UPDATE transactions SET rent_month=$1, needs_month_review=false WHERE id=$2',
      [rent_month || null, req.params.id]
    );
    const result = await db.query(SELECT_TX + ' WHERE tx.id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reset all income transactions auto-assigned with low/medium confidence (amount_only or partial)
// so the user can manually review and confirm them
router.post('/reset-ambiguous-rent-matches', async (req, res) => {
  try {
    const result = await db.query(`
      UPDATE transactions
      SET tenant_id = NULL, property_id = NULL, needs_review = true,
          match_confidence = 'ambiguous', rent_month = NULL, needs_month_review = false
      WHERE type = 'income'
        AND tenant_id IS NOT NULL
        AND match_confidence IN ('amount_only', 'partial')
      RETURNING id
    `);
    res.json({ reset: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Recalculate rent_month for all matched income transactions
router.post('/recalculate-rent-months', async (req, res) => {
  try {
    const result = await recalculateRentMonths();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
