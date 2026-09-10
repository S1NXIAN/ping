"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Clock,
  Copy,
  Database,
  Download,
  Eraser,
  Eye,
  FileUp,
  Globe,
  HeartPulse,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  LockOpen,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  ApiError,
  copyText,
  formatDateTime,
  formatDuration,
  formatMs,
  timeAgo,
} from "@/lib/ping-client";
import type { AdminInfoResponse, ImportResult, StatusPageInfoResponse } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { NotificationsSection } from "./notifications-section";
import { RenderStatusCard } from "./render-status-card";
import { StatusBadgeSection } from "./status-badge-section";

const GH_ACTIONS_YAML = `name: PING keep-alive
# Free on public repositories. Set the PING_URL repository secret
# to your PING deployment origin, e.g. https://ping-xxxx.onrender.com
on:
  schedule:
    - cron: "*/10 * * * *" # every 10 minutes (GitHub may drift a few)
  workflow_dispatch: # allows a manual run
jobs:
  tick:
    runs-on: ubuntu-latest
    steps:
      - name: Tick PING (runs all due checks)
        run: curl -fsS --max-time 90 "\${{ secrets.PING_URL }}/api/cron/tick" || true
`;

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="ping-fade-up rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="size-4 text-primary" aria-hidden="true" />
        {title}
      </h2>
      {description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>}
      <div className="mt-3.5 space-y-3.5">{children}</div>
    </section>
  );
}

function formatCountdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

