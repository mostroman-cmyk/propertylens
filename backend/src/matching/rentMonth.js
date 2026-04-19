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

module.exports = { calculateRentMonth, recalculateRentMonths };
