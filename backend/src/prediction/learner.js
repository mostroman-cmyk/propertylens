const db = require('../db/db');
const { predictAll, jaccardSimilarity } = require('./engine');

// Find how many unclassified transactions are similar to a given normalized description
async function countSimilarUnclassified(nd, type) {
  const { rows } = await db.query(`
    SELECT normalized_description
    FROM transactions
    WHERE category IN ('Other', 'Other Income')
      AND type = $1
      AND (prediction_accepted IS NULL OR prediction_accepted = false)
      AND normalized_description IS NOT NULL
  `, [type]);

  return rows.filter(r => jaccardSimilarity(nd, r.normalized_description) >= 0.80).length;
}

async function learnFromTransaction(txId, eventType = 'manual_classify') {
  const { rows: [tx] } = await db.query(
    'SELECT id, description, normalized_description, type, category FROM transactions WHERE id=$1',
    [txId]
  );

  if (!tx || !tx.normalized_description) return { affected: 0 };
  if (!tx.category || ['Other', 'Other Income'].includes(tx.category)) return { affected: 0 };

  const similarCount = await countSimilarUnclassified(tx.normalized_description, tx.type);

  console.log(
    `[learn] ${eventType} on tx ${txId} ('${tx.description}'). ` +
    `Re-predicting ${similarCount} similar unclassified transactions...`
  );

  const result = await predictAll();
  const H = result.counts.HIGH || 0;
  const M = result.counts.MEDIUM || 0;
  const L = result.counts.LOW || 0;

  console.log(`[learn] Updated predictions: ${H} HIGH, ${M} MEDIUM, ${L} LOW`);

  try {
    await db.query(`
      INSERT INTO prediction_activity
        (event_type, tx_id, tx_desc, affected, high_count, medium_count, low_count)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [eventType, txId, tx.description, similarCount, H, M, L]);
  } catch (err) {
    console.error('[learn] Failed to log activity:', err.message);
  }

  return { affected: similarCount, HIGH: H, MEDIUM: M, LOW: L };
}

// Fire-and-forget: called after any manual classification; does not block the response
function triggerLearnAsync(txId, eventType = 'manual_classify') {
  setImmediate(async () => {
    try {
      await learnFromTransaction(txId, eventType);
    } catch (err) {
      console.error(`[learn] Background re-predict failed for tx ${txId}:`, err.message);
    }
  });
}

// Full background retrain (used after bulk operations)
async function triggerFullRetrainAsync(eventType = 'bulk_accept') {
  setImmediate(async () => {
    try {
      console.log(`[learn] ${eventType} — running full re-predict...`);
      const result = await predictAll();
      const H = result.counts.HIGH || 0;
      const M = result.counts.MEDIUM || 0;
      const L = result.counts.LOW || 0;
      console.log(`[learn] Full re-predict complete: ${H} HIGH, ${M} MEDIUM, ${L} LOW`);
      await db.query(`
        INSERT INTO prediction_activity
          (event_type, tx_id, tx_desc, affected, high_count, medium_count, low_count)
        VALUES ($1, NULL, $2, $3, $4, $5, $6)
      `, [eventType, eventType, result.total, H, M, L]);
    } catch (err) {
      console.error('[learn] Full retrain failed:', err.message);
    }
  });
}

module.exports = { learnFromTransaction, triggerLearnAsync, triggerFullRetrainAsync };
