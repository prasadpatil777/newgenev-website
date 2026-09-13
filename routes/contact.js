const express = require('express');
const { pool } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

// POST /api/contact - public, anyone (even logged-out visitors) can send a message.
router.post('/contact', async (req, res) => {
  const { name, email, phone, enquiryType, message } = req.body || {};
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'name, email and message are required' });
  }
  await pool.query(
    'INSERT INTO contact_messages (name, email, phone, enquiry_type, message) VALUES ($1,$2,$3,$4,$5)',
    [name, email, phone || null, enquiryType || null, message]
  );
  res.json({ ok: true });
});

// GET /api/contact/messages - only the MAIN station's owner reads messages.
router.get('/contact/messages', requireUser, async (req, res) => {
  const isOwner = await pool.query(
    `SELECT 1 FROM stations WHERE user_id = $1 AND id = (SELECT MIN(id) FROM stations)`,
    [req.userId]
  );
  if (!isOwner.rows[0]) return res.status(403).json({ error: 'not authorized' });

  const result = await pool.query('SELECT * FROM contact_messages ORDER BY id DESC LIMIT 100');
  await pool.query('UPDATE contact_messages SET seen = 1 WHERE seen = 0');
  res.json({ messages: result.rows });
});

router.get('/contact/unread-count', requireUser, async (req, res) => {
  const isOwner = await pool.query(
    `SELECT 1 FROM stations WHERE user_id = $1 AND id = (SELECT MIN(id) FROM stations)`,
    [req.userId]
  );
  if (!isOwner.rows[0]) return res.json({ count: 0 });

  const result = await pool.query('SELECT COUNT(*) as count FROM contact_messages WHERE seen = 0');
  res.json({ count: Number(result.rows[0].count) });
});

module.exports = router;

