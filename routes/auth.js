const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { db, newApiKey } = require('../db/init');
const { JWT_SECRET, requireUser } = require('../middleware/auth');

const router = express.Router();

router.post('/register', (req, res) => {
  const { name, email, password, stationName } = req.body || {};
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'name, email and password are required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'password must be at least 6 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'an account with this email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?,?,?)')
    .run(name, email.toLowerCase(), hash);
  const userId = info.lastInsertRowid;

  // Every new user gets one station by default, with its own API key for the ESP32.
  const apiKey = newApiKey();
  db.prepare('INSERT INTO stations (user_id, name, api_key) VALUES (?,?,?)')
    .run(userId, stationName || 'My EV Charger', apiKey);

  const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: userId, name, email }, stationApiKey: apiKey });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password are required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

router.get('/me', requireUser, (req, res) => {
  const user = db.prepare('SELECT id, name, email, created_at FROM users WHERE id = ?').get(req.userId);
  const stations = db.prepare('SELECT id, name, api_key, created_at FROM stations WHERE user_id = ?').all(req.userId);
  res.json({ user, stations });
});

module.exports = router;
