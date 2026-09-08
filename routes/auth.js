const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, newApiKey } = require('../db/init');
const { JWT_SECRET, requireUser } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { name, email, password, stationName } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
  if (existing.rows.length) return res.status(409).json({ error: 'an account with this email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const userResult = await pool.query(
    'INSERT INTO users (name, email, password_hash) VALUES ($1,$2,$3) RETURNING id',
    [name, email.toLowerCase(), hash]
  );
  const userId = userResult.rows[0].id;

  const apiKey = newApiKey();
  await pool.query(
    'INSERT INTO stations (user_id, name, api_key) VALUES ($1,$2,$3)',
    [userId, stationName || 'My EV Charger', apiKey]
  );

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: userId, name, email }, stationApiKey: apiKey });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = result.rows[0];
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

router.get('/me', requireUser, async (req, res) => {
  const userResult = await pool.query('SELECT id, name, email, created_at FROM users WHERE id = $1', [req.userId]);
  const stationsResult = await pool.query('SELECT id, name, api_key, created_at FROM stations WHERE user_id = $1', [req.userId]);
  res.json({ user: userResult.rows[0], stations: stationsResult.rows });
});

module.exports = router;

