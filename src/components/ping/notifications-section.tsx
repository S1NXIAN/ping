"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Bell,
  Check,
  Crosshair,
  Loader2,
  MessageSquareWarning,
  Plus,
  Send,
  Trash2,
  Webhook as WebhookIcon,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError, timeAgo } from "@/lib/ping-client";
import type { MonitorDTO, WebhookChannelDTO } from "@/lib/ping-types";
import { cn } from "@/lib/utils";

/**
 * Webhook notification channels — POST to Slack/Discord/generic receivers
 * when a monitor goes down or recovers. Each event is one best-effort
 * delivery; the UI shows the honest outcome of the latest attempt.
 */
export function NotificationsSection({
  onExpired,
  onAuthLost,
}: {
  onExpired: () => void;
  onAuthLost: () => void;
}) {
  const { toast } = useToast();
  const [channels, setChannels] = useState<WebhookChannelDTO[] | null>(null);
  const [monitors, setMonitors] = useState<MonitorDTO[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [notifyDown, setNotifyDown] = useState(true);
  const [notifyUp, setNotifyUp] = useState(true);
  const [routeMonitorId, setRouteMonitorId] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const handleErr = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError) {
        if (err.message.startsWith("Admin locked")) {
          onExpired();
          return null;
        }
        if (err.message === "Unauthorized") {
          onAuthLost();
          return null;
        }
        return err.message;
      }
      return err instanceof Error ? err.message : fallback;
    },
    [onExpired, onAuthLost],
  );

  const load = useCallback(async () => {
    try {
      setChannels(await api<WebhookChannelDTO[]>("/api/webhooks"));
    } catch (err) {
      handleErr(err, "Failed to load channels");
    }
  }, [handleErr]);

  useEffect(() => {
    load();
    // monitor list for routing dropdowns (session-guarded, no admin lock needed)
    api<{ monitors: MonitorDTO[] }>("/api/overview")
      .then((r) => setMonitors(r.monitors))
      .catch(() => undefined);
  }, [load]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function addChannel(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    try {
      const ch = await api<WebhookChannelDTO>("/api/webhooks", {
        method: "POST",
        body: JSON.stringify({
          name,
          url,
          notifyDown,
          notifyUp,
          monitorId: routeMonitorId === "all" ? null : routeMonitorId,
        }),
      });
      setChannels((prev) => [...(prev ?? []), ch]);
      setName("");
      setUrl("");
      setRouteMonitorId("all");
      toast({ description: `Channel “${ch.name}” added — send it a test to verify` });
    } catch (err) {
      const msg = handleErr(err, "Failed to add channel");
      if (msg) toast({ description: msg, variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function patchChannel(id: string, data: Record<string, unknown>) {
    setBusyId(id);
    try {
      const updated = await api<WebhookChannelDTO>(`/api/webhooks/${id}`, {
        method: "PATCH",
        body: JSON.stringify(data),
      });
      setChannels((prev) => (prev ?? []).map((c) => (c.id === id ? updated : c)));
    } catch (err) {
      const msg = handleErr(err, "Update failed");
      if (msg) toast({ description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function deleteChannel(ch: WebhookChannelDTO) {
    setBusyId(ch.id);
    try {
      await api(`/api/webhooks/${ch.id}`, { method: "DELETE" });
      setChannels((prev) => (prev ?? []).filter((c) => c.id !== ch.id));
      toast({ description: `Channel “${ch.name}” deleted` });
    } catch (err) {
      const msg = handleErr(err, "Delete failed");
      if (msg) toast({ description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  async function testChannel(ch: WebhookChannelDTO) {
    setBusyId(ch.id);
    try {
      const r = await api<{ ok: boolean; statusCode: number | null; error: string | null; ms: number }>(
        `/api/webhooks/${ch.id}/test`,
        { method: "POST" },
      );
      await load(); // refresh last-delivery stats
      if (r.ok) {
        toast({ description: `Test delivered — receiver answered HTTP ${r.statusCode} in ${r.ms} ms` });
      } else {
        toast({
          description: `Test failed — ${r.error ?? "receiver rejected it"}`,
          variant: "destructive",
        });
      }
    } catch (err) {
      const msg = handleErr(err, "Test failed");
      if (msg) toast({ description: msg, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="ping-fade-up rounded-xl border bg-card p-4 sm:p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <Bell className="size-4 text-primary" aria-hidden="true" />
        Notifications
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Get a webhook POST the moment a monitor goes down or recovers. Works with Slack
        incoming-webhook URLs, Discord webhook URLs, and any generic JSON receiver. Each event is
        one best-effort delivery (10 s timeout, no retries) — the status below is the honest
        outcome of the latest attempt.
      </p>

      <div className="mt-3.5 space-y-3.5">
        {channels == null ? (
          <div className="h-20 animate-pulse rounded-lg border bg-muted/30" />
        ) : channels.length === 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-dashed bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            <MessageSquareWarning className="size-4 shrink-0" aria-hidden="true" />
            No channels yet — add a webhook URL below to start getting alerts.
          </div>
        ) : (
          <ul className="space-y-2.5">
            {channels.map((ch) => (
              <li key={ch.id} className="rounded-lg border bg-card/60 p-3">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <WebhookIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="text-sm font-medium">{ch.name}</span>
                  <span className="flex items-center gap-1">
                    {ch.notifyDown && <EventBadge tone="down">down</EventBadge>}
                    {ch.notifyUp && <EventBadge tone="up">up</EventBadge>}
                  </span>
                  {monitors.length > 0 && (
                    <Select
                      value={ch.monitorId ?? "all"}
                      onValueChange={(v) =>
                        patchChannel(ch.id, { monitorId: v === "all" ? null : v })
                      }
                      disabled={busyId === ch.id}
                    >
                      <SelectTrigger
                        className={cn(
                          "h-6 w-auto max-w-[150px] gap-1 rounded-full border px-2 text-[10px] font-medium",
                          ch.monitorId
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted text-muted-foreground",
                        )}
                        aria-label={`Route channel ${ch.name} to a monitor`}
                        title={
                          ch.monitorId
                            ? `Only events for ${ch.monitorName ?? "this monitor"}`
                            : "Receives events for every monitor"
                        }
                      >
                        <Crosshair className="size-3 shrink-0" aria-hidden="true" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All monitors</SelectItem>
                        {monitors.map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="max-w-[220px] truncate">{m.name}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                  <span
                    className={cn(
                      "ml-auto text-[11px]",
                      ch.enabled ? "text-muted-foreground" : "text-warn",
                    )}
                  >
                    {ch.enabled ? "enabled" : "paused"}
                  </span>
                  <Switch
                    checked={ch.enabled}
                    onCheckedChange={(v) => patchChannel(ch.id, { enabled: v })}
                    disabled={busyId === ch.id}
                    aria-label={`${ch.enabled ? "Pause" : "Enable"} channel ${ch.name}`}
                  />
                </div>
                <div className="mt-1.5 truncate font-mono text-[11px] text-muted-foreground">
                  {ch.url}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                  {ch.lastDeliveryAt ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        ch.lastOk ? "text-up" : "text-down",
                      )}
                    >
                      {ch.lastOk ? (
                        <Check className="size-3" aria-hidden="true" />
                      ) : (
                        <XCircle className="size-3" aria-hidden="true" />
                      )}
                      {ch.lastOk ? "delivered" : "failed"} {timeAgo(ch.lastDeliveryAt, now)}
                      {!ch.lastOk && ch.lastError && ` — ${ch.lastError}`}
                    </span>
                  ) : (
                    <span>never delivered to</span>
                  )}
                  <span className="tabular-nums">{ch.deliveries} total</span>
                </div>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs"
                    onClick={() => testChannel(ch)}
                    disabled={busyId === ch.id}
                  >
                    {busyId === ch.id ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <Send className="size-3.5" />
                    )}
                    Send test
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2.5 text-xs text-down hover:text-down"
                    onClick={() => deleteChannel(ch)}
                    disabled={busyId === ch.id}
                  >
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* add form */}
        <form onSubmit={addChannel} className="space-y-2.5 rounded-lg border bg-muted/20 p-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="wh-name" className="text-xs">
                Name
              </Label>
              <Input
                id="wh-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Team Slack"
                maxLength={60}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wh-url" className="text-xs">
                Webhook URL
              </Label>
              <Input
                id="wh-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                required
              />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={notifyDown} onCheckedChange={(v) => setNotifyDown(v === true)} />
              Notify on down
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Checkbox checked={notifyUp} onCheckedChange={(v) => setNotifyUp(v === true)} />
              Notify on recovery
            </label>
            {monitors.length > 0 && (
              <div className="flex items-center gap-1.5">
                <Label htmlFor="wh-route" className="text-xs text-muted-foreground">
                  Route
                </Label>
                <Select value={routeMonitorId} onValueChange={setRouteMonitorId}>
                  <SelectTrigger
                    id="wh-route"
                    className="h-8 w-[150px] text-xs"
                    aria-label="Route this channel"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All monitors</SelectItem>
                    {monitors.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        <span className="max-w-[220px] truncate">{m.name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              type="submit"
              size="sm"
              disabled={adding || (!notifyDown && !notifyUp)}
              className="ml-auto h-7 bg-white px-3 text-xs font-semibold text-black hover:bg-zinc-200"
            >
              {adding ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" /> Adding…
                </>
              ) : (
                <>
                  <Plus className="size-3.5" /> Add channel
                </>
              )}
            </Button>
          </div>
          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Route a channel to one monitor to keep that monitor&rsquo;s alerts separate from the rest.
            Payload: <code className="rounded bg-muted px-1">text</code> (Slack),{" "}
            <code className="rounded bg-muted px-1">content</code> (Discord) and a structured{" "}
            <code className="rounded bg-muted px-1">{"{ event, monitor, check }"}</code> object —
            receivers pick what they understand.
          </p>
        </form>
      </div>
    </section>
  );
}

function EventBadge({ tone, children }: { tone: "down" | "up"; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-px text-[10px] font-medium uppercase tracking-wide",
        tone === "down"
          ? "border-down/30 bg-down/10 text-down"
          : "border-up/30 bg-up/10 text-up",
      )}
    >
      {children}
    </span>
  );
}
