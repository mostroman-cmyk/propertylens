const db = require('../db/db');

function calculateRentMonth(depositDate) {
  const d = new Date(depositDate + 'T12:00:00');
  const day = d.getDate();
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  let needs_month_review = false;

  if (day >= 25) {
    month += 1;
    if (month > 12) { month = 1; year += 1; }
  } else if (day >= 16) {
    needs_month_review = true;
  }

  return {
    rent_month: `${year}-${String(month).padStart(2, '0')}`,
    needs_month_review,
  };
}

// History-aware version: checks past 6 months of this tenant's confirmed payments.
// If the tenant consistently pays on the 20th+ and those payments were attributed to
// the FOLLOWING month, this payment gets the same treatment instead of flagging for review.
async function calculateRentMonthWithHistory(depositDate, tenantId) {
  if (!tenantId) return calculateRentMonth(depositDate);

  const { rows: history } = await db.query(`
    SELECT date, rent_month FROM transactions
    WHERE type = 'income'
      AND tenant_id = $1
      AND rent_month IS NOT NULL
      AND needs_month_review = false
    ORDER BY date DESC
    LIMIT 6
  `, [tenantId]);

  if (history.length < 2) return calculateRentMonth(depositDate);

  // Count payments where rent_month is the month AFTER the payment date month
  const advancedCount = history.filter(h => {
    const pd = new Date(h.date + 'T12:00:00');
    const payNum = pd.getFullYear() * 12 + pd.getMonth();
    const [ry, rm] = h.rent_month.split('-').map(Number);
    const rentNum = ry * 12 + (rm - 1);
    return rentNum > payNum;
  }).length;

  const advancedRatio = advancedCount / history.length;
  const avgDay = history.reduce((s, h) => s + new Date(h.date + 'T12:00:00').getDate(), 0) / history.length;
  const currentDay = new Date(depositDate + 'T12:00:00').getDate();

  // If this tenant historically pays early for next month (>=50% of history)
  // AND their avg pay day is on/after the 20th AND this payment is also on/after the 20th
  if (advancedRatio >= 0.5 && avgDay >= 20 && currentDay >= 20) {
    const d = new Date(depositDate + 'T12:00:00');
    let month = d.getMonth() + 2;
    let year = d.getFullYear();
    if (month > 12) { month = 1; year++; }
    return {
      rent_month: `${year}-${String(month).padStart(2, '0')}`,
      needs_month_review: false,
    };
  }

  return calculateRentMonth(depositDate);
}

async function recalculateRentMonths({ onlyNull = false } = {}) {
  const { rows } = await db.query(`
    SELECT id, date FROM transactions
    WHERE type = 'income' AND tenant_id IS NOT NULL
    ${onlyNull ? 'AND rent_month IS NULL' : ''}
  `);

  for (const tx of rows) {
    const { rent_month, needs_month_review } = calculateRentMonth(tx.date);
    await db.query(
      'UPDATE transactions SET rent_month=$1, needs_month_review=$2 WHERE id=$3',
      [rent_month, needs_month_review, tx.id]
    );
  }

  console.log(`[rentMonth] Recalculated ${rows.length} rent months (onlyNull=${onlyNull})`);
  return { updated: rows.length };
}

module.exports = { calculateRentMonth, calculateRentMonthWithHistory, recalculateRentMonths };
