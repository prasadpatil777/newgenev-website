# NEW GEN EV — Website Backend

A small Node.js + Express + SQLite backend and website for your EV charging
station: login/accounts, a live dashboard, and session history. Built to run
locally in minutes for a hackathon demo, and to be deployable for real later.

## Run it locally

```bash
npm install
cp .env.example .env      # edit JWT_SECRET to any random string
node server.js
```

Open **http://localhost:3000** in your browser. Register an account — this
also creates your charging station's **API key**, shown once in a popup and
always visible later on your dashboard page.

## How data gets in

The ESP32 posts to this backend over HTTP:

- `POST /api/telemetry` — live reading, every few seconds while running.
  Header: `X-Station-Key: <your station's API key>`
- `POST /api/sessions` — once, when a charging session completes.
  Same header.

The website (after logging in) reads:

- `GET /api/live` — latest reading + online/offline status
- `GET /api/sessions` — session history + totals

## Connecting your ESP32

Your ESP32 dashboard sketch already has a `BACKEND_ENABLED` section near the
top (search for it). Set:

```cpp
const bool BACKEND_ENABLED = true;
const char* HOME_WIFI_SSID = "your real WiFi name";
const char* HOME_WIFI_PASS = "your real WiFi password";
const char* BACKEND_HOST   = "http://YOUR_COMPUTER_LAN_IP:3000";
const char* STATION_API_KEY= "ev_...";  // from your dashboard page
```

**Important — for a hackathon demo:** your laptop and the ESP32 must be on
the **same WiFi network** (e.g. the venue WiFi or your phone's hotspot) for
`BACKEND_HOST`'s IP address to be reachable. Find your laptop's LAN IP with
`ipconfig` (Windows) or `ifconfig`/`ip addr` (Mac/Linux) — it looks like
`192.168.x.x`. The ESP32's own hotspot (`NEW_GEN_EV`) keeps working
independently the whole time, as a backup if the venue WiFi is unreliable.

## Moving to real hosting later

When you're ready to deploy this for real (not just localhost):

1. Push this folder to GitHub.
2. Deploy it on a free-tier host that supports Node.js, e.g. **Render** or
   **Railway** — connect your GitHub repo, they auto-detect `npm install`
   + `node server.js`.
3. SQLite works fine for a single small deployment, but most hosts wipe the
   disk on redeploy. For anything beyond a demo, swap in a hosted Postgres
   (e.g. **Neon** or **Supabase**, both have permanent free tiers) — the
   `db/init.js` file is the only place that would need to change.
4. Set `BACKEND_HOST` in the ESP32 sketch to your new `https://...` URL
   instead of a local IP, and set `JWT_SECRET` on the host to a real secret
   (never commit `.env` to GitHub — it's already in `.gitignore`).

## Building the app later

Because everything goes through this same REST API (`/api/auth`,
`/api/live`, `/api/sessions`), a future mobile app just needs to call the
same endpoints with the same JWT login flow — no backend changes needed.

## Project structure

```
server.js            entry point
db/init.js            SQLite schema + connection
routes/auth.js         register / login / me
routes/telemetry.js    ESP32 ingestion + live reading
routes/sessions.js     session history
public/                website (login, register, dashboard, history)
```
