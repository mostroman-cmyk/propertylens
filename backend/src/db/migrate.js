const db = require('./db');

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS properties (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      address TEXT NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      unit TEXT NOT NULL,
      monthly_rent NUMERIC(10,2) NOT NULL
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      date TEXT NOT NULL,
      description TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      type TEXT NOT NULL,
      category TEXT NOT NULL,
      plaid_transaction_id TEXT,
      property_id INTEGER REFERENCES properties(id)
    )
  `);

  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_plaid_id
    ON transactions(plaid_transaction_id)
    WHERE plaid_transaction_id IS NOT NULL
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_connections (
      id SERIAL PRIMARY KEY,
      institution_name TEXT NOT NULL,
      access_token TEXT NOT NULL,
      item_id TEXT NOT NULL,
      cursor TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  const notifyEmail = process.env.NOTIFY_EMAIL || 'mostroman@yahoo.com';
  const defaults = [
    ['notify_email',    notifyEmail],
    ['alert_frequency', 'monthly'],
    ['alert_day',       '5'],
    ['alert_day2',      '20'],
    ['alert_weekday',   '1'],
    ['alert_hour',      '18'],
  ];
  for (const [key, value] of defaults) {
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING',
      [key, value]
    );
  }

  console.log('[migrate] Database ready');
}

module.exports = migrate;
