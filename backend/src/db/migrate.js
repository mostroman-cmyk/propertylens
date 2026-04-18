const db = require('./db');

async function waitForDb(retries = 3, delayMs = 3000) {
  const url = process.env.DATABASE_URL
    ? new URL(process.env.DATABASE_URL)
    : { hostname: 'localhost', port: '5432' };
  console.log('[migrate] Connecting to host:', url.hostname, 'port:', url.port || '5432');

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await db.query('SELECT 1');
      console.log('[migrate] Database connection established');
      return;
    } catch (err) {
      console.error(`[migrate] Connection attempt ${attempt}/${retries} failed — message: ${err.message} | code: ${err.code} | syscall: ${err.syscall}`);
      if (attempt === retries) throw err;
      console.log(`[migrate] Retrying in ${delayMs / 1000}s...`);
      await new Promise(res => setTimeout(res, delayMs));
    }
  }
}

async function migrate() {
  await waitForDb();

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
      monthly_rent NUMERIC(10,2) NOT NULL,
      bedrooms_bathrooms TEXT
    )
  `);

  await db.query(`
    ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bedrooms_bathrooms TEXT
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
