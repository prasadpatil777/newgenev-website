const express = require('express');
const { pool } = require('../db/init');
const jwt = require('jsonwebtoken');
const { requireUser, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// ---------- Live push (Server-Sent Events) ----------
// The newest reading of each station is kept in memory and pushed to every
// open dashboard the moment the ESP32 posts it - no waiting for the next
// poll, and no database round-trip on the hot path.
const liveLatest = new Map();      // stationId -> { row, receivedAtMs }
const streamClients = new Set();   // { res, userId }
const ONLINE_WINDOW_MS = 3000;

// ---------- Remote start/stop (owner backup when a customer's RFID fails) ----------
// The owner's command waits here; the next telemetry post from the ESP32
// picks it up in its reply. Commands expire quickly so an old "start" can
// never fire later by surprise.
const pendingCmd = new Map();      // stationId -> { id, action, at }
const lastCmd = new Map();         // stationId -> { id, action, at, status, doneAt }
const CMD_TTL_MS = 15000;
let cmdSeq = Math.floor(Date.now() / 1000) % 1000000;

const stationKeyCache = new Map();   // api_key -> { station, at }
async function stationByApiKey(req, res, next) {
  const key = req.headers['x-station-key'];
  if (!key) return res.status(401).json({ error: 'missing X-Station-Key header' });
  const cached = stationKeyCache.get(key);
  if (cached && Date.now() - cached.at < 60000) { req.station = cached.station; return next(); }
  const result = await pool.query('SELECT * FROM stations WHERE api_key = $1', [key]);
  if (!result.rows[0]) return res.status(401).json({ error: 'invalid station API key' });
  stationKeyCache.set(key, { station: result.rows[0], at: Date.now() });
  req.station = result.rows[0];
  next();
}

router.post('/telemetry', stationByApiKey, async (req, res) => {
  const b = req.body || {};
  const row = {
    station_id: req.station.id, state: b.state || 'UNKNOWN', relay: b.relay ? 1 : 0,
    meter_online: b.meter ? 1 : 0, dht_online: b.dht ? 1 : 0,
    voltage: Number(b.v) || 0, current: Number(b.i) || 0, power: Number(b.p) || 0,
    pf: Number(b.pf) || 0, hz: Number(b.hz) || 0, kwh: Number(b.kwh) || 0,
    session_wh: Number(b.sessionWh) || 0, temp: Number(b.temp) || 0, hum: Number(b.hum) || 0,
    time_sec: Number(b.time) || 0, emergency: b.emg ? 1 : 0,
    rc: b.rc ? 1 : 0,                 // firmware supports remote start/stop
    received_at: new Date().toISOString()
  };
  liveLatest.set(req.station.id, { row, receivedAtMs: Date.now() });

  // Hand over a waiting remote command (once), unless it is too old.
  let reply = { ok: true };
  const p = pendingCmd.get(req.station.id);
  if (p) {
    pendingCmd.delete(req.station.id);
    if (Date.now() - p.at < CMD_TTL_MS) {
      reply = { ok: true, cmd: p.action, cmdId: p.id };
      lastCmd.set(req.station.id, { ...p, status: 'delivered', doneAt: Date.now() });
    } else {
      lastCmd.set(req.station.id, { ...p, status: 'expired', doneAt: Date.now() });
    }
  }
  pushToStreams(req.station.id);      // dashboards update right now
  res.json(reply);                    // ESP32 doesn't wait for the database

  try {
    await saveTelemetry(req.station, b);
  } catch (e) {
    console.error('telemetry save failed:', e.message);
  }
});

let telemetryCount = 0;
async function saveTelemetry(station, b) {
  await pool.query(
    `INSERT INTO telemetry
      (station_id, state, relay, meter_online, dht_online, voltage, current, power, pf, hz,
       kwh, session_wh, temp, hum, time_sec, emergency)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      station.id, b.state || 'UNKNOWN', b.relay ? 1 : 0, b.meter ? 1 : 0, b.dht ? 1 : 0,
      Number(b.v) || 0, Number(b.i) || 0, Number(b.p) || 0, Number(b.pf) || 0, Number(b.hz) || 0,
      Number(b.kwh) || 0, Number(b.sessionWh) || 0, Number(b.temp) || 0, Number(b.hum) || 0,
      Number(b.time) || 0, b.emg ? 1 : 0
    ]
  );

  // Trim old rows now and then (not on every 0.5 s post).
  if (++telemetryCount % 20 === 0) {
    await pool.query(
      `DELETE FROM telemetry WHERE station_id = $1 AND id NOT IN (
        SELECT id FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 500
      )`,
      [station.id]
    );
  }
}

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

  let mem = liveLatest.get(station.id);
  if (!mem) {
    const latestResult = await pool.query('SELECT * FROM telemetry WHERE station_id = $1 ORDER BY id DESC LIMIT 1', [station.id]);
    const r = latestResult.rows[0];
    if (r) mem = { row: r, receivedAtMs: new Date(r.received_at).getTime() };
  }
  res.json(livePayload(station, mem, req.userId));
});

function livePayload(station, mem, userId) {
  const ageMs = mem ? Date.now() - mem.receivedAtMs : null;
  return {
    station: { id: station.id, name: station.name },
    online: ageMs !== null && ageMs < ONLINE_WINDOW_MS,
    latest: mem ? mem.row : null,
    ageMs,                      // how old "latest" is - lets the timer stay exact
    location: stationLocation(station),
    isOwner: station.user_id === userId,
    control: controlInfo(station.id, mem)
  };
}

function controlInfo(stationId, mem) {
  let last = lastCmd.get(stationId) || null;
  const p = pendingCmd.get(stationId);
  if (p) last = { ...p, status: Date.now() - p.at < CMD_TTL_MS ? 'waiting' : 'expired' };
  return {
    supported: !!(mem && mem.row && Number(mem.row.rc) === 1),
    last: last ? { id: last.id, action: last.action, status: last.status, ageMs: Date.now() - last.at } : null
  };
}

// Main station row, cached briefly so pushes don't hit the database.
let mainStationCache = null, mainStationAt = 0;
async function getMainStationCached() {
  if (!mainStationCache || Date.now() - mainStationAt > 30000) {
    mainStationCache = await getMainStation();
    mainStationAt = Date.now();
  }
  return mainStationCache;
}

async function pushToStreams(stationId) {
  if (!streamClients.size) return;
  let station;
  try { station = await getMainStationCached(); } catch (e) { return; }
  if (!station || station.id !== stationId) return;
  const mem = liveLatest.get(station.id);
  for (const c of streamClients) {
    c.res.write('data: ' + JSON.stringify(livePayload(station, mem, c.userId)) + '\n\n');
  }
}

// EventSource can't send an Authorization header, so the token comes in the URL.
router.get('/live/stream', async (req, res) => {
  let userId;
  try { userId = jwt.verify(String(req.query.token || ''), JWT_SECRET).userId; }
  catch (e) { return res.status(401).json({ error: 'invalid or expired token' }); }

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 2000\n\n');

  const client = { res, userId };
  streamClients.add(client);
  try {
    const station = await getMainStationCached();
    if (station) res.write('data: ' + JSON.stringify(livePayload(station, liveLatest.get(station.id), userId)) + '\n\n');
  } catch (e) {}
  req.on('close', () => streamClients.delete(client));
});

// Once a second: keep connections alive and let dashboards flip to OFFLINE
// when the charger stops posting.
setInterval(async () => {
  if (!streamClients.size) return;
  let station;
  try { station = await getMainStationCached(); } catch (e) { return; }
  if (!station) return;
  const mem = liveLatest.get(station.id);
  const fresh = mem && Date.now() - mem.receivedAtMs < 900;
  for (const c of streamClients) {
    if (fresh) c.res.write(': ping\n\n');
    else c.res.write('data: ' + JSON.stringify(livePayload(station, mem, c.userId)) + '\n\n');
  }
}, 1000);

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
  mainStationCache = result.rows[0]; mainStationAt = Date.now();
  pushToStreams(station.id);
  res.json({ ok: true, location: stationLocation(result.rows[0]) });
});

// Owner presses Start / Stop on the website.
router.post('/stations/control', requireUser, async (req, res) => {
  const station = await getMainStation();
  if (!station) return res.status(404).json({ error: 'no station found' });
  if (station.user_id !== req.userId) return res.status(403).json({ error: 'only the station owner can control the charger' });

  const action = String((req.body || {}).action || '').toLowerCase();
  if (action !== 'on' && action !== 'off') return res.status(400).json({ error: 'action must be "on" or "off"' });

  const mem = liveLatest.get(station.id);
  const online = mem && Date.now() - mem.receivedAtMs < ONLINE_WINDOW_MS;
  if (!online) return res.status(409).json({ error: 'The charger is offline, so it cannot receive the command.' });
  if (Number(mem.row.rc) !== 1) return res.status(409).json({ error: 'The charger needs the remote-control firmware update first.' });
  const st = String(mem.row.state || '').toUpperCase();
  if (mem.row.emergency) return res.status(409).json({ error: 'Emergency stop is active on the charger.' });
  if (action === 'on' && st !== 'AVAILABLE') return res.status(409).json({ error: `Charger is ${st}; it can only start when AVAILABLE.` });
  if (action === 'off' && st !== 'CHARGING') return res.status(409).json({ error: `Charger is ${st}; nothing to stop.` });

  const cmd = { id: ++cmdSeq, action, at: Date.now() };
  pendingCmd.set(station.id, cmd);
  pushToStreams(station.id);
  res.json({ ok: true, id: cmd.id });
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
