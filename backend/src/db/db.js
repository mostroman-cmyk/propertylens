const { Pool } = require('pg');

const isLocal = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/propertylens',
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

pool.on('error', (err) => console.error('[db] Unexpected pool error:', err.message));

module.exports = pool;
