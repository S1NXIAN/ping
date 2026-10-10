# PING

An uptime monitor for free-tier web services. It sends real HTTP requests on a
schedule, records exactly what it observed, and never invents a number.

## Language

**Monitor**:
One http(s) URL PING checks, with its own cadence, alerts and history.
_Avoid_: target, site, endpoint

**Check**:
One real HTTP request PING sent, and the status, response time and error it
recorded. The only source of truth about a monitor's health.
_Avoid_: probe, ping, sample

**Interval schedule**:
A monitor checks every N seconds, N between 1 minute and 24 hours. Set as a
preset or as a custom `H`/`M` value.
_Avoid_: recurring, periodic

**Times-of-day schedule**:
A monitor checks at fixed clock times (e.g. 1:00 PM, 3:00 AM) every day,
interpreted in its own timezone.
_Avoid_: scheduled, cron, time-based

**Scheduled ping**:
A one-off check at a single future instant the user picked. Distinct from a
times-of-day schedule, which repeats daily.
_Avoid_: schedule (bare), job

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
A continuous stretch of failed checks, derived from check history. Never
entered by hand.
_Avoid_: outage record, event

**Maintenance window**:
A planned period when checks keep running and recording but alerts are
silenced. Downtime inside one is still recorded.
_Avoid_: downtime, blackout
