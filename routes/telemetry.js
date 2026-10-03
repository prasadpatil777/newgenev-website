const express = require('express');
const { pool } = require('../db/init');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
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

  handlePrepay(req.station.id, row);   // Pay & Charge: start / stop by paid amount

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


// =====================================================================
// Pay & Charge (UPI, no payment gateway)
// Customer picks an amount -> pays the owner's UPI QR for an exact amount
// (unique paise identify the order) -> payment confirmed automatically from
// the owner's phone notification (MacroDroid -> /api/pay/notify) or by the
// owner with one tap -> charger starts -> stops when the paid amount is used.
// =====================================================================
const UPI_ID = process.env.UPI_ID || '7410722330@ybl';
const UPI_NAME = process.env.UPI_NAME || 'Prasad Patil';
const RATE_RS_PER_KWH = 23;
const ORDER_TTL_MIN = 10;
const MIN_AMOUNT = 10, MAX_AMOUNT = 500;
const activePrepay = new Map();      // stationId -> { orderId, base, stage, paidAt, lastStartAt, tries, stopAt }
const prepayLoaded = new Set();
let lastNotify = null;               // { at, text, matched, orderId }

function upiLink(amount, orderId) {
  // pa stays raw (some UPI apps reject an encoded "@"); text fields are encoded.
  return `upi://pay?pa=${UPI_ID}&pn=${encodeURIComponent(UPI_NAME)}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${encodeURIComponent('NEW GEN EV order ' + orderId)}`;
}

function queueCmd(stationId, action) {
  const cmd = { id: ++cmdSeq, action, at: Date.now() };
  pendingCmd.set(stationId, cmd);
  return cmd;
}

async function setPayStatus(id, status, extra = '') {
  try { await pool.query(`UPDATE payments SET status = $1 ${extra} WHERE id = $2`, [status, id]); }
  catch (e) { console.error('payment status update failed:', e.message); }
}

async function loadActivePrepay(stationId) {
  prepayLoaded.add(stationId);
  try {
    const r = await pool.query(
      `SELECT * FROM payments WHERE station_id = $1 AND status IN ('paid','charging') AND created_at > now() - interval '6 hours'
       ORDER BY id DESC LIMIT 1`, [stationId]);
    const o = r.rows[0];
    if (o && !activePrepay.has(stationId)) {
      activePrepay.set(stationId, { orderId: o.id, base: Number(o.base_amount), stage: o.status === 'charging' ? 'charging' : 'starting',
        paidAt: Date.now(), lastStartAt: 0, tries: 0, stopAt: 0 });
    }
  } catch (e) { console.error('load prepay failed:', e.message); }
}

function handlePrepay(stationId, row) {
  if (!prepayLoaded.has(stationId)) loadActivePrepay(stationId);
  const a = activePrepay.get(stationId);
  if (!a) return;
  const st = String(row.state || '').toUpperCase();
  const bill = (Number(row.session_wh) || 0) / 1000 * RATE_RS_PER_KWH;
  const now = Date.now();

  if (a.stage === 'starting') {
    if (st === 'CHARGING') {
      a.stage = 'charging';
      setPayStatus(a.orderId, 'charging', ', started_at = now()');
    } else if (now - a.paidAt > 60000) {
      activePrepay.delete(stationId);
      setPayStatus(a.orderId, 'failed_start');
    } else if (st === 'AVAILABLE' && !row.emergency && !pendingCmd.has(stationId) && now - a.lastStartAt > 6000 && a.tries < 4) {
      a.lastStartAt = now; a.tries++;
      queueCmd(stationId, 'on');
    }
  } else if (a.stage === 'charging') {
    if (st !== 'CHARGING') {                         // stopped by RFID / emergency / remote
      activePrepay.delete(stationId);
      pool.query(`UPDATE payments SET status = 'done', ended_at = now(), final_bill = COALESCE(final_bill, $1) WHERE id = $2`, [bill, a.orderId]).catch(() => {});
    } else if (bill >= a.base - 0.001) {             // paid amount used up -> stop
      a.stage = 'stopping'; a.stopAt = now; a.finalBill = bill;
      queueCmd(stationId, 'off');
    }
  } else if (a.stage === 'stopping') {
    if (st !== 'CHARGING') {
      activePrepay.delete(stationId);
      pool.query(`UPDATE payments SET status = 'done', ended_at = now(), final_bill = $1 WHERE id = $2`, [a.finalBill || bill, a.orderId]).catch(() => {});
    } else if (now - a.stopAt > 8000 && !pendingCmd.has(stationId)) {
      a.stopAt = now; queueCmd(stationId, 'off');
    }
  }
}

