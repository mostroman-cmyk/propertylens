const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/redpurplegreen';

const sslConfig = process.env.DATABASE_URL ? { rejectUnauthorized: false } : false;

console.log('[db] DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('[db] SSL config:', sslConfig);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
});

pool.on('error', (err) => console.error('[db] Unexpected pool error:', err.message));

module.exports = pool;