export function AdminView({
  unlockExpiresAt,
  onBack,
  onLock,
  onExpired,
  onAuthLost,
  onUnlockRenewed,
}: {
  unlockExpiresAt: string | null;
  onBack: () => void;
  /** User clicked Lock — lock immediately and return to the dashboard. */
  onLock: () => void;
  /** Unlock expired (server 401 "Admin locked" or countdown hit zero). */
  onExpired: () => void;
  /** Session itself died — sign out. */
  onAuthLost: () => void;
  /** Password changed — server re-issued the unlock; refresh the countdown. */
  onUnlockRenewed: (expiresAt: string) => void;
}) {
  const { toast } = useToast();

  // --- change password ---
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);

  // --- runtime info ---
  const [info, setInfo] = useState<AdminInfoResponse | null>(null);

  // --- keep-awake URL (computed client-side to match this deployment) ---
  const [tickUrl, setTickUrl] = useState("");

  // --- public status page ---
  const [statusPage, setStatusPage] = useState<StatusPageInfoResponse | null>(null);
  const [spBusy, setSpBusy] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleDirty, setTitleDirty] = useState(false);

  // --- data retention ---
  const [retentionDraft, setRetentionDraft] = useState("default");
  const [retentionDirty, setRetentionDirty] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState<string | null>(null);

  const statusUrl =
    statusPage?.enabled && statusPage.token
      ? `${typeof window !== "undefined" ? window.location.origin : ""}/?status=${statusPage.token}`
      : "";

  // --- import ---
  const [importing, setImporting] = useState(false);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);

  // --- admin unlock countdown (ticks every second while unlocked) ---
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setTickUrl(`${window.location.origin}/api/cron/tick`);
  }, []);

  const unlockMsLeft = unlockExpiresAt
    ? new Date(unlockExpiresAt).getTime() - nowMs
    : Number.NEGATIVE_INFINITY;

  useEffect(() => {
    if (!unlockExpiresAt) return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [unlockExpiresAt]);

  // Countdown reached zero — let the parent lock + re-prompt.
  useEffect(() => {
    if (unlockExpiresAt && unlockMsLeft <= 0) onExpired();
  }, [unlockExpiresAt, unlockMsLeft, onExpired]);

  const loadStatusPage = useCallback(async () => {
    try {
      const r = await api<StatusPageInfoResponse>("/api/admin/status-page");
      setStatusPage(r);
      if (!titleDirty) setTitleDraft(r.title ?? "");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message.startsWith("Admin locked")) onExpired();
        else if (err.message === "Unauthorized") onAuthLost();
      }
    }
  }, [onExpired, onAuthLost, titleDirty]);

  useEffect(() => {
    loadStatusPage();
  }, [loadStatusPage]);

  async function statusPageAction(
    action: "enable" | "disable" | "regenerate" | "title",
    title?: string,
  ) {
    setSpBusy(action);
    try {
      const r = await api<StatusPageInfoResponse>("/api/admin/status-page", {
        method: "POST",
        body: JSON.stringify(action === "title" ? { action, title: title ?? null } : { action }),
      });
      setStatusPage(r);
      toast({
        description:
          action === "disable"
            ? "Status page disabled — the public link now returns “not found”"
            : action === "regenerate"
              ? "New link generated — old links no longer work"
              : action === "title"
                ? title
                  ? "Custom title saved"
                  : "Custom title cleared"
                : "Status page enabled",
      });
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "Action failed",
        variant: "destructive",
      });
    } finally {
      setSpBusy(null);
    }
  }

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await api<AdminInfoResponse>("/api/admin/info"));
    } catch (err) {
      // A dead unlock or dead session should re-prompt, not fail silently.
      if (err instanceof ApiError) {
        if (err.message.startsWith("Admin locked")) onExpired();
        else if (err.message === "Unauthorized") onAuthLost();
      }
    }
  }, [onExpired, onAuthLost]);

  useEffect(() => {
    loadInfo();
    const t = setInterval(loadInfo, 30_000);
    return () => clearInterval(t);
  }, [loadInfo]);

  // Retention select mirrors the server value unless the user is editing it.
  const retentionCurrent = useMemo(() => {
    const d = info?.storage.retentionDays;
    if (d == null) return "default";
    if (d === 0) return "forever";
    return String(d);
  }, [info]);

  useEffect(() => {
    if (!retentionDirty) setRetentionDraft(retentionCurrent);
  }, [retentionCurrent, retentionDirty]);

  async function retentionAction(action: "set" | "prune") {
    setRetentionBusy(action);
    try {
      if (action === "set") {
        const days =
          retentionDraft === "default"
            ? null
            : retentionDraft === "forever"
              ? 0
              : Number(retentionDraft);
        const r = await api<{ applied: string; retentionDays: number | null }>(
          "/api/admin/retention",
          { method: "POST", body: JSON.stringify({ action: "set", days }) },
        );
        setRetentionDirty(false);
        setRetentionDraft(
          r.retentionDays == null ? "default" : r.retentionDays === 0 ? "forever" : String(r.retentionDays),
        );
        toast({ description: `Retention saved — ${r.applied}` });
      } else {
        const r = await api<{ deleted: number }>('/api/admin/retention', {
          method: "POST",
          body: JSON.stringify({ action: "prune" }),
        });
        toast({
          description:
            r.deleted > 0
              ? `Pruned ${r.deleted.toLocaleString()} old check${r.deleted === 1 ? "" : "s"}`
              : "Nothing to prune — every check is inside the retention window",
        });
      }
      loadInfo();
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "Action failed",
        variant: "destructive",
      });
    } finally {
      setRetentionBusy(null);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwError(null);
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("New passwords don't match.");
      return;
    }
    setPwBusy(true);
    try {
      const r = await api<{ ok: boolean; unlockExpiresAt: string }>("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      toast({ description: "Password changed — all other sessions signed out" });
      onUnlockRenewed(r.unlockExpiresAt);
      setNowMs(Date.now());
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof ApiError || err instanceof Error ? err.message : "Failed");
    } finally {
      setPwBusy(false);
    }
  }

  const onCopy = useCallback(
    async (text: string, what: string) => {
      const ok = await copyText(text);
      toast({ description: ok ? `${what} copied to clipboard` : "Copy failed — select it manually" });
    },
    [toast],
  );

  async function importFile(file: File) {
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const r = await api<ImportResult>("/api/import", {
        method: "POST",
        body: JSON.stringify(parsed),
      });
      toast({
        description: `Imported ${r.created} monitor${r.created === 1 ? "" : "s"}${
          r.skipped ? `, skipped ${r.skipped} duplicate${r.skipped === 1 ? "" : "s"}` : ""
        }${
          r.channelsCreated
            ? `, ${r.channelsCreated} webhook channel${r.channelsCreated === 1 ? "" : "s"}`
            : ""
        }${
          r.windowsCreated
            ? `, ${r.windowsCreated} maintenance window${r.windowsCreated === 1 ? "" : "s"}`
            : ""
        }`,
      });
      loadInfo();
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.message.startsWith("Admin locked")) {
          onExpired();
          return;
        }
        if (err.message === "Unauthorized") {
          onAuthLost();
          return;
        }
      }
      toast({
        description:
          err instanceof Error ? err.message : "Import failed — is this a PING export?",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      if (fileInput) fileInput.value = "";
    }
  }

  const freeHours = useMemo(
    () => (
      <p className="rounded-md border border-warn/25 bg-warn/10 px-3 py-2 text-xs leading-relaxed text-warn/90">
        <strong>The free-hours math, honestly:</strong> Render grants ~750 free instance hours per
        workspace per month. A 31-day month is 744 hours, so only <em>one</em> free service can be
        awake 24/7. Keeping PING always awake plus several other services always awake will exhaust
        the pool and they will all sleep until hours reset. PING helps you stay within what free
        allows — it cannot create 24/7 uptime out of thin air, and no tool honestly can.
      </p>
    ),
    [],
  );

  return (
    <main className="ping-ambient relative min-h-dvh">
      <div className="relative z-10 mx-auto max-w-2xl px-4 pb-16 pt-4 sm:pt-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="icon" onClick={onBack} aria-label="Back to dashboard">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Security, keep-awake setup &amp; data</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {unlockExpiresAt && (
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-none border px-2.5 py-1 text-xs font-medium tabular-nums",
                  unlockMsLeft < 120
                    ? "border-warn/30 bg-warn/10 text-warn"
                    : "border-teal/30 bg-teal/10 text-teal",
                )}
                title={`Settings re-locks at ${formatDateTime(unlockExpiresAt)}`}
              >
                <LockOpen className="size-3" aria-hidden="true" />
                {formatCountdown(unlockMsLeft)}
                <span className="sr-only">until Settings re-locks</span>
              </span>
            )}
            <Button variant="outline" size="sm" onClick={onLock} className="shrink-0">
              <LockKeyhole className="size-3.5" /> Lock
            </Button>
          </div>
        </div>

        <div className="space-y-4">
          {/* Security */}
          <Section
            icon={KeyRound}
            title="Dashboard password"
            description="PING uses a single shared password. Changing it signs out every other session. Settings itself is password-protected — it re-locks 15 minutes after you unlock it, or instantly via the Lock button above."
          >
            <form onSubmit={changePassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="cur-pw">Current password</Label>
                <Input
                  id="cur-pw"
                  type="password"
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="new-pw">New password</Label>
                  <Input
                    id="new-pw"
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="conf-pw">Confirm new password</Label>
                  <Input
                    id="conf-pw"
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
              {pwError && (
                <p className="rounded-md bg-down/10 px-3 py-2 text-xs text-down">{pwError}</p>
              )}
              <Button type="submit" disabled={pwBusy} className="bg-white font-semibold text-black hover:bg-zinc-200">
                {pwBusy ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Updating…
                  </>
                ) : (
                  <>
                    <ShieldCheck className="size-4" /> Update password
                  </>
                )}
              </Button>
            </form>
          </Section>

          {/* Notifications */}
          <NotificationsSection onExpired={onExpired} onAuthLost={onAuthLost} />

          {/* Keep awake */}
          <Section
            icon={HeartPulse}
            title="Keep PING (and your services) awake"
            description="Render Free services spin down after 15 minutes without inbound traffic — and a sleeping service can't wake itself. PING therefore needs a nudge from an external, always-on scheduler. Each nudge below also runs every due monitor check, so one scheduler drives everything."
          >
            <div className="space-y-2.5">
              <Label>Your tick URL</Label>
              <div className="flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-md border bg-muted px-3 py-2 text-xs">
                  {tickUrl || "…"}
                </code>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  onClick={() => onCopy(tickUrl, "Tick URL")}
                >
                  Copy
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Point any external pinger (cron-job.org, UptimeRobot, a Raspberry Pi cron…) at this
                URL every 5–10 minutes. It responds with a JSON summary of the checks it just ran.
                Alternatively use <code className="rounded bg-muted px-1">/api/health</code> for a
                plain keep-alive that doesn't trigger checks.
              </p>
            </div>

            <Separator />

            <div className="space-y-2.5">
              <Label className="flex items-center gap-2">
                Option B — GitHub Actions (free on public repos)
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  onClick={() => onCopy(GH_ACTIONS_YAML, "Workflow YAML")}
                >
                  Copy YAML
                </Button>
              </Label>
              <pre className="max-h-44 overflow-auto rounded-md border bg-muted p-3 text-[10.5px] leading-relaxed">
                <code>{GH_ACTIONS_YAML}</code>
              </pre>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Add the file as <code className="rounded bg-muted px-1">.github/workflows/ping.yml</code>{" "}
                in any repository, then create a <code className="rounded bg-muted px-1">PING_URL</code>{" "}
                secret with your PING origin. GitHub’s free cron has no hard uptime guarantees and
                can drift, but it costs nothing and needs no extra account.
              </p>
            </div>

            <Separator />

            <div className="space-y-2.5">
              <Label>Choosing your cadence</Label>
              <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                <li>
                  <span className="text-foreground/90">Tick ≤ 10 min:</span> PING itself stays awake
                  24/7 — its built-in scheduler then respects each monitor's interval precisely.
                  Costs ~744 instance hours/month.
                </li>
                <li>
                  <span className="text-foreground/90">Tick ≥ 20 min:</span> PING spins down between
                  ticks and cold-boots (~30–60 s) on each nudge — checks then run at the tick
                  cadence, not the configured interval. Uses far fewer free hours.
                </li>
              </ul>
              {freeHours}
            </div>
          </Section>

          {/* Public status page */}
          <Section
            icon={Globe}
            title="Public status page"
            description="Share a read-only link that shows monitor names, live statuses, and 30-day uptime — no login required. URLs, accounts, and folders are never exposed; monitors can be excluded individually from their ⋮ menu."
          >
            {statusPage == null ? (
              <div className="h-16 animate-pulse rounded-lg border bg-muted/30" />
            ) : statusPage.enabled ? (
              <>
                <div className="flex items-center gap-2 rounded-lg border border-up/25 bg-up/10 px-3 py-2.5 text-sm text-up">
                  <span className="relative flex size-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                    <span className="relative inline-flex size-2.5 rounded-full bg-up" />
                  </span>
                  Status page is live
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-auto h-8 bg-card"
                    onClick={() => statusUrl && window.open(statusUrl, "_blank", "noopener")}
                    aria-label="Open the public status page in a new tab"
                  >
                    <Eye className="size-3.5" /> Preview
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    Public link (share this)
                  </Label>
                  <div className="flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-md border bg-muted/40 px-2.5 py-2 text-xs text-foreground/90">
                      {statusUrl || "…"}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      className="shrink-0"
                      onClick={() => onCopy(statusUrl, "Status-page link")}
                      aria-label="Copy status page link"
                    >
                      <Copy className="size-4" />
                    </Button>
                  </div>
                  <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Link2 className="size-3 shrink-0" aria-hidden="true" />
                    Anyone with this link sees monitor names, statuses and uptime — nothing else.
                    The token is 192-bit random and unguessable.
                  </p>
                </div>

                {/* badge + RSS embeds (shares the same token) */}
                <StatusBadgeSection
                  token={statusPage.token ?? ""}
                  monitors={statusPage.monitors ?? []}
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => statusPageAction("regenerate")}
                    disabled={spBusy != null}
                  >
                    {spBusy === "regenerate" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                    New link
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-down hover:text-down"
                    onClick={() => statusPageAction("disable")}
                    disabled={spBusy != null}
                  >
                    {spBusy === "disable" ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <LockKeyhole className="size-3.5" />
                    )}
                    Disable page
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
                  <LockKeyhole className="size-4 shrink-0" aria-hidden="true" />
                  The status page is off — no public link exists right now.
                </div>
                <Button
                  size="sm"
                  onClick={() => statusPageAction("enable")}
                  disabled={spBusy != null}
                  className="bg-white font-semibold text-black hover:bg-zinc-200"
                >
                  {spBusy === "enable" ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin" /> Enabling…
                    </>
                  ) : (
                    <>
                      <Globe className="size-3.5" /> Enable public status page
                    </>
                  )}
                </Button>
              </>
            )}

            {/* custom title (works whether the page is on or off) */}
            <div className="space-y-1.5 border-t pt-3.5">
              <Label htmlFor="sp-title" className="text-xs">
                Custom page title <span className="text-muted-foreground/70">(optional)</span>
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="sp-title"
                  value={titleDraft}
                  maxLength={60}
                  placeholder="e.g. Acme Corp — service status"
                  onChange={(e) => {
                    setTitleDraft(e.target.value);
                    setTitleDirty(true);
                  }}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0"
                  disabled={spBusy != null}
                  onClick={() => {
                    setTitleDirty(false);
                    void statusPageAction("title", titleDraft.trim() || null);
                  }}
                >
                  {spBusy === "title" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Shown as a small label above the banner on the public page. Clear the field and save
                to remove it.
              </p>
            </div>
          </Section>

          {/* Render Free facts */}
          <Section
            icon={Server}
            title="Render Free — status & limits"
            description="Live platform status plus the limits Render publishes. Linked sources only; PING never invents platform data."
          >
            <RenderStatusCard />
            <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>
                <span className="text-foreground/90">750 free instance hours</span> per workspace
                per calendar month, then services sleep until reset.{" "}
                <a
                  className="text-teal hover:underline"
                  href="https://render.com/docs/free"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  render.com/docs/free
                </a>
              </li>
              <li>
                <span className="text-foreground/90">Spins down after 15 min</span> without inbound
                traffic; the next request is delayed while the instance restarts (often tens of
                seconds).{" "}
                <a
                  className="text-teal hover:underline"
                  href="https://render.com/docs/free"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  render.com/docs/free
                </a>
              </li>
              <li>
                <span className="text-foreground/90">512 MB RAM / 0.1 CPU</span> per free web
                service, with an ephemeral filesystem (local files don't survive restarts — export
                your PING config if you redeploy).{" "}
                <a
                  className="text-teal hover:underline"
                  href="https://render.com/pricing"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  render.com/pricing
                </a>
              </li>
              <li>
                Free tier databases and background jobs have their own limits — check Render's docs
                before relying on them.{" "}
                <a
                  className="text-teal hover:underline"
                  href="https://docs.render.com"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  docs.render.com
                </a>
              </li>
            </ul>
            <p className="text-[10px] text-muted-foreground/80">
              Figures as documented by Render at the time of writing — they can change; follow the
              links for current values.
            </p>
          </Section>

          {/* Data & maintenance */}
          <Section
            icon={Database}
            title="Data & maintenance"
            description="Everything below is measured from this running instance — no estimates."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border bg-card/60 px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Process uptime
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">
                  {info ? formatDuration(info.processUptimeSec) : "—"}
                </div>
              </div>
              <div className="rounded-lg border bg-card/60 px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Checks stored
                </div>
                <div className="mt-1 text-base font-semibold tabular-nums">
                  {info ? info.storage.checksStored.toLocaleString() : "—"}
                </div>
              </div>
              <div className="rounded-lg border bg-card/60 px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Last tick
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {info ? (info.scheduler.lastTickAt ? timeAgo(info.scheduler.lastTickAt) : "—") : "—"}
                </div>
              </div>
              <div className="rounded-lg border bg-card/60 px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Tick took
                </div>
                <div className="mt-1 text-sm font-semibold tabular-nums">
                  {info ? formatMs(info.scheduler.lastTickDurationMs) : "—"}
                </div>
              </div>
            </div>

            {/* configurable check-history retention */}
            <div className="space-y-2.5 rounded-lg border bg-card/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="retention" className="text-xs">
                  Check-history retention
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  {info?.storage.lastPrunedAt
                    ? `last pruned ${timeAgo(info.storage.lastPrunedAt)}${
                        info.storage.lastPrunedCount
                          ? ` · ${info.storage.lastPrunedCount.toLocaleString()} removed`
                          : " · nothing removed"
                      }`
                    : "hourly background job"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="min-w-44 flex-1">
                  <Select
                    value={retentionDraft}
                    onValueChange={(v) => {
                      setRetentionDraft(v);
                      setRetentionDirty(true);
                    }}
                  >
                    <SelectTrigger id="retention" className="h-9 w-full" aria-label="Check-history retention">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Default · 30 days + 1,000/monitor cap</SelectItem>
                      <SelectItem value="7">7 days</SelectItem>
                      <SelectItem value="14">14 days</SelectItem>
                      <SelectItem value="30">30 days (no cap)</SelectItem>
                      <SelectItem value="60">60 days</SelectItem>
                      <SelectItem value="90">90 days</SelectItem>
                      <SelectItem value="180">180 days</SelectItem>
                      <SelectItem value="365">365 days</SelectItem>
                      <SelectItem value="forever">Keep forever</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={retentionBusy != null || retentionDraft === retentionCurrent}
                  onClick={() => retentionAction("set")}
                >
                  {retentionBusy === "set" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 shrink-0"
                  disabled={retentionBusy != null}
                  onClick={() => retentionAction("prune")}
                >
                  {retentionBusy === "prune" ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Eraser className="size-3.5" />
                  )}
                  Prune now
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                Checks older than this window are deleted automatically (hourly) — “Prune now”
                applies it immediately. Default keeps 30 days and at most 1,000 checks per monitor;
                a custom number keeps exactly that window; “forever” disables check deletion.
                Scheduled pings, old maintenance windows and expired sessions are always cleaned.
              </p>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              Scheduler{info?.scheduler.running ? " running" : " not started"} — checks due monitors
              every {info?.scheduler.tickIntervalSec ?? 30}s in-process.{" "}
              {(info?.storage.retentionDays ?? null) === 0
                ? "History is kept forever — no automatic check deletion."
                : (info?.storage.retentionDays ?? null) == null
                  ? `History is kept 30 days (max ${(
                      info?.storage.maxChecksPerMonitor ?? 1000
                    ).toLocaleString()} checks per monitor), then pruned automatically.`
                  : `History is kept ${info?.storage.retentionDays} days (no per-monitor cap), then pruned automatically.`}{" "}
              Oldest check: {formatDateTime(info?.storage.oldestCheckAt ?? null)}
              {info?.storage.dbBytes ? ` · database ${(info.storage.dbBytes / 1024).toFixed(0)} KB` : ""}
              {info ? ` · ${info.nodeEnv} mode` : ""}.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <a href="/api/export" download>
                  <Download className="size-3.5" /> Export monitors (JSON)
                </a>
              </Button>
              <input
                ref={(el) => setFileInput(el)}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importFile(f);
                }}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={importing}
                onClick={() => fileInput?.click()}
              >
                {importing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" /> Importing…
                  </>
                ) : (
                  <>
                    <FileUp className="size-3.5" /> Import monitors
                  </>
                )}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                duplicates (same URL) are skipped
              </span>
            </div>
          </Section>

          {/* About */}
          <Section
            icon={Clock}
            title="About PING"
            description="Built to be small, fast, and truthful."
          >
            <p className="text-xs leading-relaxed text-muted-foreground">
              PING sends real HTTP requests on a schedule and shows you exactly what it observed:
              status codes, response times, and the moments things failed. It has no paid tiers, no
              synthetic “100% uptime” claims, and no relationship with render.com. Uptime numbers
              only reflect the checks that actually ran — if PING itself is asleep, it says so via
              the gaps in the history.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
