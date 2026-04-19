const plaidClient = require('./client');
const db = require('../db/db');
const { applyRulesToTransactions } = require('../categorization/ruleEngine');
const { autoMatchAll } = require('../matching/rentMatcher');

const RENT_TOLERANCE = 10;
const START_DATE = '2010-01-01';
const PAGE_SIZE = 500;

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

async function syncAll() {
  const { rows: connections } = await db.query('SELECT * FROM bank_connections');
  if (connections.length === 0) return { synced: 0, skipped: 0, errors: [] };

  const { rows: rentRows } = await db.query('SELECT DISTINCT monthly_rent FROM tenants');
  const rentAmounts = rentRows.map(r => parseFloat(r.monthly_rent));

  const endDate = new Date().toISOString().split('T')[0];
  let totalSynced = 0, totalSkipped = 0;
  const errors = [];

  for (const conn of connections) {
    const enabledIds = conn.enabled_account_ids;
    if (!enabledIds || enabledIds.length === 0) {
      console.warn(`[sync] Skipping ${conn.institution_name} — no accounts selected`);
      errors.push({
        institution: conn.institution_name,
        error_code: 'NO_ACCOUNTS_SELECTED',
        error: `No accounts selected for ${conn.institution_name}. Open Account Settings on the dashboard and choose which accounts to sync.`,
      });
      continue;
    }

    try {
      let allTransactions = [];
      let offset = 0;

      while (true) {
        const resp = await plaidClient.transactionsGet({
          access_token: conn.access_token,
          start_date: START_DATE,
          end_date: endDate,
          options: { count: PAGE_SIZE, offset, include_personal_finance_category: true, account_ids: enabledIds },
        });

        const { transactions, total_transactions } = resp.data;
        allTransactions = allTransactions.concat(transactions);
        offset += transactions.length;
        console.log(`[${conn.institution_name}] fetched ${offset}/${total_transactions}`);
        if (offset >= total_transactions) break;
      }

      const client = await db.connect();
      try {
        await client.query('BEGIN');
        let synced = 0, skipped = 0;
        const newTxIds = [];
        for (const tx of allTransactions) {
          if (tx.pending) { skipped++; continue; }
          const { storedAmount, type, category } = classifyTransaction(tx, rentAmounts);
          const result = await client.query(
            `INSERT INTO transactions (date, description, amount, type, category, plaid_transaction_id)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (plaid_transaction_id) DO NOTHING
             RETURNING id`,
            [tx.date, tx.name, storedAmount, type, category, tx.transaction_id]
          );
          if (result.rowCount > 0) { synced++; newTxIds.push(result.rows[0].id); }
          else skipped++;
        }
        await client.query('COMMIT');
        totalSynced += synced;
        totalSkipped += skipped;
        console.log(`[${conn.institution_name}] +${synced} new, ${skipped} already existed`);

        if (newTxIds.length > 0) {
          await applyRulesToTransactions(newTxIds);
        }
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    } catch (err) {
      const plaidError = err.response?.data;
      const errorCode = plaidError?.error_code;
      const errorMessage = plaidError?.error_message || err.message;

      console.error(`[sync] Failed for ${conn.institution_name}:`);
      console.error(`[sync]   error_code: ${errorCode}`);
      console.error(`[sync]   error_message: ${errorMessage}`);
      if (plaidError) console.error(`[sync]   full Plaid error:`, JSON.stringify(plaidError, null, 2));

      const userMessage = errorCode === 'PRODUCT_NOT_READY'
        ? 'Plaid is still preparing your transactions — this can take a few minutes after connecting. Please try again shortly.'
        : errorMessage;

      errors.push({
        institution: conn.institution_name,
        error_code: errorCode || null,
        error: userMessage,
      });
    }
  }

  if (totalSynced > 0) {
    await autoMatchAll();
  }

  return { synced: totalSynced, skipped: totalSkipped, errors };
}

module.exports = { syncAll };
