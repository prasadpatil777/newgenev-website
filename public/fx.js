/* NEW GEN EV — FX layer: particles, light, ripples, live-state effects.
   Purely visual. It only reads the page (never changes ids, text or data),
   so every page script keeps working the same. */
(function () {
  "use strict";
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var body = document.body;
  if (!body) return;

  // ---------- mouse spotlight ----------
  var spot = document.createElement("div");
  spot.id = "fx-spot";
  body.appendChild(spot);
  var root = document.documentElement;
  window.addEventListener("pointermove", function (e) {
    root.style.setProperty("--mx", e.clientX + "px");
    root.style.setProperty("--my", e.clientY + "px");
    var card = e.target && e.target.closest && e.target.closest(".card,.billcard,.featcard,.goalcard,.reasoncard,.teamcard");
    if (card) {
      var r = card.getBoundingClientRect();
      card.style.setProperty("--cx", (e.clientX - r.left) + "px");
      card.style.setProperty("--cy", (e.clientY - r.top) + "px");
    }
  }, { passive: true });

  // ---------- button ripples ----------
  document.addEventListener("pointerdown", function (e) {
    var b = e.target && e.target.closest && e.target.closest(".btn,.rowbtn,.locbtn,.hero2-cta a,.landbtns a,.logout");
    if (!b) return;
    var r = b.getBoundingClientRect(), s = Math.max(r.width, r.height);
    var dot = document.createElement("span");
    dot.className = "fx-ripple";
    dot.style.width = dot.style.height = s + "px";
    dot.style.left = (e.clientX - r.left - s / 2) + "px";
    dot.style.top = (e.clientY - r.top - s / 2) + "px";
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    b.style.overflow = "hidden";
    b.appendChild(dot);
    setTimeout(function () { dot.remove(); }, 700);
  });

  // ---------- energy particles ----------
  if (!reduce) {
    var cv = document.createElement("canvas");
    cv.id = "fx-canvas";
    body.insertBefore(cv, body.firstChild);
    var ctx = cv.getContext("2d");
    var W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2), parts = [];
    var COLORS = ["255,178,63", "255,122,26", "255,79,163", "164,107,255", "34,211,238", "61,220,132"];
    var boost = 1;
    function size() {
      W = window.innerWidth; H = window.innerHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var n = Math.round(Math.min(70, Math.max(26, W * H / 26000)));
      parts = [];
      for (var i = 0; i < n; i++) parts.push(spawn(true));
    }
    function spawn(any) {
      return {
        x: Math.random() * W,
        y: any ? Math.random() * H : H + 10,
        r: 0.6 + Math.random() * 1.9,
        vy: 0.15 + Math.random() * 0.55,
        vx: (Math.random() - 0.5) * 0.25,
        c: COLORS[(Math.random() * COLORS.length) | 0],
        a: 0.25 + Math.random() * 0.6,
        t: Math.random() * 6.28
      };
    }
    var last = 0;
    function frame(ts) {
      if (document.hidden) { requestAnimationFrame(frame); return; }
      if (ts - last < 30) { requestAnimationFrame(frame); return; }   // ~33 fps is plenty
      last = ts;
      ctx.clearRect(0, 0, W, H);
      ctx.globalCompositeOperation = "lighter";
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.t += 0.03;
        p.y -= p.vy * boost;
        p.x += p.vx + Math.sin(p.t) * 0.2;
        if (p.y < -10) parts[i] = p = spawn(false);
        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 7);
        g.addColorStop(0, "rgba(" + p.c + "," + p.a + ")");
        g.addColorStop(1, "rgba(" + p.c + ",0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 7, 0, 6.283); ctx.fill();
      }
      // faint links between close sparks
      ctx.lineWidth = 0.6;
      for (var a = 0; a < parts.length; a++) {
        for (var b = a + 1; b < parts.length; b++) {
          var dx = parts[a].x - parts[b].x, dy = parts[a].y - parts[b].y, d = dx * dx + dy * dy;
          if (d < 9000) {
            ctx.strokeStyle = "rgba(255,178,63," + (0.12 * (1 - d / 9000)) + ")";
            ctx.beginPath(); ctx.moveTo(parts[a].x, parts[a].y); ctx.lineTo(parts[b].x, parts[b].y); ctx.stroke();
          }
        }
      }
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(frame);
    }
    size();
    window.addEventListener("resize", size);
    requestAnimationFrame(frame);
  }

  // ---------- live dashboard reactions (only where these elements exist) ----------
  var hero = document.querySelector(".hero");
  if (hero) {
    var strip = document.createElement("div");
    strip.className = "fx-bolt-strip";
    hero.appendChild(strip);
  }
  var stateEl = document.getElementById("stateBig");
  var emgEl = document.getElementById("emgBanner");
  function syncState() {
    var s = stateEl ? (stateEl.textContent || "").trim().toUpperCase() : "";
    var charging = s.indexOf("CHARGING") === 0;
    body.classList.toggle("fx-charging", charging);
    if (typeof boost !== "undefined") boost = charging ? 3 : 1;
    body.classList.toggle("fx-emergency", !!(emgEl && emgEl.classList.contains("show")));
  }
  if (stateEl) {
    new MutationObserver(syncState).observe(stateEl, { childList: true, characterData: true, subtree: true });
    if (emgEl) new MutationObserver(syncState).observe(emgEl, { attributes: true, attributeFilter: ["class"] });
    syncState();
  }
  // flash a number when its value changes
  ["bill", "units", "v", "i", "p", "kwh", "relay"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    var prev = el.textContent;
    new MutationObserver(function () {
      if (el.textContent === prev) return;
      prev = el.textContent;
      el.classList.remove("fx-tick"); void el.offsetWidth; el.classList.add("fx-tick");
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
})();
