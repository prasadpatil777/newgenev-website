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