async function markPaid(order, source) {
  const r = await pool.query(
    `UPDATE payments SET status = 'paid', source = $1, paid_at = now() WHERE id = $2 AND status = 'waiting' RETURNING *`,
    [source, order.id]);
  if (!r.rows[0]) return false;
  activePrepay.set(order.station_id, { orderId: order.id, base: Number(order.base_amount), stage: 'starting',
    paidAt: Date.now(), lastStartAt: 0, tries: 0, stopAt: 0 });
  prepayLoaded.add(order.station_id);
  const mem = liveLatest.get(order.station_id);
  if (mem && String(mem.row.state).toUpperCase() === 'AVAILABLE' && !mem.row.emergency) {
    const a = activePrepay.get(order.station_id); a.lastStartAt = Date.now(); a.tries = 1;
    queueCmd(order.station_id, 'on');
  }
  return true;
}

function chargerStatus(station) {
  const mem = liveLatest.get(station.id);
  const online = !!(mem && Date.now() - mem.receivedAtMs < ONLINE_WINDOW_MS);
  const row = mem ? mem.row : {};
  return { online, state: online ? String(row.state || 'UNKNOWN').toUpperCase() : 'OFFLINE',
           emergency: !!(online && row.emergency), remote: !!(online && Number(row.rc) === 1), row };
}

async function expireOldOrders() {
  await pool.query(`UPDATE payments SET status = 'expired' WHERE status = 'waiting' AND created_at < now() - interval '${ORDER_TTL_MIN} minutes'`);
}

function publicOrder(o, station) {
  const c = chargerStatus(station);
  const a = activePrepay.get(station.id);
  const bill = (Number(c.row.session_wh) || 0) / 1000 * RATE_RS_PER_KWH;
  return {
    id: o.id, status: o.status, baseAmount: Number(o.base_amount), payAmount: Number(o.pay_amount),
    upi: upiLink(o.pay_amount, o.id), upiId: UPI_ID, upiName: UPI_NAME,
    expiresAt: new Date(new Date(o.created_at).getTime() + ORDER_TTL_MIN * 60000).toISOString(),
    charger: { online: c.online, state: c.state },
    used: (o.status === 'charging' || (a && a.orderId === o.id && a.stage !== 'starting')) ? Math.min(bill, Number(o.base_amount)) : (o.final_bill !== null && o.final_bill !== undefined ? Number(o.final_bill) : 0)
  };
}

// Public: what the pay page needs (no login - customers scan a QR at the charger).
router.get('/pay/info', async (req, res) => {
  const station = await getMainStationCached();
  if (!station) return res.status(404).json({ error: 'no station found' });
  const c = chargerStatus(station);
  await expireOldOrders().catch(() => {});
  const busy = await pool.query(`SELECT id FROM payments WHERE station_id = $1 AND status IN ('waiting','paid','charging') LIMIT 1`, [station.id]);
  let reason = null;
  if (!c.online) reason = 'The charger is offline right now.';
  else if (!c.remote) reason = 'This charger does not support online payment yet.';
  else if (c.emergency) reason = 'Emergency stop is active on the charger.';
  else if (c.state !== 'AVAILABLE') reason = `The charger is ${c.state.toLowerCase()} - please wait until it is available.`;
  else if (busy.rows[0]) reason = 'Another customer is paying right now. Please try again in a few minutes.';
  res.json({ station: { name: station.name }, charger: { online: c.online, state: c.state }, rate: RATE_RS_PER_KWH,
             upiName: UPI_NAME, minAmount: MIN_AMOUNT, maxAmount: MAX_AMOUNT, available: !reason, reason });
});

