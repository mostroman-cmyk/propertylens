const express = require('express');
const router = express.Router();
const { Products, CountryCode } = require('plaid');
const plaidClient = require('../plaid/client');
const db = require('../db/db');
const { syncAll } = require('../plaid/sync');

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

    await db.query(
      'INSERT INTO bank_connections (institution_name, access_token, item_id) VALUES ($1, $2, $3)',
      [institution_name || 'Unknown', access_token, item_id]
    );

    syncAll()
      .then(r => console.log(`Auto-sync after connect: ${r.synced} new, ${r.skipped} skipped`))
      .catch(e => console.error('Auto-sync error:', e.message));

    res.json({ success: true, item_id, institution_name: institution_name || 'Unknown' });
  } catch (err) {
    console.error('Plaid exchange-token error:', err.response?.data || err.message);
    res.status(500).json({ error: err.response?.data?.error_message || err.message });
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

router.get('/connections', async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, institution_name, item_id, created_at FROM bank_connections ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
