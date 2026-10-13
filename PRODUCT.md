# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The operator: a solo developer who self-hosts PING (single password, single admin) to watch the web services and apps they run.

## Product Purpose

PING is a lightweight, mobile-first uptime monitor for web services on free tiers — services that spin down when idle and cold-boot on the next request. It sends real HTTP requests to configured URLs on a chosen schedule, records exactly what it observed (status codes, response times, failures), and keeps services awake by letting an external scheduler hit its tick endpoint. Success means the operator never has to guess whether a free-tier service is up, slow, or cold-booting — and never sees an invented number.

PING is **display-only**: it records and shows, it never alerts. Its one out-of-band signal is passive and self-contained: while any monitor is down, the browser tab title and favicon carry the down count. Nothing else reaches the operator — no webhook, email, or push — so a service that goes down is still only visible by looking at PING.

## Positioning

Honesty of data as the core mechanism, purpose-built for cold-booting free-tier services: every displayed number derives from real recorded checks; unmeasured windows show "—", never an estimate. Render-aware out of the box (platform status, limits, instance-hour math), but deliberately platform-agnostic: any free-tier http(s) service that cold-boots is first-class. A neighboring monitor could not truthfully claim the same strict no-simulation contract.

## Operating Context

- Self-hosted single instance (currently a sandbox dev server; deployable to Render, Fly, a Raspberry Pi, or any always-on host per README).
- Free-tier targets sleep after ~15 min of inactivity and cold-boot in ~30–60 s; a sleeping service cannot wake itself, so an external scheduler (GitHub Actions, cron-job.org, UptimeRobot, plain cron) hits `GET /api/cron/tick` every 5–10 min to wake PING and run all due checks.
- A **Self-monitor** checks PING's own `/api/health` every 3 minutes by default, so the operator can see PING's own uptime and its own traffic helps keep the instance awake.
- The operator tags monitors with the "account used" (which account/org runs each service) and groups them into folders.
- SQLite database on local disk; history pruned by a configurable retention policy (default 30 days, capped 1 000 checks/monitor).
- External keep-alive math matters: ~750 free instance hours/workspace/month on Render; honest guidance is part of the product.

## Capabilities and Constraints

Capabilities (confirmed, shipping):

- Monitors: any http(s) URL, GET or HEAD, two schedule kinds — an **interval** (1 min–24 hours; presets, or a custom `H`/`M` value such as `4M` or `4H30M`) or **times of day** (fixed clock times every day, e.g. 1:00 PM + 3:00 AM, read in the browser's own timezone) — folders, pinning, manual/A–Z/Z–A/slowest/fastest sorting, drag reorder (desktop) with Move up/down in the card menu on every device, per-device sort memory, `/` search focus, ⌘K command palette.
- Real checks: 15 s timeout, 2xx–3xx = up, exact error text on failure; keyword checks (body must contain / must not contain, case-insensitive, first 256 KB, can't be combined with HEAD — the pairing is rejected at create, edit and import); latency "slow" state (50–30 000 ms threshold, judged from the **average** of the monitor's recent up Checks).
- Self-monitor: created by default, checks PING's own health endpoint every 3 minutes; an ordinary monitor otherwise (visible, editable, deletable).
- Incidents: derived from real check history (30-day window), with admin postmortem notes; ongoing incidents are pinned to the top and exempt from the list cap. The incidents list and badge, like the dashboard's four stat cards, cover the active Scope (see `GLOSSARY.md`); the header counts stay fleet-wide. The incidents badge is a nudge, not a tally: it counts every ongoing incident plus every closed one newer than the newest start the operator has opened the incidents sheet over (a per-device watermark, like the sort memory), so viewed history clears and an ongoing outage keeps asking until it resolves.
- Import/export of configuration as JSON; Render platform status card; keep-alive workflow YAML in the README.
- Auth: a single scrypt-hashed password and one dashboard Session. The login is remembered for an admin-configurable window counted from the last password entry: inside it a fresh visit skips the password, after it the next visit asks again. An open tab is never interrupted — the window is a re-prompt convenience, not a revocation; the Session ends only on logout or a password change.

Constraints (must be preserved by future work):

- Single-instance assumption: in-process scheduler, in-memory login throttle, module-level concurrency guards are process-local.
- SQLite only; history retention default 30 days + 1 000 checks/monitor; incident notes pruned at a fixed 32 days.
- Min check interval 60 s (whole minutes only — `S` is not a configurable unit); max 24 hours; ≤200 monitors. A times-of-day schedule stores wall-clock times (never instants) plus the browser's IANA zone, so it survives a DST shift as the times the user typed; editing a monitor re-reads the browser's zone. A check missed while PING was asleep runs on waking, but only the most recent one.
- Monitor URLs must be http(s) — any host, including internal targets (`localhost`, LAN names, `169.254.*` link-local) by design: creating a monitor requires the authenticated admin session, so this is not an untrusted-input path (see README trust model).
- UTC day buckets everywhere (stats, bars) so views align across timezones.
- English-only UI; no i18n requirement recorded.
- Concurrency guards (in-flight per monitor, tick overlap) must never be removed to "fix" double triggers.
- PING is display-only: it records and shows, it never alerts. No webhook, email or push delivery exists or may be reintroduced without a product decision. The one permitted out-of-band signal is the browser tab title and favicon down marker (product decision 2026-10-13): the same truth the open dashboard shows, surfaced peripherally, never a notification.

## Brand Commitments

- Name: **PING**, tagline "Live service monitoring" in the header and footer. The login card does not carry the tagline — it names the product's job in one sentence instead. (Retitled from the earlier "honest uptime monitoring".)
- Voice: plain-spoken, honest, technical; no marketing fluff; disclaimers kept factual ("not affiliated with any hosting provider").
- The honesty contract itself is a brand commitment: no simulated data, no invented uptime numbers, ever.

## Evidence on Hand

- `README.md` — full feature claims and free-tier math, written by the project author.
- `CODING_STANDARD.md` — engineering rules (complexity budgets, naming, Conventional Commits).
- A running, browser-verified instance: setup → login → monitor creation → real check recorded (HTTP 200, 87 ms, 100% uptime) verified end-to-end on 2026-09-15.
- No testimonials, press, customer data, or benchmark claims exist; none may be fabricated.

## Product Principles

1. **Honesty above all.** Show only what was really measured; gaps stay gaps; "—" beats a plausible lie.
2. **Built for cold-boot reality.** Free-tier services sleep; waking them and measuring the truth matters more than pretending 24/7.
3. **Display-only, by choice.** PING records and shows; it never alerts. The one out-of-band signal is the tab title and favicon down marker — the same truth, peripherally; nothing else tells the operator a service is down except PING itself.
4. **One operator, zero ceremony.** Self-hosted, single password, low-maintenance; the tool must never become another service to babysit.
5. **Platform-agnostic honesty.** Render-aware today, but any free-tier http(s) service that cold-boots is first-class.

## Accessibility & Inclusion

No formal WCAG target set by the operator ("keep as is"). Existing effort continues: semantic HTML, ARIA labels/roles, keyboard access (⌘K palette, `/` search focus, 44px touch targets), descriptive alt text. English-only UI.

## Open Decisions

- Binding commitments list intentionally open: operator will add constraints as they come to mind.
