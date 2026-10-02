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

// Every registered account (owner or customer) gets its own station row
// created at signup, each with its own API key - but only ONE of those
// stations actually has real ESP32 hardware wired to it. A customer's own
// station never receives telemetry, so showing "your own station" to a
// logged-in customer always reads OFFLINE no matter what the real charger
// is doing. Instead, /live and /live/history always show the one shared
// "main" station (the same station booking.html defaults everyone to),
// so every logged-in user - owner or customer - sees the same real
// charger's live status.
async function getMainStation() {
  const result = await pool.query('SELECT * FROM stations ORDER BY id LIMIT 1');
  return result.rows[0];
}

router.get('/live', requireUser, async (req, res) => {
  const station = await getMainStation();
  if (!station) return res.status(404).json({ error: 'no station found' });

  const latestResult = await pool.query('SELECT * FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 1', [station.id]);
  const latest = latestResult.rows[0];
  const isOnline = latest && (Date.now() - new Date(latest.received_at).getTime()) < 3000;

  res.json({
    station: { id: station.id, name: station.name },
    online: !!isOnline,
    latest: latest || null,
    location: stationLocation(station),
    isOwner: station.user_id === req.userId
  });
});

// Default spot until the owner sets one from the dashboard.
const DEFAULT_LOCATION = { lat: 21.005417, lng: 75.573682, label: 'NEW GEN EV Charging Station' };

function stationLocation(station) {
  const hasLoc = station.lat !== null && station.lat !== undefined && station.lng !== null && station.lng !== undefined;
  return {
    lat: hasLoc ? Number(station.lat) : DEFAULT_LOCATION.lat,
    lng: hasLoc ? Number(station.lng) : DEFAULT_LOCATION.lng,
    label: station.location_label || DEFAULT_LOCATION.label,
    updatedAt: station.location_updated_at || null
  };
}

// The owner moves the charger (e.g. home -> college) and taps "Update to my
// current location" on the dashboard; the browser sends its GPS position here.
router.post('/stations/location', requireUser, async (req, res) => {
  const station = await getMainStation();
  if (!station) return res.status(404).json({ error: 'no station found' });
  if (station.user_id !== req.userId) return res.status(403).json({ error: 'only the station owner can change its location' });

  const lat = Number((req.body || {}).lat);
  const lng = Number((req.body || {}).lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'invalid coordinates' });
  }
  const label = String((req.body || {}).label || '').trim().slice(0, 120) || null;

  const result = await pool.query(
    `UPDATE stations SET lat = $1, lng = $2, location_label = COALESCE($3, location_label), location_updated_at = now()
     WHERE id = $4 RETURNING *`,
    [lat, lng, label, station.id]
  );
  res.json({ ok: true, location: stationLocation(result.rows[0]) });
});

router.get('/live/history', requireUser, async (req, res) => {
  const station = await getMainStation();
  if (!station) return res.status(404).json({ error: 'no station found' });

  const rowsResult = await pool.query(
    'SELECT power, voltage, current, received_at FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 30',
    [station.id]
  );
  res.json({ points: rowsResult.rows.reverse() });
});

module.exports = router;
