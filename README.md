# PING — honest uptime monitoring

PING is a lightweight, mobile-first uptime monitor for web services. It sends
**real HTTP requests** to the URLs you configure, on the schedule you choose,
and shows you exactly what it observed — status codes, response times, failure
history. Nothing is simulated, and no uptime number is ever shown for a window
PING didn't actually measure.

PING is **display-only**: it records and shows the truth, it never alerts.
Nothing will tell you a service went down except opening the dashboard.

> PING is an independent hobby tool. It is not affiliated with or endorsed by
> render.com.

## Features

- **Monitors** — any http(s) URL, custom name, GET or HEAD, and one of two
  schedules: an **interval** from 1 minute to 24 hours (pick a preset or type a
  custom value like `4M` or `4H30M`), or **times of day** — fixed clock times
  every day, e.g. 1:00 PM and 3:00 AM, in a timezone you choose. Group monitors
  into **folders**, rename anything, pause or resume individual monitors, and
  tag each with the **account used** (optional label for whichever account runs
  the service — searchable).
- **Ordering** — pin monitors to the top, drag to reorder (desktop) or move
  up/down from the menu (works on touch), and switch the list between manual,
  A–Z, and status-first sorting. Pinned monitors float to the top in every sort
  mode; dropping a card into the pinned zone pins it automatically. Your sort
  choice is remembered per device, and `/` (Gmail-style) jumps to the search box.
- **Self-monitor** — on first setup (and on boot) PING creates a monitor that
  checks its own `/api/health` endpoint every 3 minutes, so you can see whether
  PING itself is up — and its own inbound traffic helps keep the instance awake.
  It is an ordinary monitor otherwise: visible in the list, editable, and
  deletable like any other.
- **Keyword checks** — beyond the status code: require (or forbid) a word in
  the response body, so a 200 from a broken page still counts as down. Set in
  the monitor form (“Keyword check”: body must contain / must not contain,
  case-insensitive, first 256 KB of the body, ≤200 chars). Keyword checks
  always fetch with GET — a HEAD response has no body — and a failed keyword
  match is recorded as a real down check (error message, incidents and uptime
  math all follow).
- **Slow (degraded) state** — optional per-monitor threshold (50–30000 ms, set
  in the monitor form). A monitor is **slow** when the average response time of
  its recent up checks is over the threshold — the same recent-checks window the
  card bars show. One slow sample cannot mislabel a healthy service, and one
  fast sample cannot hide a slow one. The card shows an amber “slow” state, and
  the fleet header counts slow monitors; the detail sheet agrees.
- **Incident postmortem notes** — from the Incidents sheet, attach a short
  note (500 chars) to any derived incident, for your own later reference.
  Notes are keyed to the incident's exact start, editable, removable, and
  pruned once older than the 30-day incident window. Ongoing incidents are
  pinned to the top of the list and can never be buried under newer ones.
- **Response-time chart with a time axis** — the monitor detail sheet's
  “Response time” section renders a real chart (1h / 24h / 7d ranges) with
  labelled time and ms axes, dashed gridlines, per-point markers, rose tick
  marks for failed checks, an amber line for the slow threshold, and a hover
  tooltip (time · status · latency). Long gaps break the line (paused periods
  read as gaps, not fake slopes); dense windows are bucket-averaged and say
  so honestly in the caption. One click downloads the full retained history
  as CSV (`checkedAt,status,statusCode,responseMs,error`).
- **Real health checks** — the server performs the request with a 15 s timeout,
  records status code, response time, and the exact error on failures. History
  is kept for 30 days (capped at 1 000 checks per monitor).
- **Honest statistics** — uptime %, avg/min/max/p95 response times, last
  failure, check counts — each computed only from recorded checks. Windows with
  no checks display “—”, never an invented number.
- **Render-aware** — live platform status from status.render.com plus the
  limits Render documents (with links), and honest guidance about free-tier
  sleep and instance-hour math.
- **Auth** — a single password, hashed with scrypt, and one dashboard session.
  The session signs you out on an **absolute** timeout counted from login
  (no sliding, no idle detection); the header shows the time left. Choose the
  timeout from presets (5/15/30/60/120 minutes; default 15) in Settings.
  Changing the password signs out every other session.
- **Keep-awake strategy** — an external scheduler hits `/api/cron/tick`, which
  both wakes PING and runs every due check (see below).
- **Import/export** — your monitor configuration as JSON.

### Trust model (read this before exposing PING)

PING is single-admin software: whoever holds the password controls every
monitor. Monitor URLs may point anywhere, including `localhost`, LAN addresses
and `169.254.*` link-local hosts — monitoring internal services is a normal
use. Creating a monitor requires the authenticated admin session, so this is
not an untrusted-input path. If you expose PING to the internet, treat the
password as the only thing standing between a stranger and your internal
network.

## Run locally

