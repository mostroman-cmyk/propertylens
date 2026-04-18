const express = require('express');
const router = express.Router();
const { sendRentReport } = require('../email/rentReport');

// Test endpoint — sends the report immediately for the current month
router.post('/test', async (req, res) => {
  try {
    const result = await sendRentReport();
    res.json({
      success: true,
      message: `Report sent to ${result.notifyEmail}`,
      ...result,
    });
  } catch (err) {
    console.error('Test email failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
