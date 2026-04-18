/**
 * One-time migration: copies data from local SQLite DB into a PostgreSQL database.
 *
 * Usage:
 *   DATABASE_URL=<your-railway-pg-url> node backend/scripts/migrate-sqlite-to-pg.js
 *
 * Run from the project root. Requires better-sqlite3 and pg to be installed.
 * Safe to run multiple times — uses ON CONFLICT DO NOTHING so rows are not duplicated.
 */

const Database = require('better-sqlite3');
const { Pool }  = require('pg');
const path      = require('path');

const SQLITE_PATH = path.join(__dirname, '../propertylens.db');
const PG_URL      = process.env.DATABASE_URL;

if (!PG_URL) {
  console.error('Set DATABASE_URL to the Railway PostgreSQL connection string before running.');
  process.exit(1);
}

const sqlite = new Database(SQLITE_PATH, { readonly: true });
const pg     = new Pool({
  connectionString: PG_URL,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pg.connect();
  try {
    await client.query('BEGIN');

    // ── Properties ────────────────────────────────────────────────
    const properties = sqlite.prepare('SELECT * FROM properties ORDER BY id').all();
    for (const row of properties) {
      await client.query(
        `INSERT INTO properties (id, name, address)
         VALUES ($1, $2, $3)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.name, row.address]
      );
    }
    console.log(`Migrated ${properties.length} properties`);

    // Reset sequence so future inserts don't conflict
    await client.query(`SELECT setval('properties_id_seq', (SELECT MAX(id) FROM properties))`);

    // ── Tenants ───────────────────────────────────────────────────
    const tenants = sqlite.prepare('SELECT * FROM tenants ORDER BY id').all();
    for (const row of tenants) {
      await client.query(
        `INSERT INTO tenants (id, property_id, name, unit, monthly_rent)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.property_id, row.name, row.unit, row.monthly_rent]
      );
    }
    console.log(`Migrated ${tenants.length} tenants`);
    await client.query(`SELECT setval('tenants_id_seq', (SELECT MAX(id) FROM tenants))`);

    // ── Transactions ──────────────────────────────────────────────
    const transactions = sqlite.prepare('SELECT * FROM transactions ORDER BY id').all();
    for (const row of transactions) {
      await client.query(
        `INSERT INTO transactions (id, date, description, amount, type, category, plaid_transaction_id, property_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.date, row.description, row.amount, row.type, row.category,
         row.plaid_transaction_id || null, row.property_id || null]
      );
    }
    console.log(`Migrated ${transactions.length} transactions`);
    await client.query(`SELECT setval('transactions_id_seq', (SELECT MAX(id) FROM transactions))`);

    // ── Bank connections ──────────────────────────────────────────
    let bankConns = [];
    try {
      bankConns = sqlite.prepare('SELECT * FROM bank_connections ORDER BY id').all();
      for (const row of bankConns) {
        await client.query(
          `INSERT INTO bank_connections (id, institution_name, access_token, item_id, cursor, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (id) DO NOTHING`,
          [row.id, row.institution_name, row.access_token, row.item_id,
           row.cursor || null, row.created_at || new Date().toISOString()]
        );
      }
      console.log(`Migrated ${bankConns.length} bank connections`);
      if (bankConns.length > 0)
        await client.query(`SELECT setval('bank_connections_id_seq', (SELECT MAX(id) FROM bank_connections))`);
    } catch { console.log('No bank_connections table in SQLite — skipping'); }

    // ── Settings ──────────────────────────────────────────────────
    let settings = [];
    try {
      settings = sqlite.prepare('SELECT * FROM settings').all();
      for (const row of settings) {
        await client.query(
          `INSERT INTO settings (key, value) VALUES ($1, $2)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [row.key, row.value]
        );
      }
      console.log(`Migrated ${settings.length} settings`);
    } catch { console.log('No settings table in SQLite — skipping'); }

    await client.query('COMMIT');
    console.log('\nMigration complete!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pg.end();
    sqlite.close();
  }
}

run().catch(() => process.exit(1));
