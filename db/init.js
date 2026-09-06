// SQLite database setup using Node's built-in node:sqlite module — no
// native compilation needed (works on any machine with a recent Node.js,
// no Python or Visual Studio build tools required). Creates ev.db in the
// project root on first run.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');

const db = new DatabaseSync(path.join(__dirname, '..', 'ev.db'));
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS stations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  api_key TEXT UNIQUE NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  state TEXT, relay INTEGER, meter_online INTEGER, dht_online INTEGER,
  voltage REAL, current REAL, power REAL, pf REAL, hz REAL,
  kwh REAL, session_wh REAL, temp REAL, hum REAL,
  time_sec INTEGER, emergency INTEGER,
  received_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  duration_sec INTEGER,
  units REAL,
  bill REAL,
  ended_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_id INTEGER NOT NULL REFERENCES stations(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  slot_start TEXT NOT NULL,
  slot_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked',  -- booked | active | expired | cancelled | completed
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_station ON bookings(station_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, slot_start);

CREATE INDEX IF NOT EXISTS idx_telemetry_station ON telemetry(station_id, received_at);
CREATE INDEX IF NOT EXISTS idx_sessions_station ON sessions(station_id, ended_at);
`);

function newApiKey() {
  return 'ev_' + crypto.randomBytes(16).toString('hex');
}

module.exports = { db, newApiKey };
