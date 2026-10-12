"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Clock,
  Database,
  Download,
  Eraser,
  FileUp,
  KeyRound,
  Loader2,
  Server,
  ShieldCheck,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  api,
  ApiError,
  formatDateTime,
  formatDuration,
  formatMs,
  timeAgo,
} from "@/lib/ping-client";
import type { AdminInfoResponse, ImportResult, SessionSettingsResponse } from "@/lib/ping-types";
import { cn } from "@/lib/utils";
import { RenderStatusCard } from "./render-status-card";
import { InlineAlert } from "./inline-alert";
import { StatTile } from "./stat-tile";


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

export function AdminView({
  onBack,
  onAuthLost,
}: {
  onBack: () => void;
  /** Session died — sign out. */
  onAuthLost: () => void;
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

  // --- session length ---
  const [sessionSettings, setSessionSettings] = useState<SessionSettingsResponse | null>(null);
  const [sessionBusy, setSessionBusy] = useState(false);

  // --- data retention ---
  const [retentionDraft, setRetentionDraft] = useState("default");
  const [retentionDirty, setRetentionDirty] = useState(false);
  const [retentionBusy, setRetentionBusy] = useState<string | null>(null);

  // --- import ---
  const [importing, setImporting] = useState(false);
  const [fileInput, setFileInput] = useState<HTMLInputElement | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await api<AdminInfoResponse>("/api/admin/info"));
    } catch (err) {
      // A dead session should sign out, not fail silently.
      if (err instanceof ApiError && err.message === "Unauthorized") onAuthLost();
    }
  }, [onAuthLost]);

  useEffect(() => {
    void loadInfo();
    const t = setInterval(() => void loadInfo(), 30_000);
    return () => clearInterval(t);
  }, [loadInfo]);

  // Retention select mirrors the server value unless the user is editing it.
  const retentionCurrent = useMemo(() => {
    const d = info?.storage.retentionDays;
    if (d == null) return "default";
    if (d === 0) return "forever";
    return String(d);
  }, [info]);

  const loadSession = useCallback(async () => {
    try {
      setSessionSettings(await api<SessionSettingsResponse>("/api/admin/session"));
    } catch (err) {
      if (err instanceof ApiError && err.message === "Unauthorized") onAuthLost();
    }
  }, [onAuthLost]);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  async function setSessionMinutes(minutes: number) {
    setSessionBusy(true);
    try {
      const r = await api<SessionSettingsResponse>("/api/admin/session", {
        method: "POST",
        body: JSON.stringify({ sessionMinutes: minutes }),
      });
      setSessionSettings(r);
      toast({ description: `Login remembered for ${minutes} minutes` });
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "Could not save the timeout",
        variant: "destructive",
      });
    } finally {
      setSessionBusy(false);
    }
  }

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
      void loadInfo();
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
      await api("/api/admin/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      toast({ description: "Password changed — all other sessions signed out" });
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } catch (err) {
      setPwError(err instanceof ApiError || err instanceof Error ? err.message : "Failed");
    } finally {
      setPwBusy(false);
    }
  }

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
        }`,
      });
      void loadInfo();
    } catch (err) {
      if (err instanceof ApiError && err.message === "Unauthorized") {
        onAuthLost();
        return;
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

  return (
    <main className="ping-ambient relative min-h-dvh">
      <div className="relative z-10 mx-auto max-w-2xl px-4 pb-16 pt-4 sm:pt-6">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="icon" onClick={onBack} aria-label="Back to dashboard">
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold leading-tight">Settings</h1>
            <p className="text-xs text-muted-foreground">Security, session &amp; data</p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Security */}
          <Section
            icon={KeyRound}
            title="Dashboard password"
            description="PING uses a single shared password. Changing it signs out every other session."
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
              {pwError && <InlineAlert>{pwError}</InlineAlert>}
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

          {/* Session timeout */}
          <Section
            icon={Timer}
            title="Login remembered"
            description="How long a login is remembered before a fresh visit asks for the password again. It never interrupts an open tab — only the next visit re-prompts."
          >
            {sessionSettings == null ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {sessionSettings.presets.map((m) => (
                  <Button
                    key={m}
                    variant={sessionSettings.sessionMinutes === m ? "default" : "outline"}
                    size="sm"
                    disabled={sessionBusy}
                    onClick={() => setSessionMinutes(m)}
                    className={cn(
                      "h-9",
                      sessionSettings.sessionMinutes === m &&
                        "bg-white font-semibold text-black hover:bg-zinc-200",
                    )}
                  >
                    {m} min
                    {m === sessionSettings.defaultMinutes && (
                      <span className="ml-1.5 text-[10px] font-normal opacity-70">default</span>
                    )}
                  </Button>
                ))}
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Counted from the last time you entered the password. Changing it takes effect on
              your next visit.
            </p>
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

          {/* Data & storage */}
          <Section
            icon={Database}
            title="Data & storage"
            description="Everything below is measured from this running instance — no estimates."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <StatTile
                label="Process uptime"
                value={info ? formatDuration(info.processUptimeSec) : "—"}
              />
              <StatTile
                label="Checks stored"
                value={info ? info.storage.checksStored.toLocaleString() : "—"}
              />
              <StatTile
                label="Last tick"
                value={info ? (info.scheduler.lastTickAt ? timeAgo(info.scheduler.lastTickAt) : "—") : "—"}
                valueClassName="text-sm"
              />
              <StatTile
                label="Tick took"
                value={info ? formatMs(info.scheduler.lastTickDurationMs) : "—"}
                valueClassName="text-sm"
              />
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
                Old sessions are always cleaned.
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
