const express = require('express');
const router = express.Router();
const db = require('../db/db');

function buildDateWhere(params, startDate, endDate, col = 'date') {
  let w = '';
  if (startDate) { params.push(startDate); w += ` AND ${col} >= $${params.length}`; }
  if (endDate)   { params.push(endDate);   w += ` AND ${col} <= $${params.length}`; }
  return w;
}

// GET /api/dashboard/cash-flow?startDate=&endDate=
router.get('/cash-flow', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    const dw = buildDateWhere(params, startDate, endDate);

    const [incomeRes, expRes] = await Promise.all([
      db.query(
        `SELECT COALESCE(SUM(amount),0) AS total, COUNT(*) AS count
         FROM transactions WHERE type='income'${dw}`,
        params
      ),
      db.query(
        `SELECT COALESCE(category,'Other') AS category,
                SUM(ABS(amount)) AS total, COUNT(*) AS count
         FROM transactions WHERE type='expense'${dw}
         GROUP BY COALESCE(category,'Other') ORDER BY total DESC`,
        params
      ),
    ]);

    const totalIncome = parseFloat(incomeRes.rows[0].total);
    let cats = expRes.rows.map(r => ({
      category: r.category,
      total: parseFloat(r.total),
      count: parseInt(r.count),
    }));

    const MAX_CAT = 7;
    if (cats.length > MAX_CAT) {
      const tail = cats.slice(MAX_CAT);
      cats = [
        ...cats.slice(0, MAX_CAT),
        {
          category: `Other (${tail.length} categories)`,
          total: tail.reduce((s, c) => s + c.total, 0),
          count: tail.reduce((s, c) => s + c.count, 0),
          isOther: true,
        },
      ];
    }

    const totalExpenses = cats.reduce((s, c) => s + c.total, 0);
    const netIncome = totalIncome - totalExpenses;

    res.json({ totalIncome, totalExpenses, netIncome, categories: cats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/expense-breakdown?startDate=&endDate=
router.get('/expense-breakdown', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const params = [];
    const dw = buildDateWhere(params, startDate, endDate);

    const result = await db.query(
      `SELECT COALESCE(category,'Other') AS category,
              SUM(ABS(amount)) AS total, COUNT(*) AS count
       FROM transactions WHERE type='expense'${dw}
       GROUP BY COALESCE(category,'Other') ORDER BY total DESC`,
      params
    );

    let rows = result.rows.map(r => ({
      category: r.category,
      total: parseFloat(r.total),
      count: parseInt(r.count),
    }));

    const totalExpenses = rows.reduce((s, r) => s + r.total, 0);
    const TOP_N = 5;

    if (rows.length > TOP_N) {
      const tail = rows.slice(TOP_N);
      rows = [
        ...rows.slice(0, TOP_N),
        {
          category: `Other (${tail.length})`,
          total: tail.reduce((s, c) => s + c.total, 0),
          count: tail.reduce((s, c) => s + c.count, 0),
          isOther: true,
        },
      ];
    }

    rows = rows.map(r => ({
      ...r,
      pct: totalExpenses > 0 ? Math.round((r.total / totalExpenses) * 100) : 0,
    }));

    res.json({ totalExpenses, categories: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/dashboard/anomalies?startDate=&endDate=
router.get('/anomalies', async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return res.json({ anomalies: [] });

    const anomalies = [];

    // ── Amount anomalies: merchant charges ±30% vs 6-month avg ───────────────
    const amountRows = await db.query(`
      WITH history AS (
        SELECT normalized_description,
               AVG(ABS(amount))  AS avg_amount,
               COUNT(*)          AS total_count
        FROM transactions
        WHERE type = 'expense'
          AND normalized_description IS NOT NULL
          AND ABS(amount) > 5
          AND date >= $1::date - INTERVAL '6 months'
          AND date <  $1::date
        GROUP BY normalized_description
        HAVING COUNT(*) >= 3
      ),
      recent AS (
        SELECT DISTINCT ON (normalized_description)
          id, date, description, display_description, normalized_description,
          ABS(amount) AS amount, category
        FROM transactions
        WHERE type = 'expense'
          AND date >= $1 AND date <= $2
          AND normalized_description IS NOT NULL
        ORDER BY normalized_description, date DESC
      )
      SELECT r.id, r.date, r.description, r.display_description, r.category,
             ROUND(r.amount::numeric, 2)        AS amount,
             ROUND(h.avg_amount::numeric, 2)    AS avg_amount,
             h.total_count,
             ROUND(((r.amount - h.avg_amount) / NULLIF(h.avg_amount,0) * 100)::numeric, 1) AS pct_diff
      FROM recent r
      JOIN history h ON r.normalized_description = h.normalized_description
      WHERE ABS(r.amount - h.avg_amount) / NULLIF(h.avg_amount,0) > 0.30
        AND ABS(r.amount - h.avg_amount) > 20
      ORDER BY ABS(r.amount - h.avg_amount) DESC
      LIMIT 3
    `, [startDate, endDate]);

    for (const row of amountRows.rows) {
      const pct = parseFloat(row.pct_diff);
      anomalies.push({
        type: 'amount',
        severity: Math.abs(parseFloat(row.amount) - parseFloat(row.avg_amount)),
        icon: pct > 0 ? '⚠' : '↓',
        title: `${row.display_description || row.description}: ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs avg`,
        description: `$${parseFloat(row.amount).toFixed(2)} charged — ${Math.abs(pct).toFixed(0)}% ${pct > 0 ? 'above' : 'below'} the ${row.total_count}-transaction average of $${parseFloat(row.avg_amount).toFixed(2)}`,
        transaction_id: row.id,
        category: row.category,
      });
    }

    // ── Category spikes: normalize period to monthly rate ─────────────────────
    const periodDays = Math.max(1, Math.ceil(
      (new Date(endDate) - new Date(startDate)) / 86400000
    ) + 1);

    const spikeRows = await db.query(`
      WITH period_cats AS (
        SELECT COALESCE(category,'Other') AS category,
               SUM(ABS(amount)) AS total, COUNT(*) AS cnt
        FROM transactions
        WHERE type = 'expense' AND date >= $1 AND date <= $2
        GROUP BY COALESCE(category,'Other')
      ),
      historical AS (
        SELECT COALESCE(category,'Other') AS category,
               SUM(ABS(amount))
                 / GREATEST(1, COUNT(DISTINCT DATE_TRUNC('month', date::date))) AS monthly_avg
        FROM transactions
        WHERE type = 'expense'
          AND date >= $1::date - INTERVAL '6 months'
          AND date <  $1::date
        GROUP BY COALESCE(category,'Other')
        HAVING COUNT(DISTINCT DATE_TRUNC('month', date::date)) >= 2
      )
      SELECT p.category, p.total AS period_total, p.cnt,
             h.monthly_avg,
             ROUND(
               (p.total::numeric / $3 * 30 / NULLIF(h.monthly_avg,0) * 100 - 100)
             ::numeric, 1) AS pct_above_avg
      FROM period_cats p
      JOIN historical h ON p.category = h.category
      WHERE (p.total::numeric / $3 * 30) > h.monthly_avg * 1.5
        AND (p.total::numeric / $3 * 30 - h.monthly_avg) > 50
      ORDER BY (p.total::numeric / $3 * 30 - h.monthly_avg) DESC
      LIMIT 3
    `, [startDate, endDate, periodDays]);

    for (const row of spikeRows.rows) {
      const pct = parseFloat(row.pct_above_avg);
      const monthlyRate = parseFloat(row.period_total) / periodDays * 30;
      anomalies.push({
        type: 'category_spike',
        severity: parseFloat(row.period_total) - parseFloat(row.monthly_avg) / 30 * periodDays,
        icon: '⚠',
        title: `${row.category} spike: +${Math.round(pct)}% above average`,
        description: `$${parseFloat(row.period_total).toFixed(0)} this period (~$${monthlyRate.toFixed(0)}/mo) vs typical $${parseFloat(row.monthly_avg).toFixed(0)}/mo`,
        category: row.category,
      });
    }

    // ── New merchant detection ─────────────────────────────────────────────────
    const newMerchantRows = await db.query(`
      SELECT DISTINCT ON (t.normalized_description)
        t.id, t.date, t.description, t.display_description,
        ABS(t.amount) AS amount, t.category
      FROM transactions t
      WHERE t.date >= $1 AND t.date <= $2
        AND t.type = 'expense'
        AND t.normalized_description IS NOT NULL
        AND ABS(t.amount) > 10
        AND NOT EXISTS (
          SELECT 1 FROM transactions t2
          WHERE t2.normalized_description = t.normalized_description
            AND t2.date < $1
        )
      ORDER BY t.normalized_description, ABS(t.amount) DESC
      LIMIT 3
    `, [startDate, endDate]);

    for (const row of newMerchantRows.rows) {
      anomalies.push({
        type: 'new_merchant',
        severity: parseFloat(row.amount) * 0.4,
        icon: '★',
        title: `New: ${row.display_description || row.description}`,
        description: `$${parseFloat(row.amount).toFixed(2)} on ${row.date} — first time this merchant appears`,
        transaction_id: row.id,
        category: row.category,
      });
    }

    // ── Rent payment amount anomalies ─────────────────────────────────────────
    const rentRows = await db.query(`
      WITH tenant_history AS (
        SELECT tenant_id,
               AVG(amount)  AS avg_amount,
               COUNT(*)     AS pay_count
        FROM transactions
        WHERE type = 'income'
          AND tenant_id IS NOT NULL
          AND date >= $1::date - INTERVAL '6 months'
          AND date <  $1::date
        GROUP BY tenant_id
        HAVING COUNT(*) >= 2
      )
      SELECT t.id, t.date, t.amount, tn.name AS tenant_name,
             ROUND(th.avg_amount::numeric, 2) AS avg_amount,
             ROUND(((t.amount - th.avg_amount) / NULLIF(th.avg_amount,0) * 100)::numeric, 1) AS pct_diff
      FROM transactions t
      JOIN tenant_history th ON t.tenant_id = th.tenant_id
      JOIN tenants tn         ON tn.id = t.tenant_id
      WHERE t.type = 'income'
        AND t.date >= $1 AND t.date <= $2
        AND ABS(t.amount - th.avg_amount) / NULLIF(th.avg_amount,0) > 0.08
        AND ABS(t.amount - th.avg_amount) > 50
      ORDER BY ABS(t.amount - th.avg_amount) DESC
      LIMIT 2
    `, [startDate, endDate]);

    for (const row of rentRows.rows) {
      const pct = parseFloat(row.pct_diff);
      anomalies.push({
        type: 'rent',
        severity: Math.abs(parseFloat(row.amount) - parseFloat(row.avg_amount)),
        icon: pct > 0 ? '↑' : '↓',
        title: `${row.tenant_name}: rent ${pct > 0 ? '+' : ''}${pct.toFixed(0)}% vs usual`,
        description: `Paid $${Math.abs(parseFloat(row.amount)).toFixed(0)} — $${Math.abs(parseFloat(row.amount) - parseFloat(row.avg_amount)).toFixed(0)} ${pct > 0 ? 'more' : 'less'} than usual ($${Math.abs(parseFloat(row.avg_amount)).toFixed(0)})`,
        transaction_id: row.id,
      });
    }

    anomalies.sort((a, b) => b.severity - a.severity);
    const top = anomalies.slice(0, 5).map(({ severity, ...rest }) => rest);
    res.json({ anomalies: top, total: anomalies.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
