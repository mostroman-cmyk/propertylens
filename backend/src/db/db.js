const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/propertylens';

const isLocal = !process.env.DATABASE_URL ||
  DATABASE_URL.includes('localhost') ||
  DATABASE_URL.includes('127.0.0.1');

const sslConfig = isLocal ? false : { rejectUnauthorized: false };

console.log('[db] DATABASE_URL set:', !!process.env.DATABASE_URL);
console.log('[db] SSL enabled:', !!sslConfig);

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: sslConfig,
});

pool.on('error', (err) => console.error('[db] Unexpected pool error:', err.message));

module.exports = pool;
