# Dashboard session: absolute timeout, not idle-based

PING's single dashboard session expires on an **absolute** timeout counted
from login — never sliding, never idle-based. The duration is an admin setting
with presets (5/15/30/60/120 minutes) and a 15-minute default, enforced
server-side on every authenticated request; the header counts down to it. The
alternative, an idle timeout, was rejected: the threat here is an unattended or
shared browser, and an idle timer keeps a session alive for as long as a
background poll keeps touching it (the dashboard polls every 15 s), so it would
never actually fire in the exact situation it is meant to guard.

## Considered options

- **Idle timeout** — rejected: the dashboard's own polling makes "idle" nearly
  unreachable, so the session would effectively never expire while a tab is open.
- **Sliding expiry (refresh on each request)** — rejected: same failure mode —
  any traffic extends the session indefinitely, defeating the absolute cap.

## Consequences

Every authenticated request re-checks `expiresAt`; a request after expiry is a
401 and the client returns to login. Changing the setting applies to sessions
created afterwards — the current session keeps its original deadline. The
replaced design (a 30-day session plus a separate 15-minute "admin unlock"
HMAC gate in front of Settings) is gone: there is exactly one place a password
is asked for.
