const db = require('../db/db');
const { calculateRentMonth } = require('./rentMonth');

const RENT_TOLERANCE = 10;

function matchTransaction(tx, tenants) {
  const amount = parseFloat(tx.amount);
  const desc = (tx.description || '').toLowerCase();

  const candidates = tenants.filter(t =>
    Math.abs(parseFloat(t.monthly_rent) - amount) <= RENT_TOLERANCE
  );

  if (candidates.length === 0) {
    return { tenant_id: null, match_confidence: 'none', needs_review: false };
  }

  // Priority 1: amount match + tenant name in description
  const nameMatch = candidates.find(t => {
    const parts = t.name.toLowerCase().split(/\s+/).filter(p => p.length > 2);
    return parts.some(part => desc.includes(part));
  });
  if (nameMatch) {
    return { tenant_id: nameMatch.id, match_confidence: 'exact', needs_review: false };
  }

  // Priority 2: unambiguous amount match
  if (candidates.length === 1) {
    return { tenant_id: candidates[0].id, match_confidence: 'amount_only', needs_review: false };
  }

  // Priority 3: ambiguous
  return { tenant_id: null, match_confidence: 'ambiguous', needs_review: true };
}

async function autoMatchAll() {
  const { rows: tenants } = await db.query('SELECT id, name, monthly_rent FROM tenants');
  const { rows: transactions } = await db.query(`
    SELECT id, amount, description
    FROM transactions
    WHERE type = 'income' AND tenant_id IS NULL
  `);

  let exact = 0, amount_only = 0, ambiguous = 0, none = 0;

  for (const tx of transactions) {
    const result = matchTransaction(tx, tenants);
    let rent_month = null, needs_month_review = false;
    if (result.tenant_id) {
      ({ rent_month, needs_month_review } = calculateRentMonth(tx.date));
    }
    await db.query(
      `UPDATE transactions SET tenant_id=$1, match_confidence=$2, needs_review=$3, rent_month=$4, needs_month_review=$5 WHERE id=$6`,
      [result.tenant_id, result.match_confidence, result.needs_review, rent_month, needs_month_review, tx.id]
    );
    if (result.match_confidence === 'exact')       exact++;
    else if (result.match_confidence === 'amount_only') amount_only++;
    else if (result.match_confidence === 'ambiguous')   ambiguous++;
    else none++;
  }

  console.log(`[matcher] ${exact} exact, ${amount_only} amount-only, ${ambiguous} ambiguous, ${none} no-match`);
  return { exact, amount_only, ambiguous, none };
}

module.exports = { autoMatchAll, matchTransaction };
