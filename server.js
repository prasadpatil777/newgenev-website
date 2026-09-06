require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const telemetryRoutes = require('./routes/telemetry');
const sessionRoutes = require('./routes/sessions');
const bookingRoutes = require('./routes/bookings');
const { db } = require('./db/init');

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
  db.prepare(`
    UPDATE bookings SET status = 'expired'
    WHERE status = 'booked' AND datetime(slot_start, '+15 minutes') < datetime('now')
  `).run();
}, 60000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`NEW GEN EV backend running on http://localhost:${PORT}`);
});