```bash
bun install
bun run db:push        # create the SQLite schema
bun run dev            # http://localhost:3000
```

Set `DATABASE_URL` in `.env` (e.g. `file:./db/custom.db`).
Optional env: `CRON_SECRET` — when set, `/api/cron/tick` requires `?token=<secret>`.
On Render, `RENDER_EXTERNAL_URL` (set by the platform) is used as the
Self-monitor's origin.

## Deploy on Render

Use **render.yaml** (New → Blueprint) or create a Node web service manually
with build `bun install && bunx prisma generate && bun run build` and start
`bunx prisma db push --accept-data-loss && bun run start`.

**Honest caveats** (see render.yaml comments too):

- The **free plan has no persistent disks**. The blueprint therefore mounts a
  1 GB disk (a paid `starter` feature) so the SQLite database survives
  restarts. On a strictly-free deployment the database resets on restart —
  export/import your monitors, or point `DATABASE_URL` somewhere durable.
- **Free services spin down after 15 min of inactivity.** A sleeping service
  cannot wake itself, so PING cannot keep itself alive from inside.
- **~750 free instance hours per workspace per month.** A 31-day month is 744
  hours, so at most *one* free service can be always-on. Keeping PING awake
  24/7 *and* several other services awake 24/7 will exhaust the pool — they
  will sleep until hours reset. No tool can honestly promise 24/7 on free.

## Keeping services awake (the reliable way)

1. Deploy PING (any always-on host works — Render, Fly, a Raspberry Pi…).
2. Point an external, always-on scheduler at your tick URL:

   ```
   https://<your-ping-origin>/api/cron/tick
   ```

   - Every 5–10 min → PING stays awake 24/7 and its internal scheduler honors
     each monitor's interval precisely (~744 instance hours/month on Render).
   - Every 20–30 min → PING sleeps between ticks and cold-boots (~30–60 s) on
     each nudge; checks then run at the tick cadence. Far fewer free hours.

   Each tick runs **every monitor whose interval has elapsed** — one external
   scheduler drives everything.
3. Scheduler options:
   - **GitHub Actions** — `.github/workflows/ping.yml` in any public repo
     (free), with a `PING_URL` repository secret. See the YAML below.
   - **cron-job.org / UptimeRobot free tier** — hit the tick URL on a schedule.
   - **Plain cron** on any box: `*/10 * * * * curl -fsS https://…/api/cron/tick`.

The tick endpoint returns a JSON summary (`{"ran":3,"up":3,"down":0,…}`), and
`/api/health` is a dependency-free alternative that only wakes the service
without triggering checks.

### GitHub Actions keep-alive workflow

Add this file as `.github/workflows/ping.yml` in any repository, then create a
`PING_URL` secret with your PING origin (no trailing slash, no `/api` path).
Free on public repositories; GitHub's cron can drift a few minutes, which is
fine here since each tick only runs checks that are actually due.

```yaml
name: PING keep-alive
on:
  schedule:
    - cron: "*/10 * * * *" # every 10 minutes (GitHub may drift a few)
  workflow_dispatch: # allows a manual run
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Tick PING (runs all due checks)
        run: curl -fsS --max-time 90 "${{ secrets.PING_URL }}/api/cron/tick" || true
```

## Architecture (small on purpose)

- Next.js (App Router) single-page app, dark theme, no chart
  libraries — the sparkline and uptime bars are hand-rolled SVG.
- Prisma + SQLite: `Folder`, `Monitor`, `Check`, `IncidentNote`, `Session`,
  `Settings`.
- An in-process scheduler (via `instrumentation.ts`) wakes every 30 s and
  checks every enabled monitor whose interval elapsed (concurrency-capped).
- Auth: scrypt password hash + opaque session tokens in httpOnly cookies, with
  an absolute, admin-configurable expiry.
- `GET /api/cron/tick` — external trigger for the same "due checks" routine.

## API (cookie-authenticated unless noted)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/setup` / `login` / `logout`, `GET /api/auth/session` | auth |
| `GET /api/overview` | folders + monitors + real stats |
| `POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/[id]` | manage monitors |
| `POST /api/monitors/[id]/check` | run one check now |
| `POST /api/folders`, `PATCH/DELETE /api/folders/[id]` | folders |
| `POST /api/admin/password`, `GET/POST /api/admin/session` | password & session timeout |
| `GET /api/admin/info`, `GET/POST /api/admin/retention` | runtime info & data retention |
| `GET/POST/DELETE /api/incidents` | incident list + postmortem notes |
| `GET /api/render-status` | live status from status.render.com (5 min cache) |
| `GET /api/export`, `POST /api/import` | backup / restore (monitors, folders) |
| `GET /api/health` | public keep-alive ping, no DB access |
| `GET/POST /api/cron/tick` | run all due checks (optional `CRON_SECRET`) |
