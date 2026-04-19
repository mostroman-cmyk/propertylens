const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { reschedule, buildExpressions } = require('../cron/rentCheck');

const ALLOWED_KEYS = ['notify_email', 'alert_frequency', 'alert_day', 'alert_day2', 'alert_weekday', 'alert_hour', 'portfolio_allocation'];
const SCHEDULE_KEYS = new Set(['alert_frequency', 'alert_day', 'alert_day2', 'alert_weekday', 'alert_hour']);

async function loadSettings() {
  const result = await db.query('SELECT key, value FROM settings');
  return Object.fromEntries(result.rows.map(r => [r.key, r.value]));
}

router.get('/', async (req, res) => {
  try {
    res.json(await loadSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const updates = req.body;
  try {
    for (const key of ALLOWED_KEYS) {
      if (updates[key] !== undefined) {
        await db.query(
          'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
          [key, String(updates[key])]
        );
      }
    }

    const allSettings = await loadSettings();
    const scheduleChanged = Object.keys(updates).some(k => SCHEDULE_KEYS.has(k));
    const expressions = scheduleChanged ? reschedule(allSettings) : buildExpressions(allSettings);

    res.json({ success: true, settings: allSettings, expressions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
