"use client";

import { useEffect, useState } from "react";
import { Bell, ChevronRight, Gauge, Loader2, Plus, ScanSearch, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

type FieldErrors = { url?: string; slow?: string; keyword?: string };

/** Top-aligned label with a compact "?" tooltip instead of helper paragraphs. */
function FieldLabel({
  htmlFor,
  hint,
  children,
}: {
  htmlFor: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1">
      <Label htmlFor={htmlFor} className="text-sm font-medium leading-none">
        {children}
      </Label>
      {hint && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="More information"
              className="grid size-4 place-items-center rounded-full text-[10px] font-bold text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground focus-visible:bg-secondary focus-visible:text-foreground focus-visible:outline-none"
            >
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-56">
            {hint}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setFieldErrors({});
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
      // editing something with advanced values set → start expanded
      setAdvancedOpen(
        !!(
          initial.account ||
          initial.keyword ||
          initial.slowThresholdMs != null ||
          (initial.alertDelay ?? 0) > 0 ||
          initial.folderId
        ),
      );
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
      setAdvancedOpen(false);
    }
  }, [open, initial, defaultFolderId]);

  // Keyword checks need a response body — a HEAD response has none, so GET
  // is forced while a keyword is active.
  const keywordActive = keywordMode !== "off";
  useEffect(() => {
    if (keywordActive && method === "HEAD") setMethod("GET");
  }, [keywordActive, method]);

  const clearError = (key: keyof FieldErrors) =>
    setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

  /** URL check — on blur only nags when something invalid was typed. */
  function checkUrlBlur() {
    if (!url.trim()) {
      clearError("url");
      return;
    }
    if (!normalizeUrl(url)) setFieldErrors((p) => ({ ...p, url: "Not a valid http(s) URL" }));
    else clearError("url");
  }

  function checkSlowBlur() {
    if (slowThreshold.trim() === "") {
      clearError("slow");
      return;
    }
    const n = Number(slowThreshold.trim());
    if (!Number.isInteger(n) || n < 50 || n > 30000)
      setFieldErrors((p) => ({ ...p, slow: "50–30000 ms" }));
    else clearError("slow");
  }

  const advCount =
    (account.trim() ? 1 : 0) +
    (keywordActive && keyword.trim() ? 1 : 0) +
    (slowThreshold.trim() !== "" ? 1 : 0) +
    (alertDelay !== "0" ? 1 : 0) +
    (folderId !== "none" ? 1 : 0);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const next: FieldErrors = {};
    const normalized = normalizeUrl(url);
    if (!url.trim()) next.url = "Required";
    else if (!normalized) next.url = "Not a valid http(s) URL";

    const thresholdNum = slowThreshold.trim() === "" ? null : Number(slowThreshold.trim());
    if (thresholdNum != null && (!Number.isInteger(thresholdNum) || thresholdNum < 50 || thresholdNum > 30000))
      next.slow = "50–30000 ms";

    const trimmedKeyword = keyword.trim();
    if (keywordMode !== "off" && trimmedKeyword === "") next.keyword = "Enter a keyword, or set it Off";

    setFieldErrors(next);
    if (Object.values(next).some(Boolean)) {
      // surface hidden advanced-field errors
      if (next.slow || next.keyword) setAdvancedOpen(true);
      document.getElementById("m-url")?.focus();
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
    (async () => {
      try {
        if (isEdit && initial) {
          await api(`/api/monitors/${initial.id}`, {
            method: "PATCH",
            body: JSON.stringify(body),
          });
          toast({ description: "Monitor updated" });
        } else {
          await api("/api/monitors", { method: "POST", body: JSON.stringify(body) });
          toast({ description: "Monitor created — running its first real check now" });
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
    })();
  }

  const fieldClass = "h-11 sm:h-9";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(e) => e.preventDefault()} // let the URL input autoFocus win
        className={(
          // mobile: bottom sheet / ≥sm: centered card
          "left-0 right-0 bottom-0 top-auto translate-x-0 translate-y-0 rounded-none rounded-t-2xl border-b-0 " +
          "max-h-[92dvh] w-full max-w-none overflow-hidden p-0 gap-0 " +
          "sm:left-1/2 sm:right-auto sm:top-1/2 sm:bottom-auto sm:-translate-x-1/2 sm:-translate-y-1/2 " +
          "sm:rounded-xl sm:border-b sm:max-h-[90dvh] sm:max-w-[440px]"
        ).trim()}
      >
        {/* drag handle — mobile only */}
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-muted-foreground/25 sm:hidden" />

        <div className="flex items-center justify-between pb-2 pl-4 pr-2 pt-2.5 sm:pb-1 sm:pl-5 sm:pt-4">
          <DialogTitle className="text-sm font-semibold leading-none">
            {isEdit ? "Edit monitor" : "New monitor"}
          </DialogTitle>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="grid size-11 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:size-9"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <DialogDescription className="sr-only">
          {isEdit
            ? "Update this monitor. History is kept."
            : "PING will send a real HTTP request to the URL on a schedule."}
        </DialogDescription>

        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          {/* scrollable body — visible fields fit without scrolling by default */}
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pb-4 pt-1 sm:px-5">
            <div className="space-y-2">
              <FieldLabel htmlFor="m-url" hint="Full URL to check — https:// is added for you.">
                URL *
              </FieldLabel>
              <Input
                id="m-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                autoFocus
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  clearError("url");
                }}
                onBlur={checkUrlBlur}
                placeholder="https://my-app.onrender.com"
                aria-invalid={fieldErrors.url ? true : undefined}
                aria-describedby={fieldErrors.url ? "m-url-err" : undefined}
                className={fieldClass}
              />
              {fieldErrors.url && (
                <p id="m-url-err" role="alert" className="text-xs text-down">
                  {fieldErrors.url}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <FieldLabel htmlFor="m-name" hint="Shown on the card instead of the host.">
                Display name
              </FieldLabel>
              <Input
                id="m-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Optional — defaults to host"
                maxLength={80}
                className={fieldClass}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <FieldLabel htmlFor="m-interval" hint="How often PING sends a real HTTP request.">
                  Check interval
                </FieldLabel>
                <Select value={intervalSec} onValueChange={setIntervalSec}>
                  <SelectTrigger id="m-interval" className={fieldClass}>
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

              <div className="space-y-2">
                <FieldLabel htmlFor="m-method" hint="GET reads the body; HEAD is lighter, no body.">
                  Method
                </FieldLabel>
                <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "HEAD")}>
                  <SelectTrigger id="m-method" className={fieldClass}>
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

            {/* advanced — collapsed by default */}
            <details
              open={advancedOpen}
              onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
              className="group rounded-lg border border-border/70 bg-card/40"
            >
              <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-90"
                  aria-hidden="true"
                />
                Advanced
                {advCount > 0 && (
                  <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
                    {advCount} set
                  </span>
                )}
              </summary>

              <div className="space-y-4 border-t border-border/60 px-3 py-3">
                <div className="space-y-2">
                  <FieldLabel htmlFor="m-account" hint="Label for which account runs this service.">
                    Account used
                  </FieldLabel>
                  <Input
                    id="m-account"
                    value={account}
                    onChange={(e) => setAccount(e.target.value)}
                    placeholder="e.g. render — personal@mail.com"
                    maxLength={60}
                    autoComplete="off"
                    className={fieldClass}
                  />
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="m-keyword-mode" hint="Require or forbid text in the response body.">
                    <span className="inline-flex items-center gap-1.5">
                      <ScanSearch className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Keyword check
                    </span>
                  </FieldLabel>
                  <Select
                    value={keywordMode}
                    onValueChange={(v) => setKeywordMode(v as "off" | "contains" | "excludes")}
                  >
                    <SelectTrigger id="m-keyword-mode" className={fieldClass}>
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
                    <div className="space-y-2">
                      <Input
                        id="m-keyword"
                        value={keyword}
                        onChange={(e) => {
                          setKeyword(e.target.value);
                          clearError("keyword");
                        }}
                        placeholder={
                          keywordMode === "contains" ? "e.g. welcome" : "e.g. error"
                        }
                        maxLength={200}
                        autoComplete="off"
                        aria-invalid={fieldErrors.keyword ? true : undefined}
                        aria-describedby={fieldErrors.keyword ? "m-keyword-err" : undefined}
                        className={fieldClass}
                      />
                      {fieldErrors.keyword && (
                        <p id="m-keyword-err" role="alert" className="text-xs text-down">
                          {fieldErrors.keyword}
                        </p>
                      )}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="m-slow" hint="Up checks slower than this show as slow.">
                    <span className="inline-flex items-center gap-1.5">
                      <Gauge className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Slow threshold ms
                    </span>
                  </FieldLabel>
                  <Input
                    id="m-slow"
                    value={slowThreshold}
                    onChange={(e) => {
                      setSlowThreshold(e.target.value.replace(/[^0-9]/g, ""));
                      clearError("slow");
                    }}
                    onBlur={checkSlowBlur}
                    placeholder="e.g. 800 — blank = off"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={5}
                    aria-invalid={fieldErrors.slow ? true : undefined}
                    aria-describedby={fieldErrors.slow ? "m-slow-err" : undefined}
                    className={fieldClass}
                  />
                  {fieldErrors.slow && (
                    <p id="m-slow-err" role="alert" className="text-xs text-down">
                      {fieldErrors.slow}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="m-alert-delay" hint="Failed checks in a row before a down webhook fires.">
                    <span className="inline-flex items-center gap-1.5">
                      <Bell className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      Down-alert delay
                    </span>
                  </FieldLabel>
                  <Select value={alertDelay} onValueChange={setAlertDelay}>
                    <SelectTrigger id="m-alert-delay" className={fieldClass}>
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
                </div>

                <div className="space-y-2">
                  <FieldLabel htmlFor="m-folder" hint="Group monitors in the sidebar.">
                    Folder
                  </FieldLabel>
                  <Select value={folderId} onValueChange={setFolderId}>
                    <SelectTrigger id="m-folder" className={fieldClass}>
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
              </div>
            </details>
          </div>

          {error && (
            <p
              role="alert"
              className="mx-4 mb-2 rounded-md bg-down/10 px-3 py-2 text-xs leading-relaxed text-down sm:mx-5"
            >
              {error}
            </p>
          )}

          {/* sticky footer — always visible, primary full-width on mobile */}
          <div className="flex flex-col-reverse gap-2 border-t border-border/60 bg-background p-3 sm:flex-row sm:justify-end sm:p-4 sm:pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="h-11 w-full text-sm sm:h-9 sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy}
              className="h-11 w-full bg-white text-sm font-semibold text-black hover:bg-zinc-200 sm:h-9 sm:w-auto"
            >
              {busy ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> {isEdit ? "Saving…" : "Adding…"}
                </>
              ) : isEdit ? (
                "Save changes"
              ) : (
                <>
                  <Plus className="size-4" /> Add monitor
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
