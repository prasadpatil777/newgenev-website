@'
{
  "name": "ev-backend",
  "version": "1.0.0",
  "description": "",
  "main": "index.js",
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "keywords": [],
  "author": "",
  "license": "ISC",
  "dependencies": {
    "bcryptjs": "^3.0.3",
    "cors": "^2.8.6",
    "dotenv": "^17.4.2",
    "express": "^5.2.1",
    "jsonwebtoken": "^9.0.3",
    "pg": "^8.23.0"
  }
}

'@ | Set-Content -Path "package.json" -Encoding UTF8

@'
// Postgres database setup, using a real persistent database (e.g. Neon)
// instead of the local SQLite file. This survives Render redeploys, unlike
// SQLite on Render's free tier (whose disk is wiped on every deploy).

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && !process.env.DATABASE_URL.includes('localhost')
    ? { rejectUnauthorized: false }
    : false
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS stations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      name TEXT NOT NULL,
      api_key TEXT UNIQUE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      state TEXT, relay INTEGER, meter_online INTEGER, dht_online INTEGER,
      voltage REAL, current REAL, power REAL, pf REAL, hz REAL,
      kwh REAL, session_wh REAL, temp REAL, hum REAL,
      time_sec INTEGER, emergency INTEGER,
      received_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      duration_sec INTEGER,
      units REAL,
      bill REAL,
      ended_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      station_id INTEGER NOT NULL REFERENCES stations(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      slot_start TIMESTAMPTZ NOT NULL,
      slot_end TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'booked',
      seen INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_bookings_station ON bookings(station_id, slot_start);
    CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, slot_start);
    CREATE INDEX IF NOT EXISTS idx_telemetry_station ON telemetry(station_id, received_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_station ON sessions(station_id, ended_at);
  `);
}

function newApiKey() {
  return 'ev_' + crypto.randomBytes(16).toString('hex');
}

module.exports = { pool, initSchema, newApiKey };

'@ | Set-Content -Path "db/init.js" -Encoding UTF8

@'
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

'@ | Set-Content -Path "routes/auth.js" -Encoding UTF8

@'
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
  const isOnline = latest && (Date.now() - new Date(latest.received_at).getTime()) < 10000;

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

'@ | Set-Content -Path "routes/telemetry.js" -Encoding UTF8

@'
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

'@ | Set-Content -Path "routes/sessions.js" -Encoding UTF8

@'
const express = require('express');
const { pool } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

const CHECKIN_GRACE_MIN = 15;
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 180;

async function expireStaleBookings() {
  await pool.query(
    `UPDATE bookings SET status = 'expired'
     WHERE status = 'booked' AND slot_start + interval '${CHECKIN_GRACE_MIN} minutes' < now()`
  );
}

router.get('/bookings/availability', requireUser, async (req, res) => {
  await expireStaleBookings();
  const stationId = Number(req.query.stationId);
  const date = req.query.date;
  if (!stationId || !date) return res.status(400).json({ error: 'stationId and date are required' });

  const result = await pool.query(
    `SELECT slot_start, slot_end, status FROM bookings
     WHERE station_id = $1 AND status IN ('booked','active') AND slot_start::date = $2::date`,
    [stationId, date]
  );
  res.json({ taken: result.rows });
});

router.post('/bookings', requireUser, async (req, res) => {
  await expireStaleBookings();
  const { stationId, slotStart, durationMin } = req.body || {};
  const dur = Number(durationMin);

  if (!stationId || !slotStart || !dur) {
    return res.status(400).json({ error: 'stationId, slotStart and durationMin are required' });
  }
  if (dur < MIN_DURATION_MIN || dur > MAX_DURATION_MIN) {
    return res.status(400).json({ error: `duration must be between ${MIN_DURATION_MIN} and ${MAX_DURATION_MIN} minutes` });
  }

  const start = new Date(slotStart);
  if (isNaN(start.getTime())) return res.status(400).json({ error: 'invalid slotStart' });
  if (start.getTime() < Date.now() - 60000) {
    return res.status(400).json({ error: 'cannot book a slot in the past' });
  }
  const end = new Date(start.getTime() + dur * 60000);

  const stationResult = await pool.query('SELECT * FROM stations WHERE id = $1', [stationId]);
  if (!stationResult.rows[0]) return res.status(404).json({ error: 'station not found' });

  const overlapResult = await pool.query(
    `SELECT id FROM bookings WHERE station_id = $1 AND status IN ('booked','active')
     AND $2::timestamptz < slot_end AND $3::timestamptz > slot_start`,
    [stationId, start.toISOString(), end.toISOString()]
  );
  if (overlapResult.rows[0]) return res.status(409).json({ error: 'this slot overlaps an existing booking' });

  const info = await pool.query(
    `INSERT INTO bookings (station_id, user_id, slot_start, slot_end, status) VALUES ($1,$2,$3,$4,'booked') RETURNING id`,
    [stationId, req.userId, start.toISOString(), end.toISOString()]
  );

  res.json({ id: info.rows[0].id, slotStart: start.toISOString(), slotEnd: end.toISOString() });
});

router.get('/bookings', requireUser, async (req, res) => {
  await expireStaleBookings();
  const result = await pool.query(
    `SELECT b.*, s.name as station_name FROM bookings b
     JOIN stations s ON s.id = b.station_id
     WHERE b.user_id = $1 ORDER BY b.slot_start DESC LIMIT 50`,
    [req.userId]
  );
  res.json({ bookings: result.rows, checkinGraceMin: CHECKIN_GRACE_MIN });
});

router.post('/bookings/:id/checkin', requireUser, async (req, res) => {
  await expireStaleBookings();
  const result = await pool.query('SELECT * FROM bookings WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  const booking = result.rows[0];
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (booking.status !== 'booked') return res.status(409).json({ error: `booking is ${booking.status}, cannot check in` });

  const slotStartMs = new Date(booking.slot_start).getTime();
  const graceEndMs = slotStartMs + CHECKIN_GRACE_MIN * 60000;
  const now = Date.now();
  if (now < slotStartMs) {
    return res.status(409).json({ error: `too early - check-in opens at ${new Date(slotStartMs).toLocaleTimeString()}` });
  }
  if (now > graceEndMs) {
    return res.status(409).json({ error: 'check-in window has passed, this slot has expired' });
  }

  await pool.query("UPDATE bookings SET status='active' WHERE id = $1", [booking.id]);
  res.json({ ok: true });
});

router.post('/bookings/:id/cancel', requireUser, async (req, res) => {
  const result = await pool.query('SELECT * FROM bookings WHERE id = $1 AND user_id = $2', [req.params.id, req.userId]);
  const booking = result.rows[0];
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (!['booked', 'active'].includes(booking.status)) {
    return res.status(409).json({ error: `booking is already ${booking.status}` });
  }
  await pool.query("UPDATE bookings SET status='cancelled' WHERE id = $1", [booking.id]);
  res.json({ ok: true });
});

router.get('/bookings/owner', requireUser, async (req, res) => {
  await expireStaleBookings();
  const result = await pool.query(
    `SELECT b.*, s.name as station_name, u.name as booker_name, u.email as booker_email
     FROM bookings b
     JOIN stations s ON s.id = b.station_id
     JOIN users u ON u.id = b.user_id
     WHERE s.user_id = $1
     ORDER BY b.slot_start DESC LIMIT 100`,
    [req.userId]
  );

  await pool.query(
    `UPDATE bookings SET seen = 1 WHERE station_id IN (SELECT id FROM stations WHERE user_id = $1)`,
    [req.userId]
  );

  res.json({ bookings: result.rows, checkinGraceMin: CHECKIN_GRACE_MIN });
});

router.get('/bookings/owner/stats', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT COUNT(*) as "totalBookings", COUNT(DISTINCT user_id) as "uniqueCustomers"
     FROM bookings WHERE station_id IN (SELECT id FROM stations WHERE user_id = $1)`,
    [req.userId]
  );
  const row = result.rows[0];
  res.json({ totalBookings: Number(row.totalBookings), uniqueCustomers: Number(row.uniqueCustomers) });
});

