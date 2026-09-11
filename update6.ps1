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

// PWA setup: inject the manifest link + theme-color into every page's
// <head>, and register the service worker, so the site is installable
// as an app on a phone's home screen. No per-page HTML edits needed.
(function initPWA(){
  const manifestLink = document.createElement('link');
  manifestLink.rel = 'manifest';
  manifestLink.href = '/manifest.json';
  document.head.appendChild(manifestLink);

  const themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#12161a';
  document.head.appendChild(themeMeta);

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    });
  }
})();

// Subtle full-page background illustration (EV + charging theme), sits
// behind all content so the live dashboard/cards stay fully readable on top.
(function initBackgroundArt(){
  if(document.getElementById('bgArt')) return;
  const div = document.createElement('div');
  div.id = 'bgArt';
  div.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden;background:#12161a;';
  div.innerHTML = `<svg width="100%" height="100%" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" style="opacity:0.07">
    <defs>
      <radialGradient id="bgGlow" cx="75%" cy="20%" r="60%">
        <stop offset="0%" stop-color="#ffb547" stop-opacity="1"/>
        <stop offset="100%" stop-color="#ffb547" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="800" fill="url(#bgGlow)"/>
    <g stroke="#3a4650" stroke-width="1">
      <line x1="0" y1="100" x2="1200" y2="100"/><line x1="0" y1="200" x2="1200" y2="200"/>
      <line x1="0" y1="300" x2="1200" y2="300"/><line x1="0" y1="400" x2="1200" y2="400"/>
      <line x1="0" y1="500" x2="1200" y2="500"/><line x1="0" y1="600" x2="1200" y2="600"/>
      <line x1="0" y1="700" x2="1200" y2="700"/>
      <line x1="150" y1="0" x2="150" y2="800"/><line x1="300" y1="0" x2="300" y2="800"/>
      <line x1="450" y1="0" x2="450" y2="800"/><line x1="600" y1="0" x2="600" y2="800"/>
      <line x1="750" y1="0" x2="750" y2="800"/><line x1="900" y1="0" x2="900" y2="800"/>
      <line x1="1050" y1="0" x2="1050" y2="800"/>
    </g>
    <path d="M780,620 Q780,570 830,563 L880,515 Q905,495 940,495 L1030,495 Q1068,495 1088,522 L1120,562 Q1140,568 1140,620 Q1140,640 1120,640 L1094,640 Q1088,666 1062,666 Q1036,666 1030,640 L890,640 Q884,666 858,666 Q832,666 826,640 L796,640 Q780,640 780,620 Z"
          fill="none" stroke="#33d9b2" stroke-width="3"/>
    <circle cx="838" cy="640" r="26" fill="none" stroke="#33d9b2" stroke-width="3"/>
    <circle cx="1078" cy="640" r="26" fill="none" stroke="#33d9b2" stroke-width="3"/>
    <path d="M320,180 L260,300 L300,300 L270,380 L370,240 L328,240 Z" fill="#ffb547"/>
    <ellipse cx="900" cy="330" rx="110" ry="46" fill="none" stroke="#33d9b2" stroke-width="1.5" stroke-dasharray="5 6"/>
  </svg>`;
  document.body.prepend(div);
})();

'@ | Set-Content -Path "public/app.js" -Encoding UTF8
