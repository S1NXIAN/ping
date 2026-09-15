# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The operator: a solo developer who self-hosts PING (single password, single admin) to watch the web services and apps they run. Public status-page visitors exist as a read-only, token-gated audience but are a capability, not a confirmed operating audience.

## Product Purpose

PING is a lightweight, mobile-first uptime monitor for web services on free tiers — services that spin down when idle and cold-boot on the next request. It sends real HTTP requests to configured URLs on a chosen schedule, records exactly what it observed (status codes, response times, failures), and keeps services awake by letting an external scheduler hit its tick endpoint. Success means the operator never has to guess whether a free-tier service is up, slow, or cold-booting — and never sees an invented number.

## Positioning

Honesty of data as the core mechanism, purpose-built for cold-booting free-tier services: every displayed number derives from real recorded checks; unmeasured windows show "—", never an estimate. Alerts may be deferred (confirmations, maintenance windows) but downtime is always recorded and deferred events are never lost — they fire exactly when suppression ends. Render-aware out of the box (platform status, limits, instance-hour math), but deliberately platform-agnostic: any free-tier http(s) service that cold-boots is first-class. A neighboring monitor could not truthfully claim the same strict no-simulation contract.

## Operating Context

- Self-hosted single instance (currently a sandbox dev server; deployable to Render, Fly, a Raspberry Pi, or any always-on host per README).
- Free-tier targets sleep after ~15 min of inactivity and cold-boot in ~30–60 s; a sleeping service cannot wake itself, so an external scheduler (GitHub Actions, cron-job.org, UptimeRobot, plain cron) hits `GET /api/cron/tick` every 5–10 min to wake PING and run all due checks.
- The operator tags monitors with the "account used" (which account/org runs each service) and groups them into folders.
- SQLite database on local disk; history pruned by a configurable retention policy (default 30 days, capped 1 000 checks/monitor).
- External keep-alive math matters: ~750 free instance hours/workspace/month on Render; honest guidance is part of the product.

## Capabilities and Constraints

Capabilities (confirmed, shipping):

- Monitors: any http(s) URL, GET or HEAD, intervals 1 min–1 day, folders, pinning, manual/A–Z/status sorting, drag reorder, per-device sort memory, `/` search focus, ⌘K command palette.
- Real checks: 15 s timeout, 2xx–3xx = up, exact error text on failure; keyword checks (body must contain / must not contain, case-insensitive, first 256 KB, forces GET); latency "slow/degraded" alerts (50–30 000 ms threshold); down-alert confirmations (N consecutive failures before the webhook fires; "confirming N/M" pill).
- Scheduled pings: one-off checks at exact future moments, with results kept in monitor history.
- Maintenance windows: checks still recorded and honest, notifications silenced and deferred, public page shows amber maintenance state.
- Incidents: derived from real check history (30-day window), with admin postmortem notes shown on the public page.
- Public status page: opt-in secret token link (192-bit), custom title, per-monitor hiding, 7d/30d uptime, 30-day daily bars, 20-check sparkline, incident history; shields-style SVG badge, RSS 2.0 feed, dynamic OG share card — all token-gated.
- Webhooks: down/up/slow events on transitions only, per-channel routing and subscriptions, Slack/Discord/structured payloads, SSRF-guarded, honest last-attempt stats, send-test.
- Import/export of configuration as JSON; Render platform status card; README badge snippets; keep-alive YAML copyable from Settings.
- Auth: single scrypt-hashed password + 15-minute admin unlock for Settings; password change revokes all sessions.

Constraints (must be preserved by future work):

- Single-instance assumption: in-process scheduler, in-memory login throttle, module-level concurrency guards are process-local.
- SQLite only; history retention default 30 days + 1 000 checks/monitor; incident notes pruned at a fixed 32 days.
- Min check interval 60 s; ≤200 monitors; ≤5 webhook channels; maintenance windows ≤7 days, schedulable ≤90 days ahead.
- Monitor URLs must be http(s) with a dotted hostname.
- UTC day buckets everywhere (stats, bars, badges) so views align across timezones.
- English-only UI; no i18n requirement recorded.
- Concurrency guards (in-flight per monitor, tick overlap, scheduled-ping optimistic claim) must never be removed to "fix" double triggers.
- `lastStatus` vs `lastNotifiedStatus` divergence is the notification-correctness invariant: suppression holds events, never drops them.

## Brand Commitments

- Name: **PING** (header "PING." with tagline "honest uptime monitoring" — unified across admin header/footer, login, public footer, and share metadata by the 2026-09-15 clarify pass; the earlier "uptime for Render Free" predated the platform-agnostic scope).
- Voice: plain-spoken, honest, technical; no marketing fluff; disclaimers kept factual ("not affiliated with render.com").
- The honesty contract itself is a brand commitment: no simulated data, no invented uptime numbers, ever.

## Evidence on Hand

- `README.md` — full feature claims and free-tier math, written by the project author.
- `CODING_STANDARD.md` — engineering rules (complexity budgets, naming, Conventional Commits).
- A running, browser-verified instance: setup → login → monitor creation → real check recorded (HTTP 200, 87 ms, 100% uptime) verified end-to-end on 2026-09-15.
- No testimonials, press, customer data, or benchmark claims exist; none may be fabricated.

## Product Principles

1. **Honesty above all.** Show only what was really measured; gaps stay gaps; "—" beats a plausible lie.
2. **Built for cold-boot reality.** Free-tier services sleep; waking them and measuring the truth matters more than pretending 24/7.
3. **Deferred, never lost.** Maintenance and confirmations delay notifications — never data, and held alerts fire the moment suppression ends.
4. **One operator, zero ceremony.** Self-hosted, single password, low-maintenance; the tool must never become another service to babysit.
5. **Platform-agnostic honesty.** Render-aware today, but any free-tier http(s) service that cold-boots is first-class.

## Accessibility & Inclusion

No formal WCAG target set by the operator ("keep as is"). Existing effort continues: semantic HTML, ARIA labels/roles, keyboard access (⌘K palette, `/` search focus, 44px touch targets), descriptive alt text. English-only UI.

## Open Decisions

- Binding commitments list intentionally open: operator will add constraints as they come to mind.
