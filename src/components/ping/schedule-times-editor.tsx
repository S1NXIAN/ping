"use client";

import { useState } from "react";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_SCHEDULE_TIMES, IANA_TIMEZONES } from "@/lib/schedule";

/** "HH:MM" (24h) -> the "h:mm AM/PM" a person reads. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The times-of-day editor: a list of clock times plus the zone they're read
 * in. Times are wall-clock strings ("HH:MM"), never instants, so they survive
 * a timezone change or a DST shift as the times the user actually typed.
 */
export function ScheduleTimesEditor({
  times,
  timezone,
  error,
  onChange,
  onTimezoneChange,
}: {
  times: string[];
  timezone: string;
  error?: string;
  onChange: (times: string[]) => void;
  onTimezoneChange: (tz: string) => void;
}) {
  const atCap = times.length >= MAX_SCHEDULE_TIMES;
  const [pickerOpen, setPickerOpen] = useState(false);

  const setAt = (index: number, value: string) => {
    const next = [...times];
    // The native picker yields "HH:MM" or "" while being edited.
    if (value) next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => onChange(times.filter((_, i) => i !== index));

  const add = () => {
    // A new row defaults to 9:00 AM — a plausible time, and valid on save.
    const used = new Set(times);
    let candidate = "09:00";
    for (let h = 9; h < 9 + 24 && used.has(candidate); h++) {
      candidate = `${String(h % 24).padStart(2, "0")}:00`;
    }
    onChange([...times, candidate]);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium leading-none">Check at</Label>
        {times.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No times yet — add at least one, e.g. 1:00 PM.
          </p>
        )}
        {times.map((t, i) => (
          <div key={`${t}-${i}`} className="flex items-center gap-2">
            <Input
              id={i === 0 ? "m-times" : undefined}
              type="time"
              value={t}
              onChange={(e) => setAt(i, e.target.value)}
              aria-label={`Time ${i + 1}`}
              // Lines up with the schedule selector: full row on mobile (where
              // the grid has collapsed to one column), and the selector's own
              // column width from sm up.
              className="h-11 min-w-0 flex-1 tabular-nums sm:h-9 sm:flex-none sm:w-[calc(50%-0.5rem)]"
            />
            <span className="text-xs text-muted-foreground">daily</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeAt(i)}
              aria-label={`Remove ${timeLabel(t)}`}
              className="ml-auto size-11 shrink-0 text-muted-foreground hover:text-down sm:size-9"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={add}
          disabled={atCap}
          title={atCap ? `At most ${MAX_SCHEDULE_TIMES} times` : "Add another time"}
          className="h-11 w-full gap-1.5 text-xs sm:h-9"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          Add time{atCap ? ` (max ${MAX_SCHEDULE_TIMES})` : ""}
        </Button>
      </div>

      <div className="space-y-2">
        <Label htmlFor="m-timezone" className="text-sm font-medium leading-none">
          Timezone
        </Label>
        <Button
          id="m-timezone"
          type="button"
          variant="outline"
          onClick={() => setPickerOpen(true)}
          className="h-11 w-full justify-between text-xs font-normal sm:h-9"
          aria-label={`Timezone: ${timezone.replace(/_/g, " ")}`}
        >
          <span className="truncate">{timezone.replace(/_/g, " ")}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
        </Button>
        {/* 400+ zones need search, so the picker is the same CommandDialog the
            palette uses rather than a 400-row dropdown. */}
        <CommandDialog
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          title="Timezone"
          description="Search for a timezone"
        >
          <CommandInput placeholder="Search timezones…" />
          <CommandList className="max-h-72">
            <CommandEmpty>No timezone found.</CommandEmpty>
            {IANA_TIMEZONES.map((tz) => (
              <CommandItem
                key={tz}
                value={tz}
                onSelect={() => {
                  onTimezoneChange(tz);
                  setPickerOpen(false);
                }}
              >
                {tz.replace(/_/g, " ")}
              </CommandItem>
            ))}
          </CommandList>
        </CommandDialog>
        {/* The times are wall clock, so the label is what the user reads. */}
        <p className="text-xs text-muted-foreground">
          {times.length > 0
            ? `Runs at ${times.map(timeLabel).join(", ")} — ${timezone.replace(/_/g, " ")}`
            : `Times are read in ${timezone.replace(/_/g, " ")}`}
        </p>
      </div>

      {error && (
        <p id="m-times-err" role="alert" className="text-xs text-down">
          {error}
        </p>
      )}
    </div>
  );
}
