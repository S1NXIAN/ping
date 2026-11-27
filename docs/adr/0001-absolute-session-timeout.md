# Dashboard session: absolute re-prompt window, not idle-based

PING's dashboard login is remembered for a fixed **window counted from the
last password entry** — never sliding, never idle-based. The length is an
admin setting with presets (5/15/30/60/120 minutes) and a 15-minute default.
Inside the window a fresh visit goes straight to the dashboard; once it has
lapsed, the next visit shows the login screen again, and re-entering the
password starts a fresh window. The window is enforced when the page loads,
not by invalidating the session: an open tab is never interrupted, and its
API calls keep working. The Session itself never expires — it ends only on
logout or a password change. The alternative, an idle timeout, was rejected:
the threat here is an unattended or shared browser, and an idle timer keeps a
session alive for as long as a background poll keeps touching it (the
dashboard polls every 15 s), so it would never actually fire in the exact
situation it is meant to guard.

## Considered options

- **Idle timeout** — rejected: the dashboard's own polling makes "idle" nearly
  unreachable, so the session would effectively never expire while a tab is open.
- **Sliding expiry (refresh on each request)** — rejected: same failure mode —
  any traffic extends the session indefinitely, defeating the cap.

## Consequences

The server reports `authenticated` (the Session exists) and `windowOpen` (the
window is still open) separately; the client enters the dashboard only when
both hold. Changing the setting applies to the next password entry — the
current window keeps its original deadline. Because the Session is long-lived,
an open, left, or stolen browser stays signed in until logout or a password
change; the window is a re-prompt convenience, not a revocation. The replaced design (a 30-day session
plus a separate 15-minute "admin unlock" HMAC gate in front of Settings) is
gone: there is exactly one place a password is asked for.
