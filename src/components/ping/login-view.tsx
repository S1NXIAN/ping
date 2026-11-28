"use client";

import { useState } from "react";
import { api, ApiError } from "@/lib/ping-client";
import { PingLogo } from "./ping-logo";

export function LoginView({
  initialized,
  onAuthenticated,
}: {
  initialized: boolean;
  onAuthenticated: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isSetup = !initialized;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (isSetup) {
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords don't match.");
        return;
      }
    } else if (!password) {
      setError("Enter your password.");
      return;
    }

    setBusy(true);
    try {
      await api(isSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      onAuthenticated();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : "Something went wrong — try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={busy ? "ping-login is-busy" : "ping-login"}>
      <div className="ping-login-graticule" aria-hidden="true" />

      <div className="ping-login-head">
        <span className="ping-login-live">
          <i aria-hidden="true" />
          {busy ? "Authenticating" : "Idle"}
        </span>
        <span>Display only</span>
      </div>

      <form onSubmit={submit} className="ping-login-panel">
        <PingLogo className="ping-login-tile" />
        <h1 className="ping-login-title">PING.</h1>
        <p className="ping-login-sub">Sign in to watch what your services actually do.</p>

        <div className="ping-login-line">
          <label htmlFor="password" className="ping-login-label">
            {isSetup ? "Set a passphrase" : "Passphrase"}
          </label>
          <div className="ping-login-entry">
            <input
              id="password"
              className="ping-login-input"
              type={show ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSetup ? "at least 8 characters" : "••••••••"}
              autoComplete={isSetup ? "new-password" : "current-password"}
              autoFocus
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="ping-login-eye"
              aria-label={show ? "Hide password" : "Show password"}
            >
              {show ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {isSetup && (
          <div className="ping-login-line">
            <label htmlFor="confirm" className="ping-login-label">
              Confirm
            </label>
            <div className="ping-login-entry">
              <input
                id="confirm"
                className="ping-login-input"
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="repeat it"
                autoComplete="new-password"
              />
            </div>
          </div>
        )}

        {error && (
          <p className="ping-login-err" role="alert">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="ping-login-go">
          {busy ? "Please wait…" : isSetup ? "Secure my dashboard" : "Sign in"}
        </button>
        <p className="ping-login-note">Single operator · local instance</p>
      </form>

      <svg
        className="ping-login-trace"
        viewBox="0 0 1600 260"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path
          className="ping-login-wave"
          pathLength={1000}
          d="M0 150 H150 l12 0 l6 -16 l8 28 l7 -44 l8 58 l7 -38 l5 12 l4 0 H470 l12 0 l6 -10 l7 18 l6 -26 l7 32 l6 -18 l4 4 l3 0 H760"
        />
        {/* unmeasured stretch: drawn dashed, never joined by the pulse */}
        <path className="ping-login-gap" d="M760 150 H960" />
        <path
          className="ping-login-wave"
          pathLength={1000}
          d="M960 150 H1080 l12 0 l7 -34 l8 50 l8 -88 l10 116 l8 -62 l5 18 l4 0 H1300 l14 0 l6 -14 l7 22 l6 -24 l6 16 l4 0 H1600"
        />
        <path
          className="ping-login-pulse"
          pathLength={1000}
          d="M0 150 H150 l12 0 l6 -16 l8 28 l7 -44 l8 58 l7 -38 l5 12 l4 0 H470 l12 0 l6 -10 l7 18 l6 -26 l7 32 l6 -18 l4 4 l3 0 H760"
        />
        <path
          className="ping-login-pulse ping-login-pulse-b"
          pathLength={1000}
          d="M960 150 H1080 l12 0 l7 -34 l8 50 l8 -88 l10 116 l8 -62 l5 18 l4 0 H1300 l14 0 l6 -14 l7 22 l6 -24 l6 16 l4 0 H1600"
        />
      </svg>

      <footer className="ping-login-foot">
        <span>Live service monitoring</span>
        <span>Not affiliated with any hosting provider</span>
      </footer>
    </main>
  );
}
