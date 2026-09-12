@'
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard - NEW GEN EV</title>
<link rel="stylesheet" href="/style.css">
<style>
.hero{
  background: radial-gradient(120% 160% at 0% 0%, rgba(255,181,71,.10), transparent 55%),
              linear-gradient(160deg, var(--panel-2), var(--panel));
  border:1px solid var(--line); border-radius:16px; padding:26px 28px; margin-top:22px;
  display:flex; align-items:center; justify-content:space-between; gap:20px; flex-wrap:wrap;
}
.hero-left{display:flex; align-items:center; gap:16px}
.pulse-dot{width:12px;height:12px;border-radius:50%;background:var(--teal);position:relative;flex-shrink:0}
.pulse-dot.off{background:var(--red)}
.pulse-dot::after{
  content:'';position:absolute;inset:-6px;border-radius:50%;border:2px solid var(--teal);
  animation:pulse 1.8s ease-out infinite;
}
.pulse-dot.off::after{border-color:var(--red); animation:none}
@keyframes pulse{0%{transform:scale(0.6);opacity:1}100%{transform:scale(1.8);opacity:0}}
.hero-state{font-size:28px;font-weight:800;font-family:var(--font-num);letter-spacing:.3px}
.hero-sub{color:var(--muted);font-size:13px;margin-top:3px}
.hero-right{display:flex;gap:28px;text-align:right}
.hero-metric .lbl{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.6px}
.hero-metric .num{font-family:var(--font-num);font-size:22px;font-weight:700;color:var(--amber)}

.icon{width:18px;height:18px;stroke:var(--muted);fill:none;stroke-width:1.8;vertical-align:-4px;margin-right:6px}
.card .lbl{display:flex;align-items:center}

.chartcard{margin-top:16px}
.chartcard canvas{width:100%;height:140px;display:block}
.chart-empty{color:var(--muted);font-size:13px;text-align:center;padding:40px 0}

.visualgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
@media(max-width:780px){.visualgrid{grid-template-columns:1fr}}
.visualcard{background:var(--panel);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.visualsvg{width:100%;height:auto;display:block;background:#0e1216}
.visualcard h3{margin:14px 16px 6px;font-size:14px}
.visualcard p{margin:0 16px 16px;color:var(--muted);font-size:12.5px;line-height:1.6}

.emg-banner{
  display:none; align-items:center; gap:10px; background:rgba(255,97,97,.14); border:1px solid var(--red);
  color:var(--red); font-weight:700; padding:12px 18px; border-radius:10px; margin-top:16px;
}
.emg-banner.show{display:flex}
.emg-dot{width:10px;height:10px;border-radius:50%;background:var(--red);animation:blink 1s step-start infinite}
@keyframes blink{50%{opacity:0}}
</style>
</head>
<body>
<div class="wrap">
  <div class="topbar">
    <div class="brand"><div class="bolt">⚡</div>NEW GEN EV</div>
    <div class="navlinks">
      <a href="/dashboard.html" class="active">Dashboard</a>
      <a href="/history.html">History</a>
      <a href="/booking.html">Book a slot</a>
      <span id="userChip" style="color:var(--text)"></span>
    </div>
    <button class="logout" onclick="Auth.logout()">Log out</button>
  </div>

  <div class="hero">
    <div class="hero-left">
      <span class="pulse-dot off" id="statusDot"></span>
      <div>
        <div class="hero-state" id="stateBig">-</div>
        <div class="hero-sub" id="stationName">Loading station…</div>
      </div>
    </div>
    <div class="hero-right">
      <div class="hero-metric">
        <div class="lbl">Session bill</div>
        <div class="num" id="bill">₹0.00</div>
      </div>
      <div class="hero-metric">
        <div class="lbl">Units used</div>
        <div class="num" id="units">0.000</div>
      </div>
      <div class="hero-metric">
        <div class="lbl">Time</div>
        <div class="num" id="time">0:00</div>
      </div>
    </div>
  </div>

  <div class="emg-banner" id="emgBanner"><span class="emg-dot"></span> EMERGENCY STOP ACTIVE — charging halted</div>

  <div class="grid" style="margin-top:16px">
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" stroke-linejoin="round"/></svg>Voltage</div><div class="val" id="v">0.0<small>V</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>Current</div><div class="val" id="i">0.000<small>A</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>Power</div><div class="val" id="p">0.0<small>W</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 16 0"/><path d="M12 12 16 8"/></svg>Power factor</div><div class="val" id="pf">0.00</div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M3 12h3l2-8 4 16 2-8h7"/></svg>Frequency</div><div class="val" id="hz">0.0<small>Hz</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M12 2v14M8 8l4-4 4 4"/><path d="M5 22h14"/></svg>Total energy</div><div class="val" id="kwh">0.000<small>kWh</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v7.5a4 4 0 1 0 6 0V6a3 3 0 0 0-3-3Z"/></svg>Temperature</div><div class="val" id="temp">0.0<small>°C</small></div></div>
    <div class="card"><div class="lbl"><svg class="icon" viewBox="0 0 24 24"><path d="M6 19V9a6 6 0 0 1 12 0v10M3 19h18"/></svg>Relay</div><div class="val" id="relay">OFF</div></div>
  </div>

  <div class="card chartcard">
    <div class="lbl" style="margin-bottom:10px"><svg class="icon" viewBox="0 0 24 24"><path d="M3 17l5-6 4 4 8-9"/></svg>Power over recent readings</div>
    <canvas id="chart" width="900" height="140"></canvas>
    <div class="chart-empty" id="chartEmpty" style="display:none">No data yet — waiting for the station.</div>
  </div>

  <div class="section-title">Why smart charging matters</div>
  <div class="visualgrid">
    <div class="visualcard">
      <svg viewBox="0 0 200 150" class="visualsvg">
        <defs><radialGradient id="vg1" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#ffb547" stop-opacity=".25"/><stop offset="100%" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>
        <rect width="200" height="150" fill="url(#vg1)"/>
        <path d="M30,105 Q30,85 48,82 L66,64 Q76,56 90,56 L122,56 Q136,56 143,66 L155,82 Q163,84 163,105 Q163,113 155,113 L146,113 Q143,123 132,123 Q121,123 118,113 L74,113 Q71,123 60,123 Q49,123 46,113 L38,113 Q30,113 30,105 Z" fill="rgba(51,217,178,.15)" stroke="#33d9b2" stroke-width="2"/>
        <circle cx="58" cy="113" r="9" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
        <circle cx="135" cy="113" r="9" fill="#12161a" stroke="#33d9b2" stroke-width="2"/>
        <path d="M156,95 C165,87 168,102 177,95" fill="none" stroke="#ffb547" stroke-width="3" stroke-linecap="round"/>
        <circle cx="177" cy="95" r="4" fill="#ffb547"/>
      </svg>
      <h3>Fast, efficient charging</h3>
      <p>Real meter readings mean your charge time is based on actual power delivered, not guesswork.</p>
    </div>
    <div class="visualcard">
      <svg viewBox="0 0 200 150" class="visualsvg">
        <defs><radialGradient id="vg2" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#33d9b2" stop-opacity=".25"/><stop offset="100%" stop-color="#33d9b2" stop-opacity="0"/></radialGradient></defs>
        <rect width="200" height="150" fill="url(#vg2)"/>
        <path d="M100,35 C130,55 130,95 100,120 C70,95 70,55 100,35 Z" fill="rgba(51,217,178,.15)" stroke="#33d9b2" stroke-width="2"/>
        <path d="M100,55 L88,90 L100,90 L94,112 L116,78 L102,78 Z" fill="#ffb547"/>
        <path d="M60,120 Q100,135 140,120" fill="none" stroke="#33d9b2" stroke-width="2" opacity=".5"/>
      </svg>
      <h3>Cleaner energy</h3>
      <p>Every session moves you further from fossil fuels — track your usage and your impact together.</p>
    </div>
    <div class="visualcard">
      <svg viewBox="0 0 200 150" class="visualsvg">
        <defs><radialGradient id="vg3" cx="50%" cy="40%" r="60%"><stop offset="0%" stop-color="#ffb547" stop-opacity=".25"/><stop offset="100%" stop-color="#ffb547" stop-opacity="0"/></radialGradient></defs>
        <rect width="200" height="150" fill="url(#vg3)"/>
        <circle cx="100" cy="80" r="42" fill="none" stroke="#33d9b2" stroke-width="2"/>
        <circle cx="100" cy="80" r="3" fill="#ffb547"/>
        <line x1="100" y1="80" x2="100" y2="50" stroke="#ffb547" stroke-width="3" stroke-linecap="round"/>
        <line x1="100" y1="80" x2="122" y2="92" stroke="#33d9b2" stroke-width="3" stroke-linecap="round"/>
        <text x="100" y="135" text-anchor="middle" fill="#33d9b2" font-family="monospace" font-size="11">24/7 MONITORING</text>
      </svg>
      <h3>Always watching</h3>
      <p>Live status and emergency alerts, so you always know exactly what's happening at the station.</p>
    </div>
  </div>

  <div class="section-title">Your station's API key</div>
  <p class="hint">Put this in your ESP32 code so it can send data here. Keep it private.</p>
  <div class="card" style="margin-top:8px"><code id="apiKey">loading...</code></div>
</div>

<script src="/app.js"></script>
<script>
Auth.requireAuth();
paintUserChip();

function fmtTime(sec){
  sec = Math.max(0, Math.floor(sec||0));
  const m = Math.floor(sec/60), s = sec%60;
  return m + ':' + String(s).padStart(2,'0');
}

async function loadKey(){
  try{
    const data = await api('/auth/me');
    if(data.stations && data.stations[0]){
      document.getElementById('apiKey').textContent = data.stations[0].api_key;
      document.getElementById('stationName').textContent = data.stations[0].name;
    }
  }catch(e){}
}

function drawChart(points){
  const canvas = document.getElementById('chart');
  const empty = document.getElementById('chartEmpty');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0,0,w,h);

  if(!points || points.length < 2){
    empty.style.display = 'block';
    canvas.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  canvas.style.display = 'block';

  const values = points.map(p => p.power);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = (max - min) || 1;
  const stepX = w / (values.length - 1);

  ctx.beginPath();
  values.forEach((v, idx) => {
    const x = idx * stepX;
    const y = h - ((v - min) / range) * (h - 20) - 10;
    if(idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = '#ffb547';
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,181,71,0.08)';
  ctx.fill();
}

async function refresh(){
  try{
    const data = await api('/live');
    const dot = document.getElementById('statusDot');
    dot.className = 'pulse-dot' + (data.online ? '' : ' off');

    const t = data.online ? data.latest : null;
    document.getElementById('stateBig').textContent = !data.online ? 'OFFLINE' : (t ? t.state : 'NO DATA YET');
    document.getElementById('v').innerHTML = (t? t.voltage.toFixed(1):'0.0') + '<small>V</small>';
    document.getElementById('i').innerHTML = (t? t.current.toFixed(3):'0.000') + '<small>A</small>';
    document.getElementById('p').innerHTML = (t? t.power.toFixed(1):'0.0') + '<small>W</small>';
    document.getElementById('pf').textContent = t? t.pf.toFixed(3):'0.000';
    document.getElementById('hz').innerHTML = (t? t.hz.toFixed(2):'0.00') + '<small>Hz</small>';
    document.getElementById('kwh').innerHTML = (t? t.kwh.toFixed(3):'0.000') + '<small>kWh</small>';
    document.getElementById('temp').innerHTML = (t? t.temp.toFixed(1):'0.0') + '<small>°C</small>';
    document.getElementById('relay').textContent = (t && t.relay) ? 'ON' : 'OFF';
    document.getElementById('time').textContent = fmtTime(t? t.time_sec:0);

    const emgBanner = document.getElementById('emgBanner');
    emgBanner.classList.toggle('show', !!(t && t.emergency));

    const sessionKwh = t ? (t.session_wh/1000) : 0;
    const rate = 20;
    document.getElementById('units').textContent = sessionKwh.toFixed(3);
    document.getElementById('bill').textContent = '₹' + (sessionKwh*rate).toFixed(2);
  }catch(e){
    console.error(e);
  }
}

async function refreshChart(){
  try{
    const data = await api('/live/history');
    drawChart(data.points);
  }catch(e){
    console.error(e);
  }
}

loadKey();
refresh();
refreshChart();
setInterval(refresh, 1000);
setInterval(refreshChart, 3000);
</script>
</body>
</html>

'@ | Set-Content -Path "public/dashboard.html" -Encoding UTF8