router.get('/bookings/owner/unread-count', requireUser, async (req, res) => {
  await expireStaleBookings();
  const result = await pool.query(
    `SELECT COUNT(*) as count FROM bookings
     WHERE seen = 0 AND station_id IN (SELECT id FROM stations WHERE user_id = $1)`,
    [req.userId]
  );
  res.json({ count: Number(result.rows[0].count) });
});

router.get('/stations/:id/public', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.name, u.email as owner_email FROM stations s
     JOIN users u ON u.id = s.user_id WHERE s.id = $1`,
    [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'station not found' });
  res.json({ station: result.rows[0] });
});

router.get('/stations/main', requireUser, async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.name, u.email as owner_email FROM stations s
     JOIN users u ON u.id = s.user_id ORDER BY s.id LIMIT 1`
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'no station exists yet' });
  res.json({ station: result.rows[0] });
});

module.exports = router;

'@ | Set-Content -Path "routes/bookings.js" -Encoding UTF8

@'
require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const telemetryRoutes = require('./routes/telemetry');
const sessionRoutes = require('./routes/sessions');
const bookingRoutes = require('./routes/bookings');
const { pool, initSchema } = require('./db/init');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api', telemetryRoutes);
app.use('/api', sessionRoutes);
app.use('/api', bookingRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Auto-release bookings whose 15-minute check-in window has passed,
// even if nobody happens to hit a booking API route in the meantime.
setInterval(() => {
  pool.query(`
    UPDATE bookings SET status = 'expired'
    WHERE status = 'booked' AND slot_start + interval '15 minutes' < now()
  `).catch(err => console.error('auto-expire error:', err.message));
}, 60000);

const PORT = process.env.PORT || 3000;

initSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`NEW GEN EV backend running on http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to initialize database schema:', err.message);
    process.exit(1);
  });

'@ | Set-Content -Path "server.js" -Encoding UTF8

@'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in - NEW GEN EV</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="authshell">
  <div class="authhero">
    <svg viewBox="0 0 480 560" role="img" aria-label="Illustration of an electric vehicle charging">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffb547" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#ffb547" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="carGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#33d9b2" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#33d9b2" stop-opacity="0.05"/>
        </linearGradient>
      </defs>

      <g opacity="0.14" stroke="#3a4650" stroke-width="1">
        <line x1="0" y1="80" x2="480" y2="80"/>
        <line x1="0" y1="160" x2="480" y2="160"/>
        <line x1="0" y1="240" x2="480" y2="240"/>
        <line x1="0" y1="320" x2="480" y2="320"/>
        <line x1="0" y1="400" x2="480" y2="400"/>
        <line x1="0" y1="480" x2="480" y2="480"/>
        <line x1="80" y1="0" x2="80" y2="560"/>
        <line x1="160" y1="0" x2="160" y2="560"/>
        <line x1="240" y1="0" x2="240" y2="560"/>
        <line x1="320" y1="0" x2="320" y2="560"/>
        <line x1="400" y1="0" x2="400" y2="560"/>
      </g>

      <circle cx="385" cy="350" r="190" fill="url(#glow)"/>

      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.3"/>
      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.3" transform="rotate(60 385 350)"/>
      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#ffb547" stroke-width="1" stroke-dasharray="4 5" opacity="0.22" transform="rotate(120 385 350)"/>

      <circle cx="80" cy="150" r="3" fill="#ffb547" opacity="0.6"/>
      <circle cx="410" cy="120" r="2.4" fill="#33d9b2" opacity="0.55"/>
      <circle cx="425" cy="470" r="3" fill="#33d9b2" opacity="0.45"/>
      <circle cx="55" cy="470" r="2.4" fill="#ffb547" opacity="0.5"/>
      <circle cx="250" cy="70" r="2.6" fill="#33d9b2" opacity="0.5"/>
      <circle cx="140" cy="480" r="2" fill="#ffb547" opacity="0.4"/>

      <path d="M60,400 Q60,360 100,355 L140,320 Q160,305 190,305 L258,305 Q288,305 303,325 L328,355 Q344,360 344,400 Q344,415 328,415 L308,415 Q303,435 283,435 Q263,435 258,415 L150,415 Q145,435 125,435 Q105,435 100,415 L75,415 Q60,415 60,400 Z"
            fill="url(#carGrad)" stroke="#33d9b2" stroke-width="2"/>
      <path d="M152,322 L186,309 Q196,306 206,306 L253,306 Q268,307 278,316 L296,330 Z"
            fill="#33d9b2" opacity="0.16" stroke="#33d9b2" stroke-width="1.2"/>

      <circle cx="112" cy="415" r="21" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
      <circle cx="112" cy="415" r="7" fill="#33d9b2" opacity="0.7"/>
      <circle cx="296" cy="415" r="21" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
      <circle cx="296" cy="415" r="7" fill="#33d9b2" opacity="0.7"/>

      <path d="M332,378 C350,360 356,398 373,383" fill="none" stroke="#ffb547" stroke-width="4" stroke-linecap="round"/>
      <circle cx="332" cy="378" r="4.5" fill="#ffb547"/>
      <circle cx="373" cy="383" r="4.5" fill="#ffb547"/>

      <rect x="364" y="300" width="42" height="145" rx="9" fill="#1a2025" stroke="#2a3238" stroke-width="1.5"/>
      <path d="M390,315 L376,352 L388,352 L382,382 L403,340 L390,340 Z" fill="#ffb547"/>
    </svg>
  </div>
  <div class="authformside">
    <div class="authcard">
      <div class="brand" style="margin-bottom:22px"><div class="bolt">⚡</div>NEW GEN EV</div>
      <h1>Sign in</h1>
      <p class="sub">Monitor your charging station in real time.</p>

      <form id="form">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email">
        <label for="password">Password</label>
        <input id="password" type="password" required autocomplete="current-password">
        <button class="btn" type="submit">Sign in</button>
      </form>
      <div class="err" id="err"></div>
      <div class="switchline">No account yet? <a href="/register.html" style="color:var(--amber)">Create one</a></div>
    </div>
  </div>
</div>
<script src="/app.js"></script>
<script>
document.getElementById('form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const errEl = document.getElementById('err');
  errEl.style.display='none';
  try{
    const data = await api('/auth/login', {
      method:'POST',
      body: JSON.stringify({
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    Auth.setSession(data.token, data.user);
    location.href = '/dashboard.html';
  }catch(e){
    errEl.textContent = e.message;
    errEl.style.display='block';
  }
});
</script>
</body>
</html>

'@ | Set-Content -Path "public/login.html" -Encoding UTF8

@'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Create account - NEW GEN EV</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<div class="authshell">
  <div class="authhero">
    <svg viewBox="0 0 480 560" role="img" aria-label="Illustration of an electric vehicle charging">
      <defs>
        <radialGradient id="glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffb547" stop-opacity="0.35"/>
          <stop offset="100%" stop-color="#ffb547" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="carGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#33d9b2" stop-opacity="0.22"/>
          <stop offset="100%" stop-color="#33d9b2" stop-opacity="0.05"/>
        </linearGradient>
      </defs>

      <g opacity="0.14" stroke="#3a4650" stroke-width="1">
        <line x1="0" y1="80" x2="480" y2="80"/>
        <line x1="0" y1="160" x2="480" y2="160"/>
        <line x1="0" y1="240" x2="480" y2="240"/>
        <line x1="0" y1="320" x2="480" y2="320"/>
        <line x1="0" y1="400" x2="480" y2="400"/>
        <line x1="0" y1="480" x2="480" y2="480"/>
        <line x1="80" y1="0" x2="80" y2="560"/>
        <line x1="160" y1="0" x2="160" y2="560"/>
        <line x1="240" y1="0" x2="240" y2="560"/>
        <line x1="320" y1="0" x2="320" y2="560"/>
        <line x1="400" y1="0" x2="400" y2="560"/>
      </g>

      <circle cx="385" cy="350" r="190" fill="url(#glow)"/>

      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.3"/>
      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.3" transform="rotate(60 385 350)"/>
      <ellipse cx="385" cy="350" rx="95" ry="42" fill="none" stroke="#ffb547" stroke-width="1" stroke-dasharray="4 5" opacity="0.22" transform="rotate(120 385 350)"/>

      <circle cx="80" cy="150" r="3" fill="#ffb547" opacity="0.6"/>
      <circle cx="410" cy="120" r="2.4" fill="#33d9b2" opacity="0.55"/>
      <circle cx="425" cy="470" r="3" fill="#33d9b2" opacity="0.45"/>
      <circle cx="55" cy="470" r="2.4" fill="#ffb547" opacity="0.5"/>
      <circle cx="250" cy="70" r="2.6" fill="#33d9b2" opacity="0.5"/>
      <circle cx="140" cy="480" r="2" fill="#ffb547" opacity="0.4"/>

      <path d="M60,400 Q60,360 100,355 L140,320 Q160,305 190,305 L258,305 Q288,305 303,325 L328,355 Q344,360 344,400 Q344,415 328,415 L308,415 Q303,435 283,435 Q263,435 258,415 L150,415 Q145,435 125,435 Q105,435 100,415 L75,415 Q60,415 60,400 Z"
            fill="url(#carGrad)" stroke="#33d9b2" stroke-width="2"/>
      <path d="M152,322 L186,309 Q196,306 206,306 L253,306 Q268,307 278,316 L296,330 Z"
            fill="#33d9b2" opacity="0.16" stroke="#33d9b2" stroke-width="1.2"/>

      <circle cx="112" cy="415" r="21" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
      <circle cx="112" cy="415" r="7" fill="#33d9b2" opacity="0.7"/>
      <circle cx="296" cy="415" r="21" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
      <circle cx="296" cy="415" r="7" fill="#33d9b2" opacity="0.7"/>

      <path d="M332,378 C350,360 356,398 373,383" fill="none" stroke="#ffb547" stroke-width="4" stroke-linecap="round"/>
      <circle cx="332" cy="378" r="4.5" fill="#ffb547"/>
      <circle cx="373" cy="383" r="4.5" fill="#ffb547"/>

      <rect x="364" y="300" width="42" height="145" rx="9" fill="#1a2025" stroke="#2a3238" stroke-width="1.5"/>
      <path d="M390,315 L376,352 L388,352 L382,382 L403,340 L390,340 Z" fill="#ffb547"/>
    </svg>
  </div>
  <div class="authformside">
    <div class="authcard">
      <div class="brand" style="margin-bottom:22px"><div class="bolt">⚡</div>NEW GEN EV</div>
      <h1>Create your account</h1>
      <p class="sub">This also creates your charging station's API key.</p>

      <form id="form">
        <label for="name">Your name</label>
        <input id="name" type="text" required>
        <label for="stationName">Station name</label>
        <input id="stationName" type="text" placeholder="e.g. Hostel Block C Charger" value="My EV Charger">
        <label for="email">Email</label>
        <input id="email" type="email" required autocomplete="email">
        <label for="password">Password</label>
        <input id="password" type="password" required minlength="6" autocomplete="new-password">
        <button class="btn" type="submit">Create account</button>
      </form>
      <div class="err" id="err"></div>
      <div class="switchline">Already have an account? <a href="/login.html" style="color:var(--amber)">Sign in</a></div>
    </div>
  </div>
</div>
<script src="/app.js"></script>
<script>
document.getElementById('form').addEventListener('submit', async (e)=>{
  e.preventDefault();
  const errEl = document.getElementById('err');
  errEl.style.display='none';
  try{
    const data = await api('/auth/register', {
      method:'POST',
      body: JSON.stringify({
        name: document.getElementById('name').value,
        stationName: document.getElementById('stationName').value,
        email: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    Auth.setSession(data.token, data.user);
    alert('Account created!\n\nYour station API key (needed in the ESP32 code):\n\n' + data.stationApiKey + '\n\nYou can also find this later on your dashboard.');
    location.href = '/dashboard.html';
  }catch(e){
    errEl.textContent = e.message;
    errEl.style.display='block';
  }
});
</script>
</body>
</html>

'@ | Set-Content -Path "public/register.html" -Encoding UTF8
