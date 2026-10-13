# PING — Live service monitoring

PING is a lightweight, mobile-first uptime monitor for web services. It sends
**real HTTP requests** to the URLs you configure, on the schedule you choose,
and shows you exactly what it observed — status codes, response times, failure
history. Nothing is simulated, and no uptime number is ever shown for a window
PING didn't actually measure.

PING is **display-only**: it records and shows the truth, it never alerts.
Its one out-of-band signal is passive and stays inside the browser: while any
monitor is down, the tab title and favicon carry the down count. Nothing else
reaches you — no email, webhook, or push — so a service that goes down is still
only visible by looking at PING.

> PING is an independent hobby tool. It is not affiliated with or endorsed by
> render.com.

## Features

- **Monitors** — any http(s) URL, custom name, GET or HEAD, and one of two
  schedules: an **interval** from 1 minute to 24 hours (pick a preset or type a
  custom value like `4M` or `4H30M`), or **times of day** — fixed clock times
  every day, e.g. 1:00 PM and 3:00 AM, in your browser's own timezone. Group monitors
  into **folders**, rename anything, pause or resume individual monitors, and
  tag each with the **account used** (optional label for whichever account runs
  the service — searchable).
- **Ordering** — pin monitors to the top, drag the handle to reorder
  (desktop), and switch the list between manual,
  A–Z, Z–A, slowest, and fastest sorting. Pinned monitors float to the top in
  every sort mode; dropping a card into the pinned zone pins it automatically.
  Your sort choice is remembered per device, and `/` (Gmail-style) jumps to the
  search box.
- **Self-monitor** — on first setup (and on boot) PING creates a monitor that
  checks its own `/api/health` endpoint every 3 minutes, so you can see whether
  PING itself is up — and its own inbound traffic helps keep the instance awake.
  It is an ordinary monitor otherwise: visible in the list, editable, and
  deletable like any other.
- **Keyword checks** — beyond the status code: require (or forbid) a word in
  the response body, so a 200 from a broken page still counts as down. Set in
  the monitor form (“Keyword check”: body must contain / must not contain,
  case-insensitive, first 256 KB of the body, ≤200 chars). A keyword needs a
  response body, so it can't be combined with a HEAD check: create, edit and
  import all refuse that pairing rather than storing a monitor that would
  never pass. (Monitors saved before this rule existed are switched to GET
  once, on boot.) A failed keyword match is recorded as a real down
  check (error message, incidents and uptime math all follow).
- **Slow (degraded) state** — optional per-monitor threshold (50–30000 ms, set
  in the monitor form). A monitor is **slow** when the average response time of
  its recent up checks is over the threshold — the same recent-checks window the
  card bars show. One slow sample cannot mislabel a healthy service, and one
  fast sample cannot hide a slow one. The card shows an amber “slow” state, and
  the header counts slow monitors across the whole fleet; the detail sheet
  agrees.
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
  The login is remembered for an admin-configurable **window counted from the
  last password entry** (no sliding, no idle detection): inside it a fresh
  visit skips the password, after it the next visit asks again. An open tab is
  never interrupted. Choose the window in Settings. Changing the password
  signs out every other session.
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
The deploy blueprint sets `CRON_SECRET`, so `/api/cron/tick` requires a token
(`?token=<secret>` or the `x-cron-token` header). Locally, set it too if the
tick URL is reachable by anyone else; leave it unset to disable the check.
On Render, `RENDER_EXTERNAL_URL` (set by the platform) is used as the
Self-monitor's origin.

## Deploy on Render

Use **render.yaml** (New → Blueprint) or create a Node web service manually
with build `bun install && bunx prisma generate && bun run build` and start
`bunx prisma db push --accept-data-loss && bun run start`. The blueprint sets
`CRON_SECRET`; a manual service should set it too (see below).

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
   - **GitHub Actions** — this repo ships
     [`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml);
     set its `PING_URL` and `PING_TOKEN` repository secrets. See below.
   - **cron-job.org / UptimeRobot free tier** — hit the tick URL on a schedule
     with `CRON_SECRET` as the token (query `?token=` or header `x-cron-token`).
   - **Plain cron** on any box — cron's `sh` has no shell environment, so put
     the literal secret in the crontab (not `$CRON_SECRET`):
     `*/10 * * * * curl -fsS -H "x-cron-token: <secret>" https://…/api/cron/tick`.

The tick endpoint returns a JSON summary (`{"ran":3,"up":3,"down":0,…}`), and
`/api/health` is a dependency-free alternative that only wakes the service
without triggering checks.

### GitHub Actions keep-alive workflow

[`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) is the
source of truth — read it there. To use it, create two repository secrets:
`PING_URL` (your PING origin, no trailing slash, no `/api` path) and
`PING_TOKEN` (the `CRON_SECRET` value Render generated — Dashboard → your
service → Environment). Free on public repositories; GitHub's cron can drift a
few minutes, which is fine here since each tick only runs checks that are
actually due.

## Architecture (small on purpose)

- Next.js (App Router) single-page app, dark theme, no chart
  libraries — the sparkline and uptime bars are hand-rolled SVG.
- Prisma + SQLite: `Folder`, `Monitor`, `Check`, `IncidentNote`, `Session`,
  `Settings`.
- An in-process scheduler (via `instrumentation.ts`) wakes every 30 s and
  checks every enabled monitor whose interval elapsed (concurrency-capped).
- Auth: scrypt password hash + opaque session tokens in httpOnly cookies. The
  login is remembered for an admin-configurable window counted from the last
  password entry; the token itself lives until logout or a password change.
- `GET /api/cron/tick` — external trigger for the same "due checks" routine.

## API (cookie-authenticated unless noted)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/setup` / `login` / `logout`, `GET /api/auth/session` | auth |
| `GET /api/overview` | folders + monitors + real stats |
| `POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/[id]` | manage monitors |
| `POST /api/monitors/[id]/check` | run one check now |
| `POST /api/folders`, `PATCH/DELETE /api/folders/[id]` | folders |
| `POST /api/admin/password`, `GET/POST /api/admin/session` | password & re-prompt window |
| `GET /api/admin/info`, `GET/POST /api/admin/retention` | runtime info & data retention |
| `GET/POST/DELETE /api/incidents` | incident list + postmortem notes |
| `GET /api/render-status` | live status from status.render.com (5 min cache) |
| `GET /api/export`, `POST /api/import` | backup / restore (monitors, folders) |
| `GET /api/health` | public keep-alive ping, no DB access |
| `GET/POST /api/cron/tick` | run all due checks (token when `CRON_SECRET` set) |
