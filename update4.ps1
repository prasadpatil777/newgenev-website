@'
const Auth = {
  getToken(){ return localStorage.getItem('ev_token'); },
  setSession(token, user){
    localStorage.setItem('ev_token', token);
    if(user) localStorage.setItem('ev_user', JSON.stringify(user));
  },
  getUser(){
    try{ return JSON.parse(localStorage.getItem('ev_user')||'null'); }catch(e){ return null; }
  },
  logout(){
    localStorage.removeItem('ev_token');
    localStorage.removeItem('ev_user');
    location.href='/login.html';
  },
  requireAuth(){
    if(!this.getToken()){ location.href='/login.html'; }
  }
};

async function api(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers||{});
  const token = Auth.getToken();
  if(token) headers['Authorization'] = 'Bearer ' + token;
  const res = await fetch('/api'+path, Object.assign({}, opts, {headers}));
  const data = await res.json().catch(()=>({}));
  if(!res.ok){
    if(res.status===401){ Auth.logout(); }
    throw new Error(data.error || 'request failed');
  }
  return data;
}

function paintUserChip(){
  const el = document.getElementById('userChip');
  const u = Auth.getUser();
  if(el && u) el.textContent = u.name;
}

// Shows a small red badge with an unread count next to the "Book a slot"
// nav link, on every page that has that link, if the logged-in user owns
// a station with unseen bookings. No per-page markup needed.
async function initBookingBadge(){
  if(!Auth.getToken()) return;
  const link = document.querySelector('a[href="/booking.html"]');
  if(!link) return;

  let badge = document.createElement('span');
  badge.style.cssText = 'display:inline-block;min-width:16px;height:16px;padding:0 4px;margin-left:5px;border-radius:8px;background:#ff6161;color:#fff;font-size:10px;line-height:16px;text-align:center;font-weight:700;vertical-align:2px;';
  badge.style.display = 'none';
  link.appendChild(badge);

  async function poll(){
    try{
      const data = await api('/bookings/owner/unread-count');
      if(data.count > 0){
        badge.textContent = data.count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }catch(e){ /* not a station owner, or not logged in yet - ignore */ }
  }
  poll();
  setInterval(poll, 15000);
}
initBookingBadge();

// Adds an "About" nav link (team + contact info) to every page's navbar
// that doesn't already have one, so we don't need to edit each page.
function initAboutLink(){
  const nav = document.querySelector('.navlinks');
  if(!nav) return;
  if(nav.querySelector('a[href="/about.html"]')) return;

  const link = document.createElement('a');
  link.href = '/about.html';
  link.textContent = 'About';
  if(location.pathname === '/about.html') link.className = 'active';

  const userChip = document.getElementById('userChip');
  if(userChip) nav.insertBefore(link, userChip);
  else nav.appendChild(link);
}
initAboutLink();

'@ | Set-Content -Path "public/app.js" -Encoding UTF8

@'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About - NEW GEN EV</title>
<link rel="stylesheet" href="/style.css">
<style>
.abouthero{
  background: radial-gradient(120% 160% at 50% 0%, rgba(255,181,71,.10), transparent 60%),
              linear-gradient(160deg, var(--panel-2), var(--panel));
  border:1px solid var(--line); border-radius:16px; padding:0; margin-top:22px; overflow:hidden;
  display:flex; align-items:center; justify-content:center;
}
.abouthero svg{width:100%;max-width:640px;height:auto;display:block}
.abouttitle{text-align:center;margin-top:26px}
.abouttitle h1{font-size:26px;margin:0 0 8px}
.abouttitle p{color:var(--muted);font-size:14px;max-width:520px;margin:0 auto}

.contactcard{
  display:flex;align-items:center;gap:18px;background:var(--panel);border:1px solid var(--line);
  border-radius:14px;padding:22px 26px;margin-top:24px;flex-wrap:wrap;
}
.contactavatar{
  width:56px;height:56px;border-radius:50%;background:linear-gradient(150deg,var(--amber),#ff8a3d);
  display:flex;align-items:center;justify-content:center;font-weight:800;font-size:20px;color:#241300;flex-shrink:0;
}
.contactinfo b{font-size:16px}
.contactinfo .role{color:var(--muted);font-size:13px;margin-top:2px}
.contactlinks{display:flex;gap:10px;margin-left:auto;flex-wrap:wrap}
.contactlinks a{
  background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:9px 16px;border-radius:8px;
  text-decoration:none;font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:6px;
}
.contactlinks a:hover{border-color:var(--amber)}

.teamgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
@media(max-width:780px){.teamgrid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.teamgrid{grid-template-columns:1fr}}
.teamcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:20px;text-align:center}
.teamcard.leader{border-color:var(--amber);background:linear-gradient(160deg,var(--panel-2),var(--panel))}
.teamavatar{
  width:56px;height:56px;border-radius:50%;margin:0 auto 12px;display:flex;align-items:center;justify-content:center;
  font-weight:800;font-size:18px;background:var(--panel-2);border:1px solid var(--line);color:var(--teal);
}
.teamcard.leader .teamavatar{background:linear-gradient(150deg,var(--amber),#ff8a3d);color:#241300;border:none}
.teamname{font-weight:700;font-size:14.5px}
.teamrole{color:var(--muted);font-size:12px;margin-top:4px}
.leadertag{
  display:inline-block;margin-top:8px;font-size:10.5px;font-weight:700;letter-spacing:.4px;
  color:var(--amber);background:rgba(255,181,71,.14);padding:3px 10px;border-radius:20px;
}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand"><div class="bolt">⚡</div>NEW GEN EV</div>
    <div class="navlinks">
      <a href="/dashboard.html">Dashboard</a>
      <a href="/history.html">History</a>
      <a href="/booking.html">Book a slot</a>
      <a href="/about.html" class="active">About</a>
      <span id="userChip" style="color:var(--text)"></span>
    </div>
    <button class="logout" onclick="Auth.logout()">Log out</button>
  </div>

  <div class="abouttitle" style="margin-top:26px">
    <h1>Powering the next generation of EVs</h1>
    <p>NEW GEN EV is a real-time, RFID-based smart charging station — built end to end, from the hardware to this dashboard.</p>
  </div>

  <div class="abouthero">
    <svg viewBox="0 0 640 360" role="img" aria-label="Illustration of an EV charging pedestal">
      <defs>
        <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffb547" stop-opacity="0.30"/>
          <stop offset="100%" stop-color="#ffb547" stop-opacity="0"/>
        </radialGradient>
        <linearGradient id="pedGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#232b31"/>
          <stop offset="100%" stop-color="#171d21"/>
        </linearGradient>
      </defs>
      <g opacity="0.12" stroke="#3a4650" stroke-width="1">
        <line x1="0" y1="60" x2="640" y2="60"/><line x1="0" y1="120" x2="640" y2="120"/>
        <line x1="0" y1="180" x2="640" y2="180"/><line x1="0" y1="240" x2="640" y2="240"/>
        <line x1="0" y1="300" x2="640" y2="300"/>
        <line x1="80" y1="0" x2="80" y2="360"/><line x1="160" y1="0" x2="160" y2="360"/>
        <line x1="240" y1="0" x2="240" y2="360"/><line x1="320" y1="0" x2="320" y2="360"/>
        <line x1="400" y1="0" x2="400" y2="360"/><line x1="480" y1="0" x2="480" y2="360"/>
        <line x1="560" y1="0" x2="560" y2="360"/>
      </g>
      <circle cx="320" cy="190" r="170" fill="url(#glow2)"/>
      <ellipse cx="320" cy="190" rx="130" ry="55" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.25"/>
      <ellipse cx="320" cy="190" rx="130" ry="55" fill="none" stroke="#ffb547" stroke-width="1" stroke-dasharray="4 5" opacity="0.2" transform="rotate(60 320 190)"/>
      <ellipse cx="320" cy="190" rx="130" ry="55" fill="none" stroke="#33d9b2" stroke-width="1" stroke-dasharray="4 5" opacity="0.2" transform="rotate(120 320 190)"/>

      <circle cx="120" cy="90" r="3" fill="#ffb547" opacity="0.55"/>
      <circle cx="530" cy="110" r="2.4" fill="#33d9b2" opacity="0.5"/>
      <circle cx="550" cy="290" r="3" fill="#33d9b2" opacity="0.4"/>
      <circle cx="90" cy="280" r="2.4" fill="#ffb547" opacity="0.45"/>

      <rect x="270" y="110" width="100" height="220" rx="14" fill="url(#pedGrad)" stroke="#2a3238" stroke-width="1.5"/>
      <rect x="285" y="130" width="70" height="46" rx="6" fill="#0b3d0b" stroke="#1a5c1a"/>
      <text x="320" y="159" text-anchor="middle" fill="#8fce8f" font-family="monospace" font-size="14" font-weight="bold">READY</text>
      <path d="M330,195 L308,240 L322,240 L312,275 L342,228 L326,228 Z" fill="#ffb547"/>
      <circle cx="320" cy="300" r="10" fill="none" stroke="#33d9b2" stroke-width="2"/>
      <circle cx="320" cy="300" r="3" fill="#33d9b2"/>

      <path d="M270,250 C230,260 210,220 175,235" fill="none" stroke="#33d9b2" stroke-width="4" stroke-linecap="round"/>
      <circle cx="270" cy="250" r="4.5" fill="#33d9b2"/>
      <circle cx="175" cy="235" r="4.5" fill="#33d9b2"/>
      <circle cx="150" cy="238" r="14" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
    </svg>
  </div>

  <div class="section-title">Contact support</div>
  <div class="contactcard">
    <div class="contactavatar">PP</div>
    <div class="contactinfo">
      <div><b>Prasad Patil</b></div>
      <div class="role">Charging Station Owner</div>
    </div>
    <div class="contactlinks">
      <a href="tel:+917410722330">📞 +91 74107 22330</a>
      <a href="https://wa.me/917410722330" target="_blank" rel="noopener">💬 WhatsApp</a>
    </div>
  </div>

  <div class="section-title">Our team</div>
  <div class="teamgrid">
    <div class="teamcard leader">
      <div class="teamavatar">PP</div>
      <div class="teamname">Prasad Patil</div>
      <div class="teamrole">Project Leader</div>
      <div class="leadertag">TEAM LEADER</div>
    </div>
    <div class="teamcard">
      <div class="teamavatar">NP</div>
      <div class="teamname">Niharika Patil</div>
      <div class="teamrole">Team Member</div>
    </div>
    <div class="teamcard">
      <div class="teamavatar">OA</div>
      <div class="teamname">Om Alhat</div>
      <div class="teamrole">Team Member</div>
    </div>
    <div class="teamcard">
      <div class="teamavatar">YT</div>
      <div class="teamname">Yash Thakare</div>
      <div class="teamrole">Team Member</div>
    </div>
    <div class="teamcard">
      <div class="teamavatar">AL</div>
      <div class="teamname">Aaditya Limbalkar</div>
      <div class="teamrole">Team Member</div>
    </div>
    <div class="teamcard">
      <div class="teamavatar">VK</div>
      <div class="teamname">Vedant Kambale</div>
      <div class="teamrole">Team Member</div>
    </div>
  </div>

  <div style="height:40px"></div>
</div>
<script src="/app.js"></script>
<script>Auth.requireAuth(); paintUserChip();</script>
</body>
</html>

'@ | Set-Content -Path "public/about.html" -Encoding UTF8

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
  const isOnline = latest && (Date.now() - new Date(latest.received_at).getTime()) < 3000;

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
