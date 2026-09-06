const express = require('express');
const { db } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

router.get('/sessions', requireUser, (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE user_id = ? ORDER BY id LIMIT 1').get(req.userId);
  if (!station) return res.status(404).json({ error: 'no station found for this account' });

  const rows = db.prepare(
    'SELECT id, duration_sec, units, bill, ended_at FROM sessions WHERE station_id = ? ORDER BY id DESC LIMIT 50'
  ).all(station.id);

  const totals = db.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(units),0) as units, COALESCE(SUM(bill),0) as bill FROM sessions WHERE station_id = ?'
  ).get(station.id);

  res.json({ sessions: rows, totals });
});

module.exports = router;
