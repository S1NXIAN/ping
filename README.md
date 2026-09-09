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
  resume individual monitors.
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
  Settings (this signs out all other sessions).
- **Keep-awake strategy** — an external scheduler hits `/api/cron/tick`, which
  both wakes PING and runs every due check (see below).
- **Import/export** — your monitor configuration as JSON.

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
- Prisma + SQLite: `Folder`, `Monitor`, `Check`, `Session`, `Settings`.
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
| `GET /api/render-status` | live status from status.render.com (5 min cache) |
| `GET /api/export`, `POST /api/import` | backup / restore monitors |
| `GET /api/health` | public keep-alive ping, no DB access |
| `GET/POST /api/cron/tick` | run all due checks (optional `CRON_SECRET`) |