// Public: create an order with a unique paise amount.
router.post('/pay/order', async (req, res) => {
  const station = await getMainStationCached();
  if (!station) return res.status(404).json({ error: 'no station found' });
  const base = Math.round(Number((req.body || {}).amount));
  if (!Number.isFinite(base) || base < MIN_AMOUNT || base > MAX_AMOUNT) return res.status(400).json({ error: `Choose an amount between ₹${MIN_AMOUNT} and ₹${MAX_AMOUNT}.` });
  const c = chargerStatus(station);
  if (!c.online) return res.status(409).json({ error: 'The charger is offline right now.' });
  if (!c.remote) return res.status(409).json({ error: 'This charger does not support online payment yet.' });
  if (c.emergency) return res.status(409).json({ error: 'Emergency stop is active on the charger.' });
  if (c.state !== 'AVAILABLE') return res.status(409).json({ error: `The charger is ${c.state.toLowerCase()} - please wait.` });
  await expireOldOrders();
  const busy = await pool.query(`SELECT id FROM payments WHERE station_id = $1 AND status IN ('waiting','paid','charging') LIMIT 1`, [station.id]);
  if (busy.rows[0]) return res.status(409).json({ error: 'Another customer is paying right now. Please try again in a few minutes.' });
  const used = await pool.query(`SELECT pay_amount FROM payments WHERE created_at > now() - interval '30 minutes'`);
  const taken = new Set(used.rows.map(r => Number(r.pay_amount).toFixed(2)));
  let pay = null;
  for (let k = 0; k < 60; k++) {
    const cand = (base + (1 + crypto.randomInt(98)) / 100).toFixed(2);
    if (!taken.has(cand)) { pay = cand; break; }
  }
  if (!pay) return res.status(503).json({ error: 'Busy, please try again.' });
  const token = crypto.randomBytes(12).toString('hex');
  const r = await pool.query(
    `INSERT INTO payments (station_id, base_amount, pay_amount, token) VALUES ($1,$2,$3,$4) RETURNING *`,
    [station.id, base, pay, token]);
  res.json({ ...publicOrder(r.rows[0], station), token });
});

async function orderByToken(req) {
  const r = await pool.query('SELECT * FROM payments WHERE id = $1', [Number(req.params.id)]);
  const o = r.rows[0];
  if (!o || o.token !== String(req.query.token || (req.body || {}).token || '')) return null;
  return o;
}

router.get('/pay/order/:id', async (req, res) => {
  await expireOldOrders().catch(() => {});
  const o = await orderByToken(req);
  if (!o) return res.status(404).json({ error: 'order not found' });
  const station = await getMainStationCached();
  res.json(publicOrder(o, station));
});

router.post('/pay/order/:id/cancel', async (req, res) => {
  const o = await orderByToken(req);
  if (!o) return res.status(404).json({ error: 'order not found' });
  await pool.query(`UPDATE payments SET status = 'cancelled' WHERE id = $1 AND status = 'waiting'`, [o.id]);
  res.json({ ok: true });
});

