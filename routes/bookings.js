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

