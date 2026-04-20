require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const migrate = require('./db/migrate');
const seed    = require('./db/seed');
const db      = require('./db/db');

const propertiesRouter          = require('./routes/properties');
const tenantsRouter             = require('./routes/tenants');
const transactionsRouter        = require('./routes/transactions');
const plaidRouter               = require('./routes/plaid');
const emailRouter               = require('./routes/email');
const settingsRouter            = require('./routes/settings');
const categorizationRulesRouter = require('./routes/categorizationRules');
const predictionsRouter   = require('./routes/predictions');
const reportsRouter       = require('./routes/reports');
const merchantRulesRouter = require('./routes/merchantRules');

const app  = express();
const PORT = process.env.PORT && process.env.PORT !== '5432' ? process.env.PORT : 3001;
console.log('[startup] process.env.PORT =', process.env.PORT, '→ listening on', PORT);

const FRONTEND_DIST = path.join(__dirname, '../../frontend/dist');
console.log('[static] Serving frontend from:', FRONTEND_DIST);
console.log('[static] Dist folder exists:', fs.existsSync(FRONTEND_DIST));

app.use(cors());
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'PropertyLens API' }));

app.use('/api/properties',   propertiesRouter);
app.use('/api/tenants',      tenantsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/plaid',        plaidRouter);
app.use('/api/email',        emailRouter);
app.use('/api/settings',              settingsRouter);
app.use('/api/categorization-rules',  categorizationRulesRouter);
app.use('/api/predictions',    predictionsRouter);
app.use('/api/reports',        reportsRouter);
app.use('/api/merchant-rules', merchantRulesRouter);

app.use(express.static(FRONTEND_DIST));
app.get('*', (req, res) => {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

async function start() {
  app.listen(PORT, () => {
    console.log(`PropertyLens backend running on port ${PORT}`);
  });

  try {
    await migrate();
    const { rows } = await db.query('SELECT COUNT(*) FROM properties');
    if (parseInt(rows[0].count, 10) === 0) {
      console.log('[startup] No properties found — running initial seed...');
      await seed();
    } else {
      console.log('[startup] Properties exist, skipping seed');
    }
  } catch (err) {
    console.error('[startup] Database setup failed — server is running but DB may be unavailable.');
    console.error('[startup] Full error:', err);
    if (!process.env.DATABASE_URL) {
      console.error('[startup] DATABASE_URL is not set. Add it as a Railway environment variable.');
    }
  }
}

start();
