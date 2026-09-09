"use client";

import { useEffect, useState } from "react";
import { Bell, Gauge, Globe, Loader2, Plus, ScanSearch, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError, normalizeUrl } from "@/lib/ping-client";
import type { FolderDTO, MonitorDTO } from "@/lib/ping-types";

const INTERVALS = [
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "300", label: "5 minutes (recommended)" },
  { value: "600", label: "10 minutes" },
  { value: "1800", label: "30 minutes" },
  { value: "3600", label: "1 hour" },
  { value: "21600", label: "6 hours" },
  { value: "43200", label: "12 hours" },
  { value: "86400", label: "1 day" },
];

/** value = extra confirmations; label = total failed checks needed. */
const ALERT_DELAYS = [
  { value: "0", label: "Immediately (1st failed check)" },
  { value: "1", label: "After 2 failed checks" },
  { value: "2", label: "After 3 failed checks" },
  { value: "3", label: "After 4 failed checks" },
  { value: "5", label: "After 6 failed checks" },
];

const KEYWORD_MODES = [
  { value: "off", label: "Off (status code only)" },
  { value: "contains", label: "Body must contain it" },
  { value: "excludes", label: "Body must not contain it" },
];

export function AddMonitorDialog({
  open,
  onOpenChange,
  folders,
  defaultFolderId,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folders: FolderDTO[];
  defaultFolderId?: string | null;
  initial?: MonitorDTO | null; // present = edit mode
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!initial;

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [folderId, setFolderId] = useState<string>("none");
  const [intervalSec, setIntervalSec] = useState("300");
  const [method, setMethod] = useState<"GET" | "HEAD">("GET");
  const [account, setAccount] = useState("");
  const [keywordMode, setKeywordMode] = useState<"off" | "contains" | "excludes">("off");
  const [keyword, setKeyword] = useState("");
  const [slowThreshold, setSlowThreshold] = useState("");
  const [alertDelay, setAlertDelay] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setUrl(initial.url);
      setFolderId(initial.folderId ?? "none");
      setIntervalSec(String(initial.intervalSec));
      setMethod(initial.method);
      setAccount(initial.account ?? "");
      setKeywordMode(initial.keyword ? initial.keywordMode : "off");
      setKeyword(initial.keyword ?? "");
      setSlowThreshold(initial.slowThresholdMs != null ? String(initial.slowThresholdMs) : "");
      setAlertDelay(String(initial.alertDelay ?? 0));
    } else {
      setName("");
      setUrl("");
      setFolderId(defaultFolderId ?? "none");
      setIntervalSec("300");
      setMethod("GET");
      setAccount("");
      setKeywordMode("off");
      setKeyword("");
      setSlowThreshold("");
      setAlertDelay("0");
    }
    setError(null);
  }, [open, initial, defaultFolderId]);

  // Keyword checks need a response body — a HEAD response has none, so GET
  // is forced while a keyword is active.
  const keywordActive = keywordMode !== "off";
  useEffect(() => {
    if (keywordActive && method === "HEAD") setMethod("GET");
  }, [keywordActive, method]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const normalized = normalizeUrl(url);
    if (!normalized) {
      setError("Enter a valid URL, e.g. https://my-app.onrender.com");
      return;
    }
    if (intervalSec === "custom") {
      setError("Pick a check interval");
      return;
    }

    const thresholdNum = slowThreshold.trim() === "" ? null : Number(slowThreshold.trim());
    if (thresholdNum != null) {
      if (!Number.isInteger(thresholdNum)) {
        setError("Slow threshold must be a whole number of milliseconds");
        return;
      }
      if (thresholdNum < 50 || thresholdNum > 30000) {
        setError("Slow threshold must be between 50 and 30000 ms");
        return;
      }
    }

    const trimmedKeyword = keyword.trim();
    if (keywordMode !== "off" && trimmedKeyword === "") {
      setError("Enter a keyword, or set the keyword check to Off");
      return;
    }

    const body: Record<string, unknown> = {
      url: normalized,
      intervalSec: Number(intervalSec),
      method,
      folderId: folderId === "none" ? null : folderId,
      account: account.trim(),
      keyword: keywordMode === "off" ? null : trimmedKeyword,
      keywordMode: keywordMode === "off" ? "contains" : keywordMode,
      slowThresholdMs: thresholdNum,
      alertDelay: Number(alertDelay),
    };
    const trimmedName = name.trim();
    if (trimmedName) body.name = trimmedName;

    setBusy(true);
    try {
      if (isEdit && initial) {
        await api(`/api/monitors/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        toast({ description: "Monitor updated" });
      } else {
        await api("/api/monitors", { method: "POST", body: JSON.stringify(body) });
        toast({
          description: "Monitor created — running its first real check now",
        });
      }
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(
        err instanceof ApiError || err instanceof Error ? err.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Globe className="size-4 text-primary" aria-hidden="true" />
            {isEdit ? "Edit monitor" : "New monitor"}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the target, interval, or folder. History is kept."
              : "PING will send a real HTTP request to this URL on a schedule."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="m-url">URL *</Label>
            <Input
              id="m-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://my-app.onrender.com"
              inputMode="url"
              autoComplete="off"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-name">Display name</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Optional — defaults to the host"
              maxLength={80}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-account" className="flex items-center gap-1.5">
              <UserRound className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Account used <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="m-account"
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="e.g. render — personal@mail.com"
              maxLength={60}
              autoComplete="off"
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              A label for which account runs this service — useful when you juggle several Render/GitHub
              accounts. Shown as a chip on the card and searchable.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="m-interval">Check interval</Label>
              <Select value={intervalSec} onValueChange={setIntervalSec}>
                <SelectTrigger id="m-interval">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INTERVALS.map((i) => (
                    <SelectItem key={i.value} value={i.value}>
                      {i.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="m-method">Method</Label>
              <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "HEAD")}>
                <SelectTrigger id="m-method">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET (recommended)</SelectItem>
                  <SelectItem value="HEAD" disabled={keywordActive}>
                    HEAD{keywordActive ? " — needs a body" : ""}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-keyword-mode" className="flex items-center gap-1.5">
              <ScanSearch className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Keyword check <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Select
              value={keywordMode}
              onValueChange={(v) => setKeywordMode(v as "off" | "contains" | "excludes")}
            >
              <SelectTrigger id="m-keyword-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEYWORD_MODES.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {keywordActive && (
              <Input
                id="m-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={
                  keywordMode === "contains"
                    ? "e.g. “welcome” — must appear in the page"
                    : "e.g. “error” — must NOT appear in the page"
                }
                maxLength={200}
                autoComplete="off"
              />
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {keywordActive
                ? "Case-insensitive text search over the first 256 KB of the response body — catches “HTTP 200 but the page is broken”. Always checked with GET, even if the method above says HEAD."
                : "Beyond the status code: require (or forbid) a word in the response body, so a 200 from a broken page still counts as down."}
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-slow" className="flex items-center gap-1.5">
              <Gauge className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Slow threshold <span className="font-normal text-muted-foreground">(ms, optional)</span>
            </Label>
            <Input
              id="m-slow"
              value={slowThreshold}
              onChange={(e) => setSlowThreshold(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="e.g. 800 — blank = off"
              inputMode="numeric"
              autoComplete="off"
              maxLength={5}
            />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              When an up check takes longer than this, the monitor shows a "slow" state, the public
              status page marks it degraded, and channels with slow alerts are notified. 50–30000 ms.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-alert-delay" className="flex items-center gap-1.5">
              <Bell className="size-3.5 text-muted-foreground" aria-hidden="true" />
              Down-alert delay
            </Label>
            <Select value={alertDelay} onValueChange={setAlertDelay}>
              <SelectTrigger id="m-alert-delay">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALERT_DELAYS.map((d) => (
                  <SelectItem key={d.value} value={d.value}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Wait for consecutive failures before a “down” webhook fires — avoids false alarms from
              one flaky check. Downtime is recorded and shown immediately either way.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="m-folder">Folder</Label>
            <Select value={folderId} onValueChange={setFolderId}>
              <SelectTrigger id="m-folder">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No folder</SelectItem>
                {folders.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="rounded-md bg-down/10 px-3 py-2 text-xs text-down">{error}</p>
          )}

          <DialogFooter className="gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="bg-white text-black font-semibold hover:bg-zinc-200"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                <>
                  <Plus className="size-4" /> Add monitor
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
