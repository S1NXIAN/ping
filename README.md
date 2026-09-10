# PING — honest uptime monitoring for Render Free

PING is a lightweight, mobile-first uptime monitor for people who run things on
[Render's free tier](https://render.com). It sends **real HTTP requests** to the
URLs you configure, on the schedule you choose, and shows you exactly what it
observed — status codes, response times, failure history. Nothing is simulated,
and no uptime number is ever shown for a window PING didn't actually measure.

> PING is an independent hobby tool. It is not affiliated with or endorsed by
> render.com.

## Features

- **Monitors** — any http(s) URL, custom name, GET or HEAD, intervals from 1
  minute to 1 day. Group monitors into **folders**, rename anything, pause or
  resume individual monitors, and tag each with the **account used** (optional
  label for whichever account runs the service — searchable).
- **Ordering** — pin monitors to the top, drag to reorder (desktop) or move
  up/down from the menu (works on touch), and switch the list between manual,
  A–Z, Z–A, and status-first sorting. Pinned monitors float to the top in
  every sort mode; dropping a card into the pinned zone pins it
  automatically. Your sort choice is remembered per device, and `/`
  (Gmail-style) jumps to the search box.
- **Scheduled pings** — run one real check at an exact future moment
  (“ping my deploy at 09:00”). The scheduler fires it, records the result in
  the monitor's history, and shows it in a dedicated sheet with countdowns,
  notes, and results. Cancel anytime before it fires.
- **Keyword checks** — beyond the status code: require (or forbid) a word in
  the response body, so a 200 from a broken page still counts as down. Set in
  the monitor form (“Keyword check”: body must contain / must not contain,
  case-insensitive, first 256 KB of the body, ≤200 chars). Keyword checks
  always fetch with GET — a HEAD response has no body — and a failed keyword
  match is recorded as a real down check (error message, incidents, webhooks
  and uptime math all follow).
- **Latency alerting (slow/degraded)** — optional per-monitor threshold
  (50–30000 ms, set in the monitor form). When an up check takes longer than
  the threshold, the monitor card shows an amber “slow” state with the exact
  response time, the public status page marks the service **degraded** (amber
  banner + badge), and channels with slow alerts get a “slow” webhook. Events
  fire on fast→slow transitions only, are suppressed during active
  maintenance, and are skipped when a down/recovery event already fired (the
  recovery message carries the response time).
- **Down-alert delay (confirmations)** — per-monitor setting (monitor form:
  “Down-alert delay”): wait for N consecutive failed checks before the down
  webhook fires (immediate → after 6 checks). Downtime is always recorded and
  shown right away — only the notification waits for confirmation. The card
  and detail sheet show a live “confirming 2/3” pill while a failure streak is
  still under the threshold. Held events are deferred, never lost: if the
  service stays down past the threshold the alert fires exactly then. Editing
  a monitor's delay or URL resets the streak.
- **Incident postmortem notes** — from the Incidents sheet, attach a short
  note (500 chars) to any derived incident; it appears under that incident on
  the public status page (e.g. “what happened and what fixed it”). Notes are
  keyed to the incident's exact start, editable, removable, and pruned once
  older than the 30-day incident window.
- **Response-time chart with a time axis** — the monitor detail sheet's
  “Response time” section renders a real chart (1h / 24h / 7d ranges) with
  labelled time and ms axes, dashed gridlines, per-point markers, rose tick
  marks for failed checks, an amber line for the slow threshold, and a hover
  tooltip (time · status · latency). Long gaps break the line (paused periods
  read as gaps, not fake slopes); dense windows are bucket-averaged and say
  so honestly in the caption. One click downloads the full retained history
  as CSV (`checkedAt,status,statusCode,responseMs,error`).
- **Maintenance windows** — planned work on a service (e.g. a deploy):
  checks keep running and stay recorded — the data stays honest — but
  down/recovery webhook alerts are silenced and the public status page shows
  an amber “maintenance” state instead of a red outage. If the service goes
  down *during* the window and is still down after it ends, the down alert
  fires then — nothing is lost, just deferred. Windows last up to 7 days,
  can be scheduled up to 90 days ahead, and are listed in a dedicated sheet
  with active/upcoming/recently-ended states.
- **Public status page** — opt in from Settings to get a secret, shareable
  link (`/?status=<token>`, 192-bit) that shows monitor names, live statuses,
  7d/30d uptime, a 30-day per-day bar strip on a labelled track, and a
  response-time sparkline of the last 20 checks — with the exact time window
  it covers labelled on it — read-only, no login, no
  URLs or accounts exposed. Regenerate or disable the link anytime; hide
  individual monitors from their ⋮ menu. A custom page title, a 30-day
  incident history (stitched from real checks, with a clear “ongoing” state),
  and active/upcoming maintenance windows (with notes) are included; down
  periods fully inside a maintenance window are not listed as incidents.
- **README status badge** — a shields.io-style SVG that mirrors the status
  page live: `![status](https://your-host/api/public/badge?token=…)` (green
  operational / amber degraded / red down / gray no data; `&monitor=Name` for
  a single monitor, `&uptime=24h|7d|30d` for a real uptime %, `style=flat-square`
  for sharp corners). Copy-ready Markdown/HTML snippets and an RSS 2.0 feed of
  incidents + maintenance (`/api/public/feed?token=…`, also linked on the
  public page) live in Settings → Public status page.
- **Webhook notifications** — when a monitor goes down, recovers, or answers
  slower than its latency threshold, PING POSTs one JSON event to each
  configured channel (Slack `text`, Discord `content`, plus a structured
  `{ event, monitor, check }` object). Events fire on transitions only — no
  per-check spam, and they are suppressed during active maintenance windows.
  Channels can be routed to a single monitor (or all monitors) and subscribe
  per event type (down / up / slow). Best-effort delivery (10 s timeout, no
  retries) with the honest outcome of the last attempt shown in Settings,
  and a built-in “Send test” button.
- **Real health checks** — the server performs the request with a 15 s timeout,
  records status code, response time, and the exact error on failures. History
  is kept for 30 days (capped at 1 000 checks per monitor).
- **Honest statistics** — uptime %, avg/min/max/p95 response times, last
  failure, check counts — each computed only from recorded checks. Windows with
  no checks display “—”, never an invented number.
- **Render-aware** — live platform status from status.render.com plus the
  limits Render documents (with links), and honest guidance about free-tier
  sleep and instance-hour math.
- **Auth** — single-password login, hashed with scrypt; change the password in
  Settings (this signs out all other sessions). Settings itself is gated by a
  second, 15-minute admin unlock.
- **Keep-awake strategy** — an external scheduler hits `/api/cron/tick`, which
  both wakes PING and runs every due check (see below).
- **Import/export** — your monitor configuration as JSON (includes accounts,
  webhook channels with their routing, and upcoming maintenance windows).

## Run locally

```bash
bun install
bun run db:push        # create the SQLite schema
bun run dev            # http://localhost:3000
```

Set `DATABASE_URL` in `.env` (e.g. `file:./db/custom.db`).
Optional env: `CRON_SECRET` — when set, `/api/cron/tick` requires `?token=<secret>`.

## Deploy on Render

Use **render.yaml** (New → Blueprint) or create a Node web service manually
with build `npm ci && npx prisma generate && npm run build` and start
`npx prisma db push --accept-data-loss && npm run start`.

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
   - **GitHub Actions** — `.github/workflows/keep-alive.yml` in any public repo
     (free), with a `PING_URL` repository secret. Copyable from Settings.
   - **cron-job.org / UptimeRobot free tier** — hit the tick URL on a schedule.
   - **Plain cron** on any box: `*/10 * * * * curl -fsS https://…/api/cron/tick`.

The tick endpoint returns a JSON summary (`{"ran":3,"up":3,"down":0,…}`), and
`/api/health` is a dependency-free alternative that only wakes the service
without triggering checks.

## Architecture (small on purpose)

- Next.js (App Router) single-page app, dark Render-style theme, no chart
  libraries — the sparkline and uptime bars are hand-rolled SVG.
- Prisma + SQLite: `Folder`, `Monitor`, `Check`, `ScheduledPing`,
  `MaintenanceWindow`, `IncidentNote`, `WebhookChannel`, `Session`,
  `Settings`.
- An in-process scheduler (via `instrumentation.ts`) wakes every 30 s and
  checks every enabled monitor whose interval elapsed (concurrency-capped).
- Auth: scrypt password hash + opaque session tokens in httpOnly cookies.
- `GET /api/cron/tick` — external trigger for the same "due checks" routine.

## API (cookie-authenticated unless noted)

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/setup` / `login` / `logout`, `GET /api/auth/session` | auth |
| `GET /api/overview` | folders + monitors + real stats |
| `POST /api/monitors`, `GET/PATCH/DELETE /api/monitors/[id]` | manage monitors |
| `POST /api/monitors/[id]/check` | run one check now |
| `POST /api/folders`, `PATCH/DELETE /api/folders/[id]` | folders |
| `POST /api/admin/password`, `GET /api/admin/info` | settings & runtime info |
| `GET/POST /api/webhooks`, `PATCH/DELETE /api/webhooks/[id]`, `POST /api/webhooks/[id]/test` | notification channels (per-monitor routing via `monitorId`) |
| `GET/POST /api/scheduled-pings`, `DELETE /api/scheduled-pings/[id]` | scheduled pings |
| `GET/POST/DELETE /api/incidents` | incident list + postmortem notes |
| `GET/POST /api/maintenance`, `DELETE /api/maintenance/[id]` | maintenance windows |
| `GET /api/public/status?token=` | public status page (no auth; token-gated) |
| `GET /api/public/badge?token=` | shields-style SVG badge (no auth; token-gated; `monitor`, `label`, `uptime`, `style` params) |
| `GET /api/public/feed?token=` | RSS 2.0 feed of incidents + maintenance (no auth; token-gated) |
| `GET /api/render-status` | live status from status.render.com (5 min cache) |
| `GET /api/export`, `POST /api/import` | backup / restore (monitors, webhook channels, future maintenance windows) |
| `GET /api/health` | public keep-alive ping, no DB access |
| `GET/POST /api/cron/tick` | run all due checks (optional `CRON_SECRET`) |
