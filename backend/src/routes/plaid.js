const express = require('express');
const router = express.Router();
const { Products, CountryCode } = require('plaid');
const plaidClient = require('../plaid/client');
const db = require('../db/db');
const { syncAll, syncOne } = require('../plaid/sync');

router.post('/create-link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: 'propertylens-user' },
      client_name: 'PropertyLens',
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error('Plaid create-link-token error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
});

router.post('/exchange-token', async (req, res) => {
  const { public_token, institution_name } = req.body;
  if (!public_token) return res.status(400).json({ error: 'public_token is required' });
  try {
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = response.data;

    const { rows } = await db.query(
      'INSERT INTO bank_connections (institution_name, access_token, item_id) VALUES ($1, $2, $3) RETURNING id',
      [institution_name || 'Unknown', access_token, item_id]
    );

    res.json({ success: true, connection_id: rows[0].id, item_id, institution_name: institution_name || 'Unknown' });
  } catch (err) {
    console.error('Plaid exchange-token error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
});

// Fetch all accounts for a bank connection from Plaid
router.get('/accounts/:connectionId', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM bank_connections WHERE id = $1', [req.params.connectionId]);
    if (!rows.length) return res.status(404).json({ error: 'Connection not found' });
    const resp = await plaidClient.accountsGet({ access_token: rows[0].access_token });
    res.json(resp.data.accounts);
  } catch (err) {
    console.error('Plaid accounts error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
  }
});

// Count how many transactions would be removed for the accounts being deselected
router.post('/connections/:connectionId/count-deselected', async (req, res) => {
  const { new_account_ids } = req.body;
  if (!Array.isArray(new_account_ids)) return res.status(400).json({ error: 'new_account_ids required' });
  try {
    const { rows: [conn] } = await db.query('SELECT enabled_account_ids FROM bank_connections WHERE id=$1', [req.params.connectionId]);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });
    const oldIds = conn.enabled_account_ids || [];
    const deselected = oldIds.filter(id => !new_account_ids.includes(id));
    if (deselected.length === 0) return res.json({ deselected: [], total_count: 0 });

    const counts = [];
    let totalCount = 0;
    for (const account_id of deselected) {
      const { rows } = await db.query(
        'SELECT COUNT(*) FROM transactions WHERE plaid_account_id=$1',
        [account_id]
      );
      const count = parseInt(rows[0].count, 10);
      counts.push({ account_id, count });
      totalCount += count;
    }
    res.json({ deselected: counts, total_count: totalCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Save selected account IDs for a connection, optionally deleting deselected account transactions
router.put('/connections/:connectionId/accounts', async (req, res) => {
  const { account_ids, delete_deselected } = req.body;
  if (!Array.isArray(account_ids)) return res.status(400).json({ error: 'account_ids must be an array' });
  try {
    const { rows: [conn] } = await db.query('SELECT enabled_account_ids FROM bank_connections WHERE id=$1', [req.params.connectionId]);
    const oldIds = conn?.enabled_account_ids || [];
    const deselected = oldIds.filter(id => !account_ids.includes(id));

    let removedCount = 0;
    if (delete_deselected && deselected.length > 0) {
      const result = await db.query(
        'DELETE FROM transactions WHERE plaid_account_id = ANY($1::text[]) RETURNING id',
        [deselected]
      );
      removedCount = result.rowCount;
      console.log(`[accounts] Removed ${removedCount} transactions from deselected accounts: ${deselected.join(', ')}`);
    }

    const addedIds = account_ids.filter(id => !oldIds.includes(id));
    await db.query(
      'UPDATE bank_connections SET enabled_account_ids = $1 WHERE id = $2',
      [JSON.stringify(account_ids), req.params.connectionId]
    );
    res.json({ success: true, account_ids, removed_count: removedCount, added_count: addedIds.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all transactions whose plaid_account_id is not in any enabled account list
router.post('/cleanup-orphans', async (req, res) => {
  try {
    const { rows: connections } = await db.query('SELECT enabled_account_ids FROM bank_connections');
    const allEnabled = connections.flatMap(c => c.enabled_account_ids || []);
    if (allEnabled.length === 0) {
      return res.json({ removed: 0, message: 'No enabled accounts configured' });
    }
    const result = await db.query(
      'DELETE FROM transactions WHERE plaid_account_id IS NOT NULL AND NOT (plaid_account_id = ANY($1::text[])) RETURNING id',
      [allEnabled]
    );
    console.log(`[cleanup] Removed ${result.rowCount} orphaned transactions`);
    res.json({ removed: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy = imported by Plaid but before plaid_account_id tracking was added
const LEGACY_WHERE = `plaid_transaction_id IS NOT NULL AND plaid_account_id IS NULL`;

// Stats on legacy transactions
router.get('/legacy-stats', async (req, res) => {
  try {
    const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM transactions WHERE ${LEGACY_WHERE}`);
    const { rows: samples } = await db.query(
      `SELECT id, date, description, amount, type, category FROM transactions WHERE ${LEGACY_WHERE} ORDER BY date DESC LIMIT 30`
    );
    const { rows: connections } = await db.query(
      'SELECT id, institution_name, enabled_account_ids FROM bank_connections ORDER BY created_at DESC'
    );
    res.json({ count: parseInt(count, 10), samples, connections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Assign all legacy transactions to a specific plaid_account_id
router.post('/legacy-assign', async (req, res) => {
  const { account_id } = req.body;
  if (!account_id) return res.status(400).json({ error: 'account_id required' });
  try {
    const result = await db.query(
      `UPDATE transactions SET plaid_account_id=$1 WHERE ${LEGACY_WHERE} RETURNING id`,
      [account_id]
    );
    console.log(`[legacy] Assigned ${result.rowCount} transactions to account ${account_id}`);
    res.json({ assigned: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all legacy transactions
router.post('/legacy-delete', async (req, res) => {
  try {
    const result = await db.query(`DELETE FROM transactions WHERE ${LEGACY_WHERE} RETURNING id`);
    console.log(`[legacy] Deleted ${result.rowCount} legacy transactions`);
    res.json({ deleted: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all legacy transactions then re-sync from Plaid (clean slate)
router.post('/legacy-resync', async (req, res) => {
  try {
    const { rows: del } = await db.query(`DELETE FROM transactions WHERE ${LEGACY_WHERE} RETURNING id`);
    console.log(`[legacy-resync] Deleted ${del.length} legacy transactions, starting fresh sync...`);
    const result = await syncAll();
    res.json({ deleted: del.length, synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full re-sync a single connection: clear cursor, optionally delete its transactions, re-import all history
router.post('/connections/:connectionId/full-resync', async (req, res) => {
  const { delete_existing } = req.body;
  const { connectionId } = req.params;
  try {
    const { rows: [conn] } = await db.query('SELECT * FROM bank_connections WHERE id=$1', [connectionId]);
    if (!conn) return res.status(404).json({ error: 'Connection not found' });

    let deleted = 0;
    if (delete_existing) {
      const accountIds = conn.enabled_account_ids || [];
      if (accountIds.length > 0) {
        const result = await db.query(
          'DELETE FROM transactions WHERE plaid_account_id = ANY($1::text[]) RETURNING id',
          [accountIds]
        );
        deleted = result.rowCount;
        console.log(`[full-resync] Deleted ${deleted} existing transactions for ${conn.institution_name}`);
      }
    }

    // Clear cursor so sync fetches full history
    await db.query('UPDATE bank_connections SET cursor=NULL WHERE id=$1', [connectionId]);
    console.log(`[full-resync] Cursor cleared for ${conn.institution_name}, starting historical sync...`);

    const result = await syncOne(connectionId, { forceFullSync: true });
    res.json({ deleted, synced: result.synced, skipped: result.skipped, errors: result.errors });
  } catch (err) {
    console.error('[full-resync] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/sync', async (req, res) => {
  try {
    const result = await syncAll();
    res.json(result);
  } catch (err) {
    console.error('Sync error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Clear all cursors and re-import full history from Plaid for every connection
router.post('/full-resync-all', async (req, res) => {
  try {
    await db.query('UPDATE bank_connections SET cursor=NULL');
    console.log('[full-resync-all] Cleared all cursors, starting historical sync...');
    const result = await syncAll({ forceFullSync: true });
    res.json(result);
  } catch (err) {
    console.error('[full-resync-all] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/connections', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, institution_name, item_id, enabled_account_ids, created_at FROM bank_connections ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
