const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { autoMatchAll } = require('../matching/rentMatcher');
const { bulkCategorize } = require('../categorization/ruleEngine');
const { backfillPropertyTenant } = require('../matching/backfill');

const SELECT_TX = `
  SELECT tx.*, p.name AS property_name, t.name AS tenant_name
  FROM transactions tx
  LEFT JOIN properties p ON tx.property_id = p.id
  LEFT JOIN tenants t ON tx.tenant_id = t.id
`;

router.get('/', async (req, res) => {
  try {
    const result = await db.query(SELECT_TX + ' ORDER BY tx.date DESC, tx.id DESC');
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
    const result = await db.query(SELECT_TX + ' WHERE tx.id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Manually assign a tenant to a transaction; auto-fills property_id from tenant if not set
router.put('/:id/assign-tenant', async (req, res) => {
  const { tenant_id } = req.body;
  try {
    const confidence = tenant_id ? 'exact' : null;
    if (tenant_id) {
      await db.query(
        `UPDATE transactions
         SET tenant_id=$1, match_confidence=$2, needs_review=false,
             property_id = COALESCE(property_id, (SELECT property_id FROM tenants WHERE id = $1))
         WHERE id=$3`,
        [tenant_id, confidence, req.params.id]
      );
    } else {
      await db.query(
        'UPDATE transactions SET tenant_id=NULL, match_confidence=NULL, needs_review=false WHERE id=$1',
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

module.exports = router;
