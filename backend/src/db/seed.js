require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { Pool } = require('pg');

const isLocal = !process.env.DATABASE_URL ||
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/propertylens',
  ssl: isLocal ? false : { rejectUnauthorized: false },
});

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM transactions');
    await client.query('DELETE FROM tenants');
    await client.query('DELETE FROM properties');

    const prop = async (name, address) => {
      const { rows } = await client.query(
        'INSERT INTO properties (name, address) VALUES ($1, $2) RETURNING id', [name, address]
      );
      return rows[0].id;
    };
    const mapleId = await prop('142 Maple St Duplex', '142 Maple St');
    const oakId   = await prop('87 Oak Ave Fourplex', '87 Oak Ave');
    const pineId  = await prop('310 Pine Rd', '310 Pine Rd');
    const birchId = await prop('55 Birch Ln', '55 Birch Ln');

    const tenant = (pid, name, unit, rent) => client.query(
      'INSERT INTO tenants (property_id, name, unit, monthly_rent) VALUES ($1, $2, $3, $4)',
      [pid, name, unit, rent]
    );
    await tenant(mapleId, 'Marcus Johnson',   '1A', 1450);
    await tenant(mapleId, 'Sarah & Tom Chen', '1B', 1450);
    await tenant(oakId,   'Derek Williams',   '2A', 1200);
    await tenant(oakId,   'Priya Nair',       '2B', 1200);
    await tenant(oakId,   'Luis & Ana Reyes', '2C', 1200);
    await tenant(oakId,   "James O'Brien",    '2D', 1200);
    await tenant(pineId,  'Donna Fitzgerald', '3A', 1800);
    await tenant(birchId, 'Kevin Park',       '4A', 1650);

    const tx = (date, desc, amount, type, category) => client.query(
      'INSERT INTO transactions (date, description, amount, type, category) VALUES ($1, $2, $3, $4, $5)',
      [date, desc, amount, type, category]
    );
    await tx('2026-04-01', 'Rent - Marcus Johnson 1A',   1450,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Sarah & Tom Chen 1B', 1450,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Derek Williams 2A',   1200,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Priya Nair 2B',       1200,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Luis & Ana Reyes 2C', 1200,  'income',  'rent');
    await tx('2026-04-01', "Rent - James O'Brien 2D",    1200,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Donna Fitzgerald 3A', 1800,  'income',  'rent');
    await tx('2026-04-01', 'Rent - Kevin Park 4A',       1650,  'income',  'rent');
    await tx('2026-04-05', 'Plumber - 87 Oak Ave',       -320,  'expense', 'maintenance');
    await tx('2026-04-10', 'Landscaping',                -150,  'expense', 'maintenance');
    await tx('2026-04-15', 'Property Insurance',         -480,  'expense', 'insurance');

    await client.query('COMMIT');
    console.log('Database seeded successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed failed:', err.message);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch(() => process.exit(1));
