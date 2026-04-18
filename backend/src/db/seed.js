require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/propertylens',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

async function seed(client) {
  const ownPool = !client;
  if (ownPool) client = await pool.connect();

  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transactions');
    await client.query('DELETE FROM tenants');
    await client.query('DELETE FROM properties');

    const prop = async (name, address) => {
      const { rows } = await client.query(
        'INSERT INTO properties (name, address) VALUES ($1, $2) RETURNING id',
        [name, address]
      );
      return rows[0].id;
    };

    const jamacha = await prop('1154 Jamacha Ln Duplex',      '1154 Jamacha Ln, Spring Valley CA 91977');
    const harness = await prop('9050 Harness St Duplex',      '9050 Harness St, Spring Valley CA 91977');
    const singing = await prop('8971 Singing Wood Wy Duplex', '8971 Singing Wood Wy, Santee CA 92071');
    const jeff    = await prop('2618 Jefferson St Duplex',    '2618 Jefferson St, Carlsbad CA 92008');

    const tenant = (pid, name, unit, bb, rent) => client.query(
      'INSERT INTO tenants (property_id, name, unit, bedrooms_bathrooms, monthly_rent) VALUES ($1, $2, $3, $4, $5)',
      [pid, name, unit, bb, rent]
    );

    await tenant(jamacha, 'Cheo',                    '1154', '2 Bedroom 1 Bath', 2226.00);
    await tenant(jamacha, 'Carillo Carillo',          '1156', '3 Bedroom 1 Bath', 2423.00);
    await tenant(harness, 'Erick & Connie Rodriguez', '9050', '3 Bedroom 1 Bath', 2357.00);
    await tenant(harness, 'Shauna Oleson',            '9052', '3 Bedroom 2 Bath', 2423.00);
    await tenant(singing, 'Baily Andrew',             'A',    '3 Bedroom 1 Bath', 3495.00);
    await tenant(singing, 'David',                    'B',    '1 Bedroom 1 Bath', 2094.00);
    await tenant(jeff,    'Julia',                    'A',    '2 Bedroom 1 Bath', 3495.00);
    await tenant(jeff,    'Daisy Durant',             'B',    '1 Bedroom 1 Bath', 2000.00);

    await client.query('COMMIT');
    console.log('[seed] Database seeded — 4 properties, 8 tenants, $20,513/mo total rent');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[seed] Seed failed:', err.message);
    throw err;
  } finally {
    if (ownPool) {
      client.release();
      await pool.end();
    }
  }
}

// Allow running directly: node src/db/seed.js
if (require.main === module) {
  seed().catch(() => process.exit(1));
}

module.exports = seed;
