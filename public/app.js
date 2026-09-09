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

