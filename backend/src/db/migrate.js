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
      plaid_transaction_id TEXT UNIQUE,
      property_id INTEGER REFERENCES properties(id)
    )
  `);

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT`);
  await db.query(`DROP INDEX IF EXISTS idx_tx_plaid_id`);
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'transactions_plaid_id_unique'
      ) THEN
        ALTER TABLE transactions ADD CONSTRAINT transactions_plaid_id_unique UNIQUE (plaid_transaction_id);
      END IF;
    END $$
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS bank_connections (
      id SERIAL PRIMARY KEY,
      institution_name TEXT NOT NULL,
      access_token TEXT NOT NULL,
      item_id TEXT NOT NULL,
      cursor TEXT,
      enabled_account_ids JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // Add enabled_account_ids to existing tables and wipe Plaid transactions on first run
  const { rows: colCheck } = await db.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bank_connections' AND column_name = 'enabled_account_ids'
  `);
  if (colCheck.length === 0) {
    await db.query(`ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS enabled_account_ids JSONB`);
    await db.query(`DELETE FROM transactions WHERE plaid_transaction_id IS NOT NULL`);
    console.log('[migrate] Added enabled_account_ids column; wiped Plaid-imported transactions for account filter setup');
  }

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tenant_id INTEGER REFERENCES tenants(id)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS match_confidence TEXT`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_review BOOLEAN DEFAULT false`);

  await db.query(`
    CREATE TABLE IF NOT EXISTS categorization_rules (
      id SERIAL PRIMARY KEY,
      keyword TEXT NOT NULL,
      category TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'expense',
      priority INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const { rows: ruleCount } = await db.query('SELECT COUNT(*) FROM categorization_rules');
  if (parseInt(ruleCount[0].count, 10) === 0) {
    const defaults = [
      ['HOME DEPOT',       'Repairs',       'expense', 10],
      ['LOWES',            'Repairs',       'expense', 10],
      ['ACE HARDWARE',     'Repairs',       'expense', 10],
      ['STATE FARM',       'Insurance',     'expense', 10],
      ['ALLSTATE',         'Insurance',     'expense', 10],
      ['GEICO',            'Insurance',     'expense', 10],
      ['FARMERS',          'Insurance',     'expense', 10],
      ['LIBERTY MUTUAL',   'Insurance',     'expense', 10],
      ['SDGE',             'Utilities',     'expense', 10],
      ['SAN DIEGO GAS',    'Utilities',     'expense', 10],
      ['SOCAL GAS',        'Utilities',     'expense', 10],
      ['PG&E',             'Utilities',     'expense', 10],
      ['CITY OF SAN DIEGO','Utilities',     'expense', 10],
      ['SDCWA',            'Utilities',     'expense', 10],
      ['WATER',            'Utilities',     'expense',  5],
      ['COUNTY TREASURER', 'Property Tax',  'expense', 10],
      ['PROPERTY TAX',     'Property Tax',  'expense', 10],
      ['TAX COLLECTOR',    'Property Tax',  'expense', 10],
      ['LANDSCAPING',      'Landscaping',   'expense', 10],
      ['LAWN',             'Landscaping',   'expense',  5],
      ['GARDENER',         'Landscaping',   'expense', 10],
      ['HOA',              'HOA',           'expense', 10],
      ['HOMEOWNERS ASSOC', 'HOA',           'expense', 10],
    ];
    for (const [keyword, category, type, priority] of defaults) {
      await db.query(
        'INSERT INTO categorization_rules (keyword, category, type, priority) VALUES ($1, $2, $3, $4)',
        [keyword, category, type, priority]
      );
    }
    console.log('[migrate] Seeded default categorization rules');
  }

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
