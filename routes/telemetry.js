const express = require('express');
const { db } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

function stationByApiKey(req, res, next) {
  const key = req.headers['x-station-key'];
  if (!key) return res.status(401).json({ error: 'missing X-Station-Key header' });
  const station = db.prepare('SELECT * FROM stations WHERE api_key = ?').get(key);
  if (!station) return res.status(401).json({ error: 'invalid station API key' });
  req.station = station;
  next();
}

// ESP32 posts a live reading here every few seconds.
// Body: { state, relay, meter, dht, v, i, p, pf, hz, kwh, sessionWh, temp, hum, time, emg }
router.post('/telemetry', stationByApiKey, (req, res) => {
  const b = req.body || {};
  db.prepare(`INSERT INTO telemetry
    (station_id, state, relay, meter_online, dht_online, voltage, current, power, pf, hz,
     kwh, session_wh, temp, hum, time_sec, emergency)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    req.station.id, b.state || 'UNKNOWN', b.relay ? 1 : 0, b.meter ? 1 : 0, b.dht ? 1 : 0,
    Number(b.v) || 0, Number(b.i) || 0, Number(b.p) || 0, Number(b.pf) || 0, Number(b.hz) || 0,
    Number(b.kwh) || 0, Number(b.sessionWh) || 0, Number(b.temp) || 0, Number(b.hum) || 0,
    Number(b.time) || 0, b.emg ? 1 : 0
  );

  // Keep the telemetry table from growing forever - trim to the most recent 500 rows per station.
  db.prepare(`DELETE FROM telemetry WHERE station_id = ? AND id NOT IN (
    SELECT id FROM telemetry WHERE station_id = ? ORDER BY id DESC LIMIT 500
  )`).run(req.station.id, req.station.id);

  res.json({ ok: true });
});

// ESP32 posts here once, when a charging session completes.
// Body: { durationSec, units, bill }
router.post('/sessions', stationByApiKey, (req, res) => {
  const b = req.body || {};
  db.prepare('INSERT INTO sessions (station_id, duration_sec, units, bill) VALUES (?,?,?,?)')
    .run(req.station.id, Number(b.durationSec) || 0, Number(b.units) || 0, Number(b.bill) || 0);
  res.json({ ok: true });
});

// Website calls this (logged-in user) to get the latest reading for their station.
router.get('/live', requireUser, (req, res) => {
  const station = db.prepare('SELECT * FROM stations WHERE user_id = ? ORDER BY id LIMIT 1').get(req.userId);
  if (!station) return res.status(404).json({ error: 'no station found for this account' });

  const latest = db.prepare('SELECT * FROM telemetry WHERE station_id = ? ORDER BY id DESC LIMIT 1').get(station.id);
  const isOnline = latest && (Date.now() - new Date(latest.received_at + 'Z').getTime()) < 10000;

  res.json({ station: { id: station.id, name: station.name }, online: !!isOnline, latest: latest || null });
});

module.exports = router;
