const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

// In-memory rate limiter: ip -> { count, resetAt }
const attempts = new Map();

function getRateEntry(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    return { count: 0, resetAt: now + 15 * 60 * 1000 };
  }
  return entry;
}

router.post('/login', (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const { password } = req.body;

  const entry = getRateEntry(ip);
  if (entry.count >= 5) {
    const mins = Math.ceil((entry.resetAt - Date.now()) / 60000);
    return res.status(429).json({ error: `Too many attempts. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` });
  }

  const correctPassword = process.env.AUTH_PASSWORD;
  if (!correctPassword) {
    return res.status(500).json({ error: 'AUTH_PASSWORD is not configured on the server.' });
  }

  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret) {
    return res.status(500).json({ error: 'JWT_SECRET is not configured on the server.' });
  }

  if (password !== correctPassword) {
    attempts.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
    const remaining = 5 - (entry.count + 1);
    const msg = remaining > 0
      ? `Incorrect password. ${remaining} attempt${remaining !== 1 ? 's' : ''} remaining.`
      : 'Incorrect password. Too many attempts — wait 15 minutes.';
    return res.status(401).json({ error: msg });
  }

  // Correct password — clear rate limit
  attempts.delete(ip);

  const token = jwt.sign({ auth: true }, jwtSecret, { expiresIn: '30d' });

  res.cookie('pl_token', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });

  res.json({ ok: true });
});

router.post('/logout', (req, res) => {
  res.clearCookie('pl_token', { httpOnly: true, sameSite: 'lax' });
  res.json({ ok: true });
});

// Called by frontend on load to check if current cookie is valid
router.get('/me', (req, res) => {
  const token = req.cookies?.pl_token;
  const jwtSecret = process.env.JWT_SECRET;

  if (!token || !jwtSecret) return res.status(401).json({ error: 'Unauthorized' });

  try {
    jwt.verify(token, jwtSecret);
    res.json({ ok: true });
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

module.exports = router;
