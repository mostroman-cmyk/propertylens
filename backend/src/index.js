require('dotenv').config();
const express = require('express');
const cors = require('cors');
const migrate = require('./db/migrate');

const propertiesRouter   = require('./routes/properties');
const tenantsRouter      = require('./routes/tenants');
const transactionsRouter = require('./routes/transactions');
const plaidRouter        = require('./routes/plaid');
const emailRouter        = require('./routes/email');
const settingsRouter     = require('./routes/settings');

const app  = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'PropertyLens API' }));

app.use('/api/properties',   propertiesRouter);
app.use('/api/tenants',      tenantsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/plaid',        plaidRouter);
app.use('/api/email',        emailRouter);
app.use('/api/settings',     settingsRouter);

async function start() {
  app.listen(PORT, () => {
    console.log(`PropertyLens backend running on port ${PORT}`);
  });

  try {
    await migrate();
  } catch (err) {
    console.error('[startup] Database migration failed — server is running but DB may be unavailable.');
    console.error('[startup] Cause:', err.message);
    if (!process.env.DATABASE_URL) {
      console.error('[startup] DATABASE_URL is not set. Add it as a Railway environment variable.');
    }
  }
}

start();
