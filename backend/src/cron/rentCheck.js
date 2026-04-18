const cron = require('node-cron');
const { sendRentReport } = require('../email/rentReport');
const db = require('../db/db');

let currentTasks = [];

async function getSettings() {
  try {
    const result = await db.query('SELECT key, value FROM settings');
    return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
  } catch {
    return {};
  }
}

function buildExpressions(settings) {
  const hour = settings.alert_hour || '18';
  const freq = settings.alert_frequency || 'monthly';

  if (freq === 'weekly') {
    return [`0 ${hour} * * ${settings.alert_weekday || '1'}`];
  }
  if (freq === 'twice') {
    const d1 = settings.alert_day  || '5';
    const d2 = settings.alert_day2 || '20';
    return [`0 ${hour} ${d1},${d2} * *`];
  }
  return [`0 ${hour} ${settings.alert_day || '5'} * *`];
}

function reschedule(settings) {
  currentTasks.forEach(t => { try { t.stop(); } catch {} });
  currentTasks = [];

  const expressions = buildExpressions(settings);
  currentTasks = expressions.map(expr =>
    cron.schedule(expr, async () => {
      console.log(`[cron] Running rent check (${expr})...`);
      try {
        const result = await sendRentReport();
        console.log(`[cron] Report sent to ${result.notifyEmail} — ${result.paid} paid, ${result.unpaid} unpaid`);
      } catch (err) {
        console.error('[cron] Failed:', err.message);
      }
    })
  );

  console.log(`[cron] Scheduled: ${expressions.join(', ')}`);
  return expressions;
}

// Schedule on module load using current DB settings
getSettings()
  .then(reschedule)
  .catch(err => {
    console.error('[cron] Failed to load settings, using defaults:', err.message);
    reschedule({});
  });

module.exports = { reschedule, buildExpressions, getSettings };
