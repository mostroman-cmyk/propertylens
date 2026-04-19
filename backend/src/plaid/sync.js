const plaidClient = require('./client');
const db = require('../db/db');
const { applyRulesToTransactions } = require('../categorization/ruleEngine');
const { autoMatchAll } = require('../matching/rentMatcher');
const { predictAll } = require('../prediction/engine');
const { backfillPropertyTenant } = require('../matching/backfill');

const RENT_TOLERANCE = 10;
const PRODUCT_NOT_READY_RETRIES = 5;
const PRODUCT_NOT_READY_DELAY_MS = 30_000;

function categorize(name, plaidCategory, plaidAmount) {
  const n = name.toLowerCase();
  const c = (plaidCategory || '').toLowerCase();

  if (/insurance/.test(n) || /insurance/.test(c))                                return { type: 'expense', category: 'Insurance' };
  if (/repair|plumb|handyman|contractor|hvac|roof|paint|drywall/.test(n))         return { type: 'expense', category: 'Repairs' };
  if (/home depot|lowe'?s|ace hardware|menards/.test(n))                          return { type: 'expense', category: 'Repairs' };
  if (/electric|gas\b|water\b|sewer|utility|utilities|pg&e|con\s?ed|national grid/.test(n) || c === 'utilities') return { type: 'expense', category: 'Utilities' };
  if (/lawn|landscap|snow|clean|janitor|trash|waste|pest/.test(n))                return { type: 'expense', category: 'Maintenance' };
  if (/mortgage|home loan/.test(n))                                               return { type: 'expense', category: 'Mortgage' };
  if (/property tax|tax/.test(n))                                                 return { type: 'expense', category: 'Taxes' };
  if (/hoa|homeowner.*assoc/.test(n))                                             return { type: 'expense', category: 'HOA' };

  return { type: 'expense', category: 'Other' };
}

function classifyTransaction(tx, rentAmounts) {
  const plaidAmount  = tx.amount;
  const storedAmount = -plaidAmount;

  if (plaidAmount < 0) {
    const depositAmt = Math.abs(plaidAmount);
    const isRent = rentAmounts.some(r => Math.abs(r - depositAmt) <= RENT_TOLERANCE);
    return { storedAmount, type: 'income', category: isRent ? 'rent' : 'Other Income' };
  }

  const { type, category } = categorize(tx.name, tx.personal_finance_category?.primary, plaidAmount);
  return { storedAmount, type, category };
}

async function callTransactionsSync(accessToken, cursor, enabledIds) {
  for (let attempt = 1; attempt <= PRODUCT_NOT_READY_RETRIES; attempt++) {
    try {
      const resp = await plaidClient.transactionsSync({
        access_token: accessToken,
        cursor: cursor || undefined,
        options: {
          include_personal_finance_category: true,
          account_ids: enabledIds,
        },
      });
      return resp.data;
    } catch (err) {
      const errorCode = err.response?.data?.error_code;
      if (errorCode === 'PRODUCT_NOT_READY' && attempt < PRODUCT_NOT_READY_RETRIES) {
        console.log(`[sync] PRODUCT_NOT_READY — waiting 30s (attempt ${attempt}/${PRODUCT_NOT_READY_RETRIES})...`);
        await new Promise(res => setTimeout(res, PRODUCT_NOT_READY_DELAY_MS));
      } else {
        throw err;
      }
    }
  }
}

// Sync a single connection. Returns { synced, skipped, modified, removed, newTxIds }
// or throws on error.
async function syncConnection(conn, rentAmounts, { forceFullSync = false } = {}) {
  const enabledIds = conn.enabled_account_ids;
  if (!enabledIds || enabledIds.length === 0) {
    return {
      synced: 0, skipped: 0, modified: 0, removed: 0, newTxIds: [],
      connectionError: {
        institution: conn.institution_name,
        error_code: 'NO_ACCOUNTS_SELECTED',
        error: `No accounts selected for ${conn.institution_name}. Open Account Settings and choose which accounts to sync.`,
      },
    };
  }

  let cursor = forceFullSync ? null : (conn.cursor || null);
  let batchNum = 0;
  let totalSynced = 0, totalSkipped = 0, totalModified = 0, totalRemoved = 0;
  const newTxIds = [];

  console.log(`[sync] ${conn.institution_name}: Starting sync (cursor=${cursor ? 'saved' : 'null — full history'})`);

  while (true) {
    batchNum++;
    const { added, modified, removed, has_more, next_cursor } = await callTransactionsSync(conn.access_token, cursor, enabledIds);

    console.log(`[sync] ${conn.institution_name} — Batch ${batchNum}: ${added.length} added, ${modified.length} modified, ${removed.length} removed, has_more=${has_more}`);

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      for (const tx of added) {
        if (tx.pending) { totalSkipped++; continue; }
        const { storedAmount, type, category } = classifyTransaction(tx, rentAmounts);
        const result = await client.query(
          `INSERT INTO transactions (date, description, amount, type, category, plaid_transaction_id, plaid_account_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (plaid_transaction_id) DO NOTHING
           RETURNING id`,
          [tx.date, tx.name, storedAmount, type, category, tx.transaction_id, tx.account_id]
        );
        if (result.rowCount > 0) { totalSynced++; newTxIds.push(result.rows[0].id); }
        else totalSkipped++;
      }

      for (const tx of modified) {
        if (tx.pending) continue;
        const { storedAmount, type, category } = classifyTransaction(tx, rentAmounts);
        const result = await client.query(
          `UPDATE transactions SET date=$1, description=$2, amount=$3, type=$4, category=$5, plaid_account_id=$6
           WHERE plaid_transaction_id=$7 AND property_id IS NULL AND tenant_id IS NULL`,
          [tx.date, tx.name, storedAmount, type, category, tx.account_id, tx.transaction_id]
        );
        if (result.rowCount > 0) totalModified++;
      }

      for (const tx of removed) {
        await client.query('DELETE FROM transactions WHERE plaid_transaction_id=$1', [tx.transaction_id]);
        totalRemoved++;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    cursor = next_cursor;
    if (!has_more) break;
  }

  await db.query('UPDATE bank_connections SET cursor=$1 WHERE id=$2', [cursor, conn.id]);
  console.log(`[sync] ${conn.institution_name} — Complete: ${totalSynced} new, ${totalModified} modified, ${totalRemoved} removed`);

  return { synced: totalSynced, skipped: totalSkipped, modified: totalModified, removed: totalRemoved, newTxIds };
}

async function syncAll({ forceFullSync = false } = {}) {
  const { rows: connections } = await db.query('SELECT * FROM bank_connections');
  if (connections.length === 0) return { synced: 0, skipped: 0, errors: [] };

  const { rows: rentRows } = await db.query('SELECT DISTINCT monthly_rent FROM tenants');
  const rentAmounts = rentRows.map(r => parseFloat(r.monthly_rent));

  let totalSynced = 0, totalSkipped = 0;
  const errors = [];
  const allNewTxIds = [];

  for (const conn of connections) {
    try {
      const result = await syncConnection(conn, rentAmounts, { forceFullSync });
      if (result.connectionError) {
        errors.push(result.connectionError);
        continue;
      }
      totalSynced += result.synced;
      totalSkipped += result.skipped;
      allNewTxIds.push(...result.newTxIds);
    } catch (err) {
      const plaidError = err.response?.data;
      const errorCode = plaidError?.error_code;
      const errorMessage = plaidError?.error_message || err.message;

      console.error(`[sync] Failed for ${conn.institution_name}: ${errorCode} — ${errorMessage}`);
      if (plaidError) console.error(`[sync] Full Plaid error:`, JSON.stringify(plaidError, null, 2));

      const userMessage = errorCode === 'PRODUCT_NOT_READY'
        ? 'Plaid is still preparing your transactions (historical pull in progress). This typically takes 2–5 minutes after connecting. Try again shortly.'
        : errorMessage;

      errors.push({ institution: conn.institution_name, error_code: errorCode || null, error: userMessage });
    }
  }

  if (allNewTxIds.length > 0) {
    await applyRulesToTransactions(allNewTxIds);
    await autoMatchAll();
    await backfillPropertyTenant();
    await predictAll();
  }

  return { synced: totalSynced, skipped: totalSkipped, errors };
}

// Sync a single connection by ID (used by full-resync endpoint)
async function syncOne(connectionId, { forceFullSync = false } = {}) {
  const { rows } = await db.query('SELECT * FROM bank_connections WHERE id=$1', [connectionId]);
  if (!rows.length) throw new Error('Connection not found');
  const conn = rows[0];

  const { rows: rentRows } = await db.query('SELECT DISTINCT monthly_rent FROM tenants');
  const rentAmounts = rentRows.map(r => parseFloat(r.monthly_rent));

  const result = await syncConnection(conn, rentAmounts, { forceFullSync });
  if (result.connectionError) {
    return { synced: 0, skipped: 0, errors: [result.connectionError] };
  }

  if (result.newTxIds.length > 0) {
    await applyRulesToTransactions(result.newTxIds);
    await autoMatchAll();
    await backfillPropertyTenant();
    await predictAll();
  }

  return { synced: result.synced, skipped: result.skipped, modified: result.modified, removed: result.removed, errors: [] };
}

module.exports = { syncAll, syncOne };
