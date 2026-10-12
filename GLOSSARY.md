# PING

An uptime monitor for free-tier web services. It sends real HTTP requests on a
schedule, records exactly what it observed, and never invents a number.

## Language

**Monitor**:
One http(s) URL PING checks, with its own cadence and history.
_Avoid_: target, site, endpoint

**Check**:
One real HTTP request PING sent, and the status, response time and error it
recorded. The only source of truth about a monitor's health.
_Avoid_: probe, ping, sample

**Monitor status**:
The four-value summary a surface shows for a monitor: `up`, `down`, `paused`
or `pending`. Only `up` and `down` are measured health, from the latest Check.
`paused` is a configuration state (checks are off, not failing) and `pending`
is the absence of any Check yet — neither is a health verdict. These are the
stored values; the display word for `up` is **live** (title-case "Live" in
headline pills, lowercase "live" in dense fragments — tooltips, tables, aria
labels), from `statusLabel`/`statusWord` in `src/components/ping/status-dot.tsx`.
_Avoid_: state, condition (and do not read `paused`/`pending` as health)

**Slow (degraded)**:
The middle state of an `up` monitor whose recent up Checks average above the
configured latency threshold (`slowThresholdMs`). Judged from the **average**
of the most recent up Checks — the same recent-Checks window the card bars
show — so one slow sample cannot mislabel a healthy monitor and one fast
sample cannot hide a slow one. A monitor with no up Checks in the window, no
threshold, or a non-`up` status is never slow. One word, one meaning: the card
pill, the fleet slow count and the detail sheet all say "slow".
_Avoid_: degraded (in prose), latency alert, warning

**Self-monitor**:
The one Monitor PING creates to check its own health endpoint
(`/api/health`) every 3 minutes, so the operator can see whether PING itself
is up and its own traffic helps keep the instance awake. It is an ordinary
Monitor otherwise — visible, editable and deletable — and a durable marker
keeps creation idempotent so repeated boots never make a second one.
_Avoid_: heartbeat, internal monitor

**Session**:
The single dashboard login, remembered for a **window counted from the last
password entry** (no sliding, no idle detection). Its length is an admin
setting (presets 5/15/30/60/120 minutes, default 15). Inside the window a
fresh visit goes straight to the dashboard; once it has lapsed the next visit
asks for the password again, and re-entering it starts a fresh window. The
window is never enforced against an open tab — it is a re-prompt convenience,
not a revocation.
_Avoid_: token, cookie, unlock

**Interval schedule**:
A monitor checks every N seconds, N between 1 minute and 24 hours. Set as a
preset or as a custom `H`/`M` value.
_Avoid_: recurring, periodic

**Times-of-day schedule**:
A monitor checks at fixed clock times (e.g. 1:00 PM, 3:00 AM) every day,
interpreted in its own timezone.
_Avoid_: scheduled, cron, time-based

**Scheduled instant**:
The moment a times-of-day schedule says a check should run, as an absolute
point in time. Derived from the clock times and the monitor's timezone.
_Avoid_: slot, due time

**Bounded catch-up**:
When PING was asleep at a scheduled instant, it runs that check on waking —
but only the most recent one. A wake after several missed instants runs one
check, never a backlog.
_Avoid_: backfill, retry

**Nominal period**:
The period a times-of-day schedule is treated as having, derived from its
largest gap between consecutive times (1:00 PM + 3:00 AM → 14 hours). Used
only to judge whether a gap in check history means PING was asleep.
_Avoid_: interval (for a times-of-day monitor)

**Incident**:
A continuous stretch of failed Checks, derived from check history and never
stored or entered by hand. An **ongoing** Incident (no end yet) is pinned to
the top of the incidents list and is exempt from the list's size cap, so a
long outage can never be buried under newer ones or dropped — the exempt set
is itself bounded.
_Avoid_: outage record, event