// Owner's phone (MacroDroid) forwards the UPI "money received" notification here.
router.post('/pay/notify', express.text({ type: '*/*', limit: '8kb' }), async (req, res) => {
  const station = await getMainStation();
  if (!station || !station.notify_key || String(req.query.key || '') !== station.notify_key) return res.status(403).json({ error: 'bad key' });
  const text = (typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '')).slice(0, 600);
  lastNotify = { at: Date.now(), text, matched: false, orderId: null };
  const lower = text.toLowerCase();
  // incoming-payment words used by PhonePe/GPay/Paytm and bank SMS (SBI, HDFC, ICICI, Kotak, BOI, ...)
  if (!/(received|credited|credit of|deposited|paid you|sent you|has sent|added to)/.test(lower) || /(you paid|paid to|debited|sent to)/.test(lower)) {
    return res.json({ ok: true, matched: false, reason: 'not an incoming payment' });
  }
  const clean = text.replace(/,/g, '');
  let amounts = [...clean.matchAll(/(?:₹|rs\.?|inr)\s*([0-9]+(?:\.[0-9]{1,2})?)/gi)].map(m => Number(m[1]).toFixed(2));
  // some banks write the amount without Rs/INR ("credited by 10.03") — fall back to any number with paise
  if (!amounts.length) amounts = [...clean.matchAll(/(?<![0-9.])([0-9]{1,4}\.[0-9]{2})(?![0-9])/g)].map(m => Number(m[1]).toFixed(2));
  if (!amounts.length) return res.json({ ok: true, matched: false, reason: 'no amount found' });
  await expireOldOrders().catch(() => {});
  const r = await pool.query(
    `SELECT * FROM payments WHERE station_id = $1 AND status = 'waiting' AND pay_amount = ANY($2::numeric[]) ORDER BY id DESC LIMIT 1`,
    [station.id, amounts]);
  const o = r.rows[0];
  if (!o) return res.json({ ok: true, matched: false, reason: 'no waiting order with that amount' });
  const ok = await markPaid(o, 'auto');
  lastNotify.matched = ok; lastNotify.orderId = o.id;
  res.json({ ok: true, matched: ok, orderId: o.id });
});

async function ownerStation(req, res) {
  const station = await getMainStation();
  if (!station) { res.status(404).json({ error: 'no station found' }); return null; }
  if (station.user_id !== req.userId) { res.status(403).json({ error: 'only the station owner can do this' }); return null; }
  return station;
}

// Owner: recent orders + the MacroDroid link.
router.get('/pay/owner', requireUser, async (req, res) => {
  const station = await ownerStation(req, res); if (!station) return;
  let key = station.notify_key;
  if (!key) {
    key = crypto.randomBytes(10).toString('hex');
    await pool.query('UPDATE stations SET notify_key = $1 WHERE id = $2', [key, station.id]);
    mainStationCache = null;
  }
  await expireOldOrders().catch(() => {});
  const r = await pool.query('SELECT * FROM payments WHERE station_id = $1 ORDER BY id DESC LIMIT 12', [station.id]);
  const host = `${req.headers['x-forwarded-proto'] || req.protocol}://${req.get('host')}`;
  res.json({
    notifyUrl: `${host}/api/pay/notify?key=${key}`,
    payUrl: `${host}/pay.html`,
    upiId: UPI_ID,
    lastNotify: lastNotify ? { ...lastNotify, ageMs: Date.now() - lastNotify.at } : null,
    orders: r.rows.map(o => ({ id: o.id, status: o.status, baseAmount: Number(o.base_amount), payAmount: Number(o.pay_amount),
      source: o.source, finalBill: o.final_bill, createdAt: o.created_at }))
  });
});

// Owner: "I got the money" -> start.
router.post('/pay/:id/confirm', requireUser, async (req, res) => {
  const station = await ownerStation(req, res); if (!station) return;
  const r = await pool.query('SELECT * FROM payments WHERE id = $1 AND station_id = $2', [Number(req.params.id), station.id]);
  const o = r.rows[0];
  if (!o) return res.status(404).json({ error: 'order not found' });
  if (o.status !== 'waiting') return res.status(409).json({ error: `Order is already ${o.status}.` });
  const ok = await markPaid(o, 'manual');
  res.json({ ok });
});

router.post('/pay/:id/cancel', requireUser, async (req, res) => {
  const station = await ownerStation(req, res); if (!station) return;
  await pool.query(`UPDATE payments SET status = 'cancelled' WHERE id = $1 AND station_id = $2 AND status = 'waiting'`, [Number(req.params.id), station.id]);
  res.json({ ok: true });
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
