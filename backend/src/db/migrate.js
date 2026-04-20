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

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS predicted_category TEXT`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS predicted_property_id INTEGER`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS predicted_tenant_id INTEGER`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS prediction_confidence TEXT`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS prediction_reasoning TEXT`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS prediction_accepted BOOLEAN DEFAULT FALSE`);

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS rent_month VARCHAR(7)`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS needs_month_review BOOLEAN DEFAULT false`);

  // Recalculate rent_month for all matched income transactions using day-based logic
  // (runs every deploy so late-month deposits like Mar 28 are correctly assigned to April)
  const { recalculateRentMonths } = require('../matching/rentMonth');
  await recalculateRentMonths({ onlyNull: false });

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS plaid_account_id TEXT`);

  // Portfolio-wide scope support
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS property_scope TEXT DEFAULT 'single'`);
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS predicted_property_scope TEXT`);
  await db.query(`ALTER TABLE categorization_rules ADD COLUMN IF NOT EXISTS property_scope TEXT DEFAULT 'single'`);

  // Seed portfolio-wide categorization rules (idempotent by keyword)
  const portfolioRules = [
    ['UMBRELLA',              'Insurance',            'expense', 10],
    ['LLC',                   'Legal',                'expense', 10],
    ['BUSINESS LICENSE',      'Legal',                'expense', 10],
    ['SECRETARY OF STATE',    'Legal',                'expense', 10],
    ['FRANCHISE TAX BOARD',   'Legal',                'expense', 10],
    ['ATTORNEY',              'Legal',                'expense', 10],
    ['LAWYER',                'Legal',                'expense', 10],
    ['LEGALZOOM',             'Legal',                'expense', 10],
    ['QUICKBOOKS',            'Software',             'expense', 10],
    ['TURBOTAX',              'Software',             'expense', 10],
    ['STESSA',                'Software',             'expense', 10],
    ['ACCOUNTANT',            'Professional Services','expense', 10],
    ['CPA',                   'Professional Services','expense', 10],
    ['BOOKKEEPING',           'Professional Services','expense', 10],
  ];
  for (const [keyword, category, type, priority] of portfolioRules) {
    const { rows } = await db.query('SELECT id FROM categorization_rules WHERE keyword=$1', [keyword]);
    if (rows.length === 0) {
      await db.query(
        `INSERT INTO categorization_rules (keyword, category, type, priority, property_scope) VALUES ($1,$2,$3,$4,'portfolio')`,
        [keyword, category, type, priority]
      );
    }
  }

  // Portfolio allocation setting
  await db.query(
    `INSERT INTO settings (key, value) VALUES ('portfolio_allocation', 'equal') ON CONFLICT (key) DO NOTHING`
  );

  // Tenant matching improvements
  await db.query(`
    CREATE TABLE IF NOT EXISTS tenant_aliases (
      id         SERIAL PRIMARY KEY,
      tenant_id  INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      alias      TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, alias)
    )
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS tenant_payment_patterns (
      id               SERIAL PRIMARY KEY,
      tenant_id        INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      pattern_keyword  TEXT NOT NULL,
      match_count      INTEGER NOT NULL DEFAULT 1,
      last_seen        TIMESTAMPTZ DEFAULT NOW(),
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (tenant_id, pattern_keyword)
    )
  `);

  await db.query(`ALTER TABLE bank_connections ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ`);

  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS normalized_description TEXT`);

  // Backfill normalized_description for any rows missing it
  const { normalizeDescription } = require('../prediction/engine');
  const { rows: missingNorm } = await db.query(
    'SELECT id, description FROM transactions WHERE normalized_description IS NULL'
  );
  for (const row of missingNorm) {
    await db.query('UPDATE transactions SET normalized_description=$1 WHERE id=$2',
      [normalizeDescription(row.description), row.id]);
  }
  if (missingNorm.length > 0) {
    console.log(`[migrate] Backfilled normalized_description for ${missingNorm.length} transactions`);
  }

  // Prediction transparency: store up to 5 example contributing transactions per prediction
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS prediction_examples TEXT`);

  // Learning activity log
  await db.query(`
    CREATE TABLE IF NOT EXISTS prediction_activity (
      id           SERIAL PRIMARY KEY,
      event_type   TEXT NOT NULL,
      tx_id        INTEGER,
      tx_desc      TEXT,
      affected     INTEGER DEFAULT 0,
      high_count   INTEGER DEFAULT 0,
      medium_count INTEGER DEFAULT 0,
      low_count    INTEGER DEFAULT 0,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ── Payer-name matching infrastructure ──────────────────────────────────────

  // Column: extracted sender name after payment-rail prefix (e.g. "BAILY ANDREW" from Zelle)
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS payer_name TEXT`);

  // Table: confirmed payer_name → tenant_id mappings, built from manual assignments
  await db.query(`
    CREATE TABLE IF NOT EXISTS payer_patterns (
      id                SERIAL PRIMARY KEY,
      payer_name        TEXT NOT NULL,
      tenant_id         INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      confirmed_count   INTEGER NOT NULL DEFAULT 1,
      last_confirmed_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE (payer_name, tenant_id)
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_payer_patterns_name ON payer_patterns (payer_name)`);

  // Table: explicit merchant-pattern + amount → property/category/tenant (HIGHEST prediction priority)
  await db.query(`
    CREATE TABLE IF NOT EXISTS pattern_amount_rules (
      id               SERIAL PRIMARY KEY,
      merchant_pattern TEXT NOT NULL,
      amount           NUMERIC(10,2),
      amount_tolerance NUMERIC(10,2) DEFAULT 2,
      category         TEXT,
      property_id      INTEGER REFERENCES properties(id) ON DELETE SET NULL,
      property_scope   TEXT DEFAULT 'single',
      tenant_id        INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
      note             TEXT,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_par_pattern ON pattern_amount_rules (merchant_pattern)`);

  // Table: payer_name + amount_bucket → tenant_id (amount-specific prediction)
  await db.query(`
    CREATE TABLE IF NOT EXISTS payer_amount_patterns (
      id                SERIAL PRIMARY KEY,
      payer_name        TEXT NOT NULL,
      amount_bucket     NUMERIC(10,2) NOT NULL,
      tenant_id         INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
      category          TEXT NOT NULL DEFAULT 'rent',
      confirmed_count   INTEGER NOT NULL DEFAULT 1,
      last_confirmed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_payer_amount_pname ON payer_amount_patterns (payer_name)`);
  // Expression-based unique index: treats NULL tenant_id as 0 to avoid multiple-NULL ambiguity
  await db.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_payer_amount_unique
      ON payer_amount_patterns (payer_name, amount_bucket, COALESCE(tenant_id::integer, 0), category)
  `);

  // Column: human-readable cleaned description for UI display
  await db.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS display_description TEXT`);

  // IMPORTANT: Reset all normalized_descriptions so they are recomputed with the
  // fixed normalization (which now correctly strips CONF# labels regardless of
  // whether the ID is numeric-only or alphanumeric). This ensures "BAILY ANDREW CONF"
  // artifacts from the old bug are replaced with clean "BAILY ANDREW" forms.
  const { rows: normCount } = await db.query('SELECT COUNT(*) FROM transactions');
  await db.query('UPDATE transactions SET normalized_description = NULL');
  console.log(`[migrate] Reset normalized_description on ${normCount[0].count} transactions for recompute with fixed normalization`);

  // Backfill normalized_description with corrected logic
  const { normalizeDescription: nd, computeDisplayDescription: cdd, extractSenderName } = require('../prediction/engine');
  const { rows: allTx } = await db.query('SELECT id, description, type FROM transactions');
  let normFixed = 0, payerLearned = 0, patternLearned = 0;

  for (const row of allTx) {
    const newNorm = nd(row.description);
    const displayDesc = cdd(row.description);
    const payerName = row.type === 'income' ? extractSenderName(row.description) : null;
    await db.query(
      'UPDATE transactions SET normalized_description=$1, display_description=$2, payer_name=$3 WHERE id=$4',
      [newNorm, displayDesc, payerName || null, row.id]
    );
    normFixed++;
  }
  console.log(`[migrate] Recomputed normalized_description + payer_name for ${normFixed} transactions`);

  // Learn payer patterns from existing income transactions that already have a tenant assigned
  const { rows: assignedIncome } = await db.query(`
    SELECT id, description, tenant_id FROM transactions
    WHERE type = 'income' AND tenant_id IS NOT NULL AND payer_name IS NOT NULL
  `);
  for (const row of assignedIncome) {
    const pn = extractSenderName(row.description);
    if (!pn) continue;
    try {
      await db.query(
        `INSERT INTO payer_patterns (payer_name, tenant_id, confirmed_count, last_confirmed_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (payer_name, tenant_id)
         DO UPDATE SET confirmed_count = payer_patterns.confirmed_count + 1, last_confirmed_at = NOW()`,
        [pn, row.tenant_id]
      );
      patternLearned++;
    } catch {}
  }
  console.log(`[migrate] Learned ${patternLearned} payer_patterns from ${assignedIncome.length} historical assignments`);

  // Backfill payer_amount_patterns from historical income assignments
  const { rows: assignedIncomeAmt } = await db.query(`
    SELECT t.id, t.description, t.amount, t.tenant_id, t.category
    FROM transactions t
    WHERE t.type = 'income' AND t.tenant_id IS NOT NULL AND t.payer_name IS NOT NULL
  `);
  let amtPatternLearned = 0;
  for (const row of assignedIncomeAmt) {
    const pn = extractSenderName(row.description);
    if (!pn) continue;
    const bucket = Math.round(Math.abs(parseFloat(row.amount)) / 5.0) * 5;
    const category = row.category || 'rent';
    try {
      const { rows: existing } = await db.query(
        `SELECT id FROM payer_amount_patterns
         WHERE payer_name=$1 AND amount_bucket=$2 AND category=$3
         AND (tenant_id=$4 OR (tenant_id IS NULL AND $4::integer IS NULL))`,
        [pn, bucket, category, row.tenant_id]
      );
      if (existing.length > 0) {
        await db.query(
          'UPDATE payer_amount_patterns SET confirmed_count=confirmed_count+1, last_confirmed_at=NOW() WHERE id=$1',
          [existing[0].id]
        );
      } else {
        await db.query(
          'INSERT INTO payer_amount_patterns (payer_name, amount_bucket, tenant_id, category) VALUES ($1,$2,$3,$4)',
          [pn, bucket, row.tenant_id, category]
        );
      }
      amtPatternLearned++;
    } catch (err) {
      console.error(`[migrate] payer_amount_patterns backfill error: ${err.message}`);
    }
  }
  console.log(`[migrate] Backfilled ${amtPatternLearned} payer_amount_patterns from ${assignedIncomeAmt.length} historical assignments`);

  // DEBUG: Log any mortgage-servicer transactions to surface misclassified training data
  try {
    const { rows: jmjRows } = await db.query(`
      SELECT tx.amount::numeric, tx.category, p.name AS property_name, COUNT(*) AS count
      FROM transactions tx
      LEFT JOIN properties p ON tx.property_id = p.id
      WHERE tx.description ILIKE '%JMJ MTG GROUP%'
      GROUP BY tx.amount::numeric, tx.category, p.name
      ORDER BY tx.amount::numeric
    `);
    if (jmjRows.length > 0) {
      const total = jmjRows.reduce((s, r) => s + parseInt(r.count), 0);
      console.log(`[migrate] JMJ MTG GROUP — ${total} total transactions:`);
      for (const r of jmjRows) {
        console.log(`  $${parseFloat(r.amount).toFixed(2)} × ${r.count} → ${r.category || 'uncat'} / ${r.property_name || 'no property'}`);
      }
    }
  } catch {}

  // ── Category normalization — ensure all stored categories are Title Case ──────
  const { CATEGORY_MAP } = require('../utils/normalizeCategory');
  let catNormTotal = 0;
  for (const [lower, canonical] of Object.entries(CATEGORY_MAP)) {
    const [r1, r2, r3] = await Promise.all([
      db.query(`UPDATE transactions SET category=$1 WHERE LOWER(TRIM(category))=$2 AND category<>$1`, [canonical, lower]),
      db.query(`UPDATE categorization_rules SET category=$1 WHERE LOWER(TRIM(category))=$2 AND category<>$1`, [canonical, lower]),
      db.query(`UPDATE pattern_amount_rules SET category=$1 WHERE LOWER(TRIM(category))=$2 AND category<>$1`, [canonical, lower]),
    ]);
    const n = r1.rowCount + r2.rowCount + r3.rowCount;
    if (n > 0) {
      console.log(`[migrate] Category: '${lower}' → '${canonical}': ${n} rows`);
      catNormTotal += n;
    }
  }
  if (catNormTotal > 0) console.log(`[migrate] Category normalization complete: ${catNormTotal} total rows updated`);

  // Former tenant support
  await db.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'`);
  await db.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lease_start_date DATE`);
  await db.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lease_end_date DATE`);
  await db.query(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS notes TEXT`);

  console.log('[migrate] Database ready');

  // Fire-and-forget: re-predict using updated payer patterns and fixed normalization
  const { predictAll } = require('../prediction/engine');
  setImmediate(async () => {
    try {
      const result = await predictAll();
      console.log(`[migrate] Auto-predict after payer-name backfill: ${result.predicted} updated — ${JSON.stringify(result.counts)}`);
    } catch (err) {
      console.error('[migrate] Auto-predict failed:', err.message);
    }
  });
}

module.exports = migrate;
