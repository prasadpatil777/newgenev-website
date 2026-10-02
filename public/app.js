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

  if(!nav.querySelector('a[href="/demo.html"]')){
    const link4 = document.createElement('a');
    link4.href = '/demo.html';
    link4.textContent = 'Book a Demo';
    if(location.pathname === '/demo.html') link4.className = 'active';
    if(userChip) nav.insertBefore(link4, userChip); else nav.appendChild(link4);
  }
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

  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.type = 'image/png';
  favicon.href = '/icon-192.png';
  document.head.appendChild(favicon);

  const themeMeta = document.createElement('meta');
  themeMeta.name = 'theme-color';
  themeMeta.content = '#0b0f14';
  document.head.appendChild(themeMeta);

  if('serviceWorker' in navigator){
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(()=>{});
    });
  }
})();

// The color glow now lives directly on body{} in style.css (richer, three-tone
// wash), so no extra background layer is injected here — one source of truth,
// no double-stacked gradients.
