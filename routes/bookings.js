const express = require('express');
const { db } = require('../db/init');
const { requireUser } = require('../middleware/auth');

const router = express.Router();

const CHECKIN_GRACE_MIN = 15;   // minutes after slot start before an unclaimed booking auto-releases
const MIN_DURATION_MIN = 15;
const MAX_DURATION_MIN = 180;

// Any booking whose 15-minute grace window has passed without a check-in
// gets marked 'expired', freeing the slot for anyone else. Called at the
// top of every booking route so it's always up to date - no separate
// background job needed.
function expireStaleBookings() {
  db.prepare(`
    UPDATE bookings SET status = 'expired'
    WHERE status = 'booked'
      AND datetime(slot_start, '+${CHECKIN_GRACE_MIN} minutes') < datetime('now')
  `).run();
}

function getUserStation(userId) {
  return db.prepare('SELECT * FROM stations WHERE user_id = ? ORDER BY id LIMIT 1').get(userId);
}

// List all non-cancelled/expired bookings for a station within a date range,
// used both to show availability and to check for overlaps.
function activeBookingsForStation(stationId) {
  return db.prepare(
    `SELECT * FROM bookings WHERE station_id = ? AND status IN ('booked','active')
     AND datetime(slot_end) > datetime('now')`
  ).all(stationId);
}

// GET /api/bookings/availability?stationId=1&date=2026-09-06
// Returns existing booked/active slots for that station+date, so the
// frontend can grey out taken times.
router.get('/bookings/availability', requireUser, (req, res) => {
  expireStaleBookings();
  const stationId = Number(req.query.stationId);
  const date = req.query.date; // 'YYYY-MM-DD'
  if (!stationId || !date) return res.status(400).json({ error: 'stationId and date are required' });

  const rows = db.prepare(
    `SELECT slot_start, slot_end, status FROM bookings
     WHERE station_id = ? AND status IN ('booked','active') AND date(slot_start) = date(?)`
  ).all(stationId, date);
  res.json({ taken: rows });
});

// POST /api/bookings  { stationId, slotStart, durationMin }
router.post('/bookings', requireUser, (req, res) => {
  expireStaleBookings();
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

  const station = db.prepare('SELECT * FROM stations WHERE id = ?').get(stationId);
  if (!station) return res.status(404).json({ error: 'station not found' });

  const overlap = db.prepare(
    `SELECT id FROM bookings WHERE station_id = ? AND status IN ('booked','active')
     AND datetime(?) < datetime(slot_end) AND datetime(?) > datetime(slot_start)`
  ).get(stationId, start.toISOString(), end.toISOString());
  if (overlap) return res.status(409).json({ error: 'this slot overlaps an existing booking' });

  const info = db.prepare(
    'INSERT INTO bookings (station_id, user_id, slot_start, slot_end, status) VALUES (?,?,?,?,\'booked\')'
  ).run(stationId, req.userId, start.toISOString(), end.toISOString());

  res.json({ id: info.lastInsertRowid, slotStart: start.toISOString(), slotEnd: end.toISOString() });
});

// GET /api/bookings - the logged-in user's own bookings (upcoming + recent)
router.get('/bookings', requireUser, (req, res) => {
  expireStaleBookings();
  const rows = db.prepare(
    `SELECT b.*, s.name as station_name FROM bookings b
     JOIN stations s ON s.id = b.station_id
     WHERE b.user_id = ? ORDER BY b.slot_start DESC LIMIT 50`
  ).all(req.userId);
  res.json({ bookings: rows, checkinGraceMin: CHECKIN_GRACE_MIN });
});

// POST /api/bookings/:id/checkin - consumer confirms they've arrived and are using the slot.
// Only allowed from slot_start up to the grace-period cutoff.
router.post('/bookings/:id/checkin', requireUser, (req, res) => {
  expireStaleBookings();
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
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

  db.prepare("UPDATE bookings SET status='active' WHERE id = ?").run(booking.id);
  res.json({ ok: true });
});

// POST /api/bookings/:id/cancel
router.post('/bookings/:id/cancel', requireUser, (req, res) => {
  const booking = db.prepare('SELECT * FROM bookings WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!booking) return res.status(404).json({ error: 'booking not found' });
  if (!['booked', 'active'].includes(booking.status)) {
    return res.status(409).json({ error: `booking is already ${booking.status}` });
  }
  db.prepare("UPDATE bookings SET status='cancelled' WHERE id = ?").run(booking.id);
  res.json({ ok: true });
});

module.exports = router;
