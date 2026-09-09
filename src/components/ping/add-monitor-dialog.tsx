"use client";

import { useEffect, useState } from "react";
import { Globe, Loader2, Plus, UserRound } from "lucide-react";
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
    } else {
      setName("");
      setUrl("");
      setFolderId(defaultFolderId ?? "none");
      setIntervalSec("300");
      setMethod("GET");
      setAccount("");
    }
    setError(null);
  }, [open, initial, defaultFolderId]);

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

    const body: Record<string, unknown> = {
      url: normalized,
      intervalSec: Number(intervalSec),
      method,
      folderId: folderId === "none" ? null : folderId,
      account: account.trim(),
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
                  <SelectItem value="HEAD">HEAD</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
