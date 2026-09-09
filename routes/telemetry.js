const express = require('express');
const { pool } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

async function stationByApiKey(req, res, next) {
  const key = req.headers['x-station-key'];
  if (!key) return res.status(401).json({ error: 'missing X-Station-Key header' });
  const result = await pool.query('SELECT * FROM stations WHERE api_key = $1', [key]);
  if (!result.rows[0]) return res.status(401).json({ error: 'invalid station API key' });
  req.station = result.rows[0];
  next();
}

router.post('/telemetry', stationByApiKey, async (req, res) => {
  const b = req.body || {};
  await pool.query(
    `INSERT INTO telemetry
      (station_id, state, relay, meter_online, dht_online, voltage, current, power, pf, hz,
       kwh, session_wh, temp, hum, time_sec, emergency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      req.station.id, b.state || 'UNKNOWN', b.relay ? 1 : 0, b.meter ? 1 : 0, b.dht ? 1 : 0,
      Number(b.v) || 0, Number(b.i) || 0, Number(b.p) || 0, Number(b.pf) || 0, Number(b.hz) || 0,
      Number(b.kwh) || 0, Number(b.sessionWh) || 0, Number(b.temp) || 0, Number(b.hum) || 0,
      Number(b.time) || 0, b.emg ? 1 : 0
    ]
  );

  await pool.query(
    `DELETE FROM telemetry WHERE station_id = $1 AND id NOT IN (
      SELECT id FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 500
    )`,
    [req.station.id]
  );

  res.json({ ok: true });
});

router.post('/sessions', stationByApiKey, async (req, res) => {
  const b = req.body || {};
  await pool.query(
    'INSERT INTO sessions (station_id, duration_sec, units, bill) VALUES ($1,$2,$3,$4)',
    [req.station.id, Number(b.durationSec) || 0, Number(b.units) || 0, Number(b.bill) || 0]
  );
  res.json({ ok: true });
});

router.get('/live', requireUser, async (req, res) => {
  const stationResult = await pool.query('SELECT * FROM stations WHERE user_id = $1 ORDER BY id LIMIT 1', [req.userId]);
  const station = stationResult.rows[0];
  if (!station) return res.status(404).json({ error: 'no station found for this account' });

  const latestResult = await pool.query('SELECT * FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 1', [station.id]);
  const latest = latestResult.rows[0];
  const isOnline = latest && (Date.now() - new Date(latest.received_at).getTime()) < 5000;

  res.json({ station: { id: station.id, name: station.name }, online: !!isOnline, latest: latest || null });
});

router.get('/live/history', requireUser, async (req, res) => {
  const stationResult = await pool.query('SELECT * FROM stations WHERE user_id = $1 ORDER BY id LIMIT 1', [req.userId]);
  const station = stationResult.rows[0];
  if (!station) return res.status(404).json({ error: 'no station found for this account' });

  const rowsResult = await pool.query(
    'SELECT power, voltage, current, received_at FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 30',
    [station.id]
  );
  res.json({ points: rowsResult.rows.reverse() });
});

module.exports = router;

