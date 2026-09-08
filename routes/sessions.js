const express = require('express');
const { pool } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

router.get('/sessions', requireUser, async (req, res) => {
  const stationResult = await pool.query('SELECT * FROM stations WHERE user_id = $1 ORDER BY id LIMIT 1', [req.userId]);
  const station = stationResult.rows[0];
  if (!station) return res.status(404).json({ error: 'no station found for this account' });

  const rowsResult = await pool.query(
    'SELECT id, duration_sec, units, bill, ended_at FROM sessions WHERE station_id = $1 ORDER BY id DESC LIMIT 50',
    [station.id]
  );

  const totalsResult = await pool.query(
    'SELECT COUNT(*) as count, COALESCE(SUM(units),0) as units, COALESCE(SUM(bill),0) as bill FROM sessions WHERE station_id = $1',
    [station.id]
  );
  const t = totalsResult.rows[0];

  res.json({ sessions: rowsResult.rows, totals: { count: Number(t.count), units: Number(t.units), bill: Number(t.bill) } });
});

module.exports = router;

