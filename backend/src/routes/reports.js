const express = require('express');
const router = express.Router();
const db = require('../db/db');

// GET /api/reports/property-pl?year=2026
router.get('/property-pl', async (req, res) => {
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const yearPrefix = `${year}-%`;

  try {
    const [settingsResult, propertiesResult, tenantsResult] = await Promise.all([
      db.query("SELECT value FROM settings WHERE key='portfolio_allocation'"),
      db.query('SELECT id, name FROM properties ORDER BY name'),
      db.query('SELECT id, property_id, monthly_rent FROM tenants'),
    ]);

    const allocationMethod = settingsResult.rows[0]?.value || 'equal';
    const properties = propertiesResult.rows;
    const tenants = tenantsResult.rows;
    const numProperties = properties.length;

    if (numProperties === 0) return res.json({ year, allocation_method: allocationMethod, properties: [], portfolio_expenses: 0 });

    // All transactions for this year
    const { rows: txs } = await db.query(`
      SELECT id, amount, type, property_id, property_scope
      FROM transactions
      WHERE date LIKE $1
    `, [yearPrefix]);

    const portfolioExpenses = txs
      .filter(t => t.type === 'expense' && t.property_scope === 'portfolio')
      .reduce((s, t) => s + Math.abs(parseFloat(t.amount)), 0);

    // Per-property income and specific expenses
    const propMap = {};
    for (const p of properties) {
      const propTenants = tenants.filter(t => t.property_id === p.id);
      propMap[p.id] = {
        id: p.id,
        name: p.name,
        income: 0,
        specific_expenses: 0,
        portfolio_allocated: 0,
        net: 0,
        tenant_count: propTenants.length,
        annual_rent: propTenants.reduce((s, t) => s + parseFloat(t.monthly_rent) * 12, 0),
      };
    }

    for (const tx of txs) {
      if (!tx.property_id || tx.property_scope === 'portfolio') continue;
      if (!propMap[tx.property_id]) continue;
      if (tx.type === 'income') propMap[tx.property_id].income += parseFloat(tx.amount);
      if (tx.type === 'expense') propMap[tx.property_id].specific_expenses += Math.abs(parseFloat(tx.amount));
    }

    // Allocate portfolio expenses
    if (allocationMethod !== 'unallocated' && portfolioExpenses > 0) {
      const totalIncome = Object.values(propMap).reduce((s, p) => s + p.income, 0);
      const totalTenants = Object.values(propMap).reduce((s, p) => s + p.tenant_count, 0);

      for (const p of Object.values(propMap)) {
        let share = 0;
        if (allocationMethod === 'equal') {
          share = portfolioExpenses / numProperties;
        } else if (allocationMethod === 'revenue_share') {
          share = totalIncome > 0 ? (p.income / totalIncome) * portfolioExpenses : portfolioExpenses / numProperties;
        } else if (allocationMethod === 'unit_count') {
          share = totalTenants > 0 ? (p.tenant_count / totalTenants) * portfolioExpenses : portfolioExpenses / numProperties;
        }
        p.portfolio_allocated = Math.round(share * 100) / 100;
      }
    }

    for (const p of Object.values(propMap)) {
      p.net = p.income - p.specific_expenses - p.portfolio_allocated;
    }

    res.json({
      year,
      allocation_method: allocationMethod,
      portfolio_expenses: Math.round(portfolioExpenses * 100) / 100,
      properties: Object.values(propMap),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
