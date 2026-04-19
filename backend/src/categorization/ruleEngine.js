const db = require('../db/db');

async function applyRulesToTransactions(txIds) {
  const { rows: rules } = await db.query(
    'SELECT * FROM categorization_rules ORDER BY priority DESC, id ASC'
  );
  if (rules.length === 0 || txIds.length === 0) return { categorized: 0, counts: {} };

  const placeholders = txIds.map((_, i) => `$${i + 1}`).join(',');
  const { rows: transactions } = await db.query(
    `SELECT id, description, type FROM transactions WHERE id IN (${placeholders}) AND type = 'expense'`,
    txIds
  );

  let categorized = 0;
  const counts = {};

  for (const tx of transactions) {
    const desc = tx.description.toLowerCase();
    const matched = rules.find(r => desc.includes(r.keyword.toLowerCase()));
    if (matched) {
      await db.query(
        'UPDATE transactions SET category=$1, type=$2 WHERE id=$3',
        [matched.category, matched.type, tx.id]
      );
      counts[matched.category] = (counts[matched.category] || 0) + 1;
      categorized++;
    }
  }

  return { categorized, counts };
}

async function bulkCategorize(reapplyAll = false) {
  const { rows: rules } = await db.query(
    'SELECT * FROM categorization_rules ORDER BY priority DESC, id ASC'
  );
  if (rules.length === 0) return { categorized: 0, counts: {} };

  const whereClause = reapplyAll
    ? `WHERE type = 'expense'`
    : `WHERE type = 'expense' AND category = 'Other'`;

  const { rows: transactions } = await db.query(
    `SELECT id, description FROM transactions ${whereClause}`
  );

  let categorized = 0;
  const counts = {};

  for (const tx of transactions) {
    const desc = tx.description.toLowerCase();
    const matched = rules.find(r => desc.includes(r.keyword.toLowerCase()));
    if (matched) {
      await db.query(
        'UPDATE transactions SET category=$1, type=$2 WHERE id=$3',
        [matched.category, matched.type, tx.id]
      );
      counts[matched.category] = (counts[matched.category] || 0) + 1;
      categorized++;
    }
  }

  console.log(`[rules] Categorized ${categorized} transactions`);
  return { categorized, counts };
}

module.exports = { applyRulesToTransactions, bulkCategorize };
