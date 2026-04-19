const db = require('../db/db');

async function backfillPropertyTenant() {
  // Pass 1: tenant_id set → derive property_id
  const pass1 = await db.query(`
    UPDATE transactions
    SET property_id = t.property_id
    FROM tenants t
    WHERE transactions.tenant_id = t.id
      AND transactions.property_id IS NULL
    RETURNING transactions.id
  `);
  console.log(`[backfill] Backfilled property from tenant: ${pass1.rowCount} transactions`);

  // Pass 2: income + property_id set + amount matches tenant in same property
  // If exactly 1 tenant matches → assign; if multiple → mark needs_review
  const pass2Single = await db.query(`
    WITH matches AS (
      SELECT tx.id, MIN(t.id) AS tenant_id
      FROM transactions tx
      JOIN tenants t ON t.property_id = tx.property_id
        AND t.monthly_rent = tx.amount
      WHERE tx.type = 'income'
        AND tx.tenant_id IS NULL
        AND tx.property_id IS NOT NULL
        AND tx.amount > 0
      GROUP BY tx.id
      HAVING COUNT(t.id) = 1
    )
    UPDATE transactions
    SET tenant_id = matches.tenant_id,
        match_confidence = 'exact',
        needs_review = false
    FROM matches
    WHERE transactions.id = matches.id
    RETURNING transactions.id
  `);
  console.log(`[backfill] Inferred tenant from property + amount: ${pass2Single.rowCount} transactions`);

  await db.query(`
    WITH matches AS (
      SELECT tx.id
      FROM transactions tx
      JOIN tenants t ON t.property_id = tx.property_id
        AND t.monthly_rent = tx.amount
      WHERE tx.type = 'income'
        AND tx.tenant_id IS NULL
        AND tx.property_id IS NOT NULL
        AND tx.amount > 0
      GROUP BY tx.id
      HAVING COUNT(t.id) > 1
    )
    UPDATE transactions SET needs_review = true
    FROM matches WHERE transactions.id = matches.id
  `);

  // Pass 3: income + no property_id + amount uniquely matches one tenant across all properties
  const pass3 = await db.query(`
    WITH matches AS (
      SELECT tx.id, MIN(t.id) AS tenant_id, MIN(t.property_id) AS property_id
      FROM transactions tx
      JOIN tenants t ON t.monthly_rent = tx.amount
      WHERE tx.type = 'income'
        AND tx.property_id IS NULL
        AND tx.amount > 0
      GROUP BY tx.id
      HAVING COUNT(t.id) = 1
    )
    UPDATE transactions
    SET tenant_id = matches.tenant_id,
        property_id = matches.property_id,
        match_confidence = 'exact',
        needs_review = false
    FROM matches
    WHERE transactions.id = matches.id
    RETURNING transactions.id
  `);
  console.log(`[backfill] Backfilled from unique rent amount: ${pass3.rowCount} transactions`);

  return {
    fromTenant:       pass1.rowCount,
    fromPropertyAmt:  pass2Single.rowCount,
    fromUniqueAmt:    pass3.rowCount,
  };
}

module.exports = { backfillPropertyTenant };
