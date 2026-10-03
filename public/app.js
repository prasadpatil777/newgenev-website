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
  const userChip = document.getElementById('userChip');

  if(!nav.querySelector('a[href="/about.html"]')){
    const link = document.createElement('a');
    link.href = '/about.html';
    link.textContent = 'About';
    if(location.pathname === '/about.html') link.className = 'active';
    if(userChip) nav.insertBefore(link, userChip); else nav.appendChild(link);
  }

  if(!nav.querySelector('a[href="/goals.html"]')){
    const link2 = document.createElement('a');
    link2.href = '/goals.html';
    link2.textContent = 'Goals';
    if(location.pathname === '/goals.html') link2.className = 'active';
    if(userChip) nav.insertBefore(link2, userChip); else nav.appendChild(link2);
  }

  if(!nav.querySelector('a[href="/contact.html"]')){
    const link3 = document.createElement('a');
    link3.href = '/contact.html';
    link3.textContent = 'Talk to an Expert';
    if(location.pathname === '/contact.html') link3.className = 'active';
    if(userChip) nav.insertBefore(link3, userChip); else nav.appendChild(link3);
  }

  if(!nav.querySelector('a[href="/pay.html"]')){
    const linkPay = document.createElement('a');
    linkPay.href = '/pay.html';
    linkPay.textContent = 'Pay & Charge';
    if(location.pathname === '/pay.html') linkPay.className = 'active';
    if(userChip) nav.insertBefore(linkPay, userChip); else nav.appendChild(linkPay);
  }

  if(!nav.querySelector('a[href="/demo.html"]')){
    const link4 = document.createElement('a');
    link4.href = '/demo.html';
    link4.textContent = 'Book a Demo';
    if(location.pathname === '/demo.html') link4.className = 'active';
    if(userChip) nav.insertBefore(link4, userChip); else nav.appendChild(link4);
  }
}
initAboutLink();

// Owner-only "Remote control" link (start/stop charging from the website when
// a customer's RFID card fails). Customers never see it.
async function initControlLink(){
  const nav = document.querySelector('.navlinks');
  if(!nav || !Auth.getToken() || nav.querySelector('a[href="/control.html"]')) return;
  try{
    const d = await api('/live');
    if(!d.isOwner) return;
    const link = document.createElement('a');
    link.href = '/control.html';
    link.textContent = 'Remote control';
    const chip = document.getElementById('userChip');
    if(chip) nav.insertBefore(link, chip); else nav.appendChild(link);
  }catch(e){}
}
initControlLink();

// PWA setup: inject the manifest link + theme-color into every page's
// <head>, and register the service worker, so the site is installable
// as an app on a phone's home screen. No per-page HTML edits needed.
(function initPWA(){
  const manifestLink = document.createElement('link');
  manifestLink.rel = 'manifest';
  manifestLink.href = '/manifest.json';
  document.head.appendChild(manifestLink);

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = '/icon-192.png';
  document.head.appendChild(favicon);

  const themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#000000';
  document.head.appendChild(themeMeta);

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    });
  }
})();

// The color glow lives on body{} in style.css. On top of that, a single quiet
// line-art illustration (an EV plugged into a charging pedestal) sits fixed
// in the bottom-right corner of every page, bleeding off-screen — barely
// visible, never competing with the real content, just enough to say "this
// is an EV charging product" at a glance.
(function initBackgroundArt(){
  if(document.getElementById('bgArt')) return;
  const div = document.createElement('div');
  div.id = 'bgArt';
  div.style.cssText = 'position:fixed;right:-6vw;bottom:-6vh;z-index:-1;pointer-events:none;width:min(62vw,780px);opacity:0.07;';
  div.innerHTML = `<svg viewBox="0 0 640 420" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M40,330 C40,290 80,280 120,275 L170,230 Q195,210 230,210 L360,210 Q400,210 420,236 L458,278 Q492,284 492,330 Q492,350 470,350 L440,350 Q432,378 400,378 Q368,378 360,350 L190,350 Q182,378 150,378 Q118,378 110,350 L62,350 Q40,350 40,330 Z"
      stroke="#fafafa" stroke-width="2.5"/>
    <path d="M175,232 L222,214 Q234,210 247,210 L352,210 Q372,211 386,224 L414,250 Z"
      stroke="#fafafa" stroke-width="2"/>
    <circle cx="150" cy="350" r="34" stroke="#ffb23f" stroke-width="3"/>
    <circle cx="150" cy="350" r="11" stroke="#ffb23f" stroke-width="2"/>
    <circle cx="400" cy="350" r="34" stroke="#ffb23f" stroke-width="3"/>
    <circle cx="400" cy="350" r="11" stroke="#ffb23f" stroke-width="2"/>
    <rect x="520" y="130" width="70" height="230" rx="14" stroke="#3ddc84" stroke-width="2.5"/>
    <rect x="536" y="152" width="38" height="44" rx="5" stroke="#3ddc84" stroke-width="2"/>
    <path d="M562,168 L548,192 L558,192 L552,214 L570,186 L560,186 Z" fill="#3ddc84"/>
    <path d="M492,300 C510,296 516,270 520,250" stroke="#3ddc84" stroke-width="3" stroke-linecap="round"/>
    <circle cx="492" cy="300" r="5" fill="#3ddc84"/>
    <circle cx="520" cy="250" r="5" fill="#3ddc84"/>
  </svg>`;
  document.body.prepend(div);
})();
