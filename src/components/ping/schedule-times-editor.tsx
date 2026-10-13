"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MAX_SCHEDULE_TIMES, hasTimeAt } from "@/lib/schedule";
import { cn } from "@/lib/utils";

/** "HH:MM" (24h) -> the "h:mm AM/PM" a person reads. */
export function timeLabel(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/**
 * The times-of-day editor: a list of clock times read in the viewer's own
 * zone. Times are wall-clock strings ("HH:MM"), never instants, so they
 * survive a DST shift as the times the user actually typed.
 */
export function ScheduleTimesEditor({
  times,
  error,
  onChange,
}: {
  times: string[];
  error?: string;
  onChange: (times: string[]) => void;
}) {
  const atCap = times.length >= MAX_SCHEDULE_TIMES;
  // Set when an edit is refused because that clock time is already on the
  // list — shown next to the field so the reverted value isn't a mystery.
  const [duplicate, setDuplicate] = useState<string | null>(null);

  const setAt = (index: number, value: string) => {
    // The native picker yields "HH:MM" or "" while being edited.
    if (!value) return;
    if (hasTimeAt(times, value, index)) {
      // Refuse the edit. State is left untouched, so the controlled input
      // re-renders with its previous value and the chip visibly springs back.
      setDuplicate(timeLabel(value));
      return;
    }
    setDuplicate(null);
    const next = [...times];
    next[index] = value;
    onChange(next);
  };

  const removeAt = (index: number) => {
    setDuplicate(null);
    onChange(times.filter((_, i) => i !== index));
  };

  const add = () => {
    // Guard the cap here rather than relying on the button being hidden: the
    // invariant belongs to the list, not to one control's visibility.
    if (atCap) return;
    // A new row defaults to 9:00 AM — a plausible time, and valid on save.
    let candidate = "09:00";
    for (let h = 9; h < 9 + 24 && hasTimeAt(times, candidate); h++) {
      candidate = `${String(h % 24).padStart(2, "0")}:00`;
    }
    setDuplicate(null);
    onChange([...times, candidate]);
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label className="text-sm font-medium leading-none">Check at</Label>
        {/* Chips flow left-to-right and wrap, each only as wide as its own
            clock time. The add action is the last chip, so it always sits
            where the times are rather than on a row of its own. */}
        <div className="flex flex-wrap items-center gap-2">
          {times.map((t, i) => (
            // Keyed by index alone, never by the time value: a value-based key
            // remounts the input the moment the picker writes a new time, which
            // orphans the open picker and drops the selection. The node must
            // outlive its own value.
            <div key={i} className="relative h-11 w-[5.75rem] sm:h-9">
              {/* The real control, stretched over the chip and fully
                  transparent. opacity:0 hides the ENTIRE native widget —
                  including Firefox's clock icon, which lives inside the
                  control and cannot be reached by any pseudo-element
                  (::-webkit-calendar-picker-indicator is Chromium-only;
                  Firefox declines to honour it — Mozilla bug 1830890).
                  It still owns the value, the change handler and focus.
                  Clicking opens the picker via showPicker(); Firefox only
                  gained a time-picker UI in 154 (bug 1726107), so on older
                  Gecko that call is a no-op and the field stays editable by
                  keyboard — the control is never a dead end. */}
              <input
                id={i === 0 ? "m-times" : undefined}
                type="time"
                value={t}
                onChange={(e) => setAt(i, e.target.value)}
                onClick={(e) => e.currentTarget.showPicker?.()}
                aria-label={`Time ${i + 1} — opens a time picker`}
                className="peer absolute inset-0 h-full w-full cursor-pointer rounded-md opacity-0"
              />
              {/* The visible face: our own type, so the chip looks the same
                  in every engine. pointer-events-none lets the click fall
                  through to the control beneath. whitespace-nowrap is load-
                  bearing: without it "10:00 AM" wraps to a second line and
                  the fixed chip height clips it. The ring is spelled out, not
                  `peer-focus-visible:focus-ring`: a peer variant on the
                  utility nests a second :focus-visible on this sibling and
                  would only fire when the sibling itself is focused. */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 flex items-center whitespace-nowrap rounded-md border border-input pl-2 pr-5 text-xs tabular-nums peer-focus-visible:border-focus peer-focus-visible:ring-[3px] peer-focus-visible:ring-focus/50"
              >
                {timeLabel(t)}
              </div>
              <button
                type="button"
                onClick={() => removeAt(i)}
                aria-label={`Remove ${timeLabel(t)}`}
                title={`Remove ${timeLabel(t)}`}
                // The only icon on the chip. Dim by default so a dozen times
                // stay quiet, rose on hover or keyboard focus. The hit area is
                // grown VERTICALLY only (28px -> 44px, the touch floor): growing
                // it sideways would reach ~40% across a 92px chip and steal
                // clicks meant for the time, and would bleed into the row gap.
                className="absolute right-0.5 top-1/2 z-10 grid size-7 -translate-y-1/2 place-items-center rounded-md text-muted-foreground/50 transition-colors before:absolute before:-inset-y-2 before:content-[''] hover:text-down focus-visible:text-down focus-ring"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            onClick={add}
            title={atCap ? `At most ${MAX_SCHEDULE_TIMES} times` : "Add another time"}
            // Hidden at the cap so the grid is exactly 4×3 (12 cells, 12 times)
            // rather than a stray 13th item on a fourth row. Removing a time
            // brings the control back.
            className={cn("h-11 gap-1.5 text-xs sm:h-9", atCap && "hidden")}
          >
            <Plus className="size-3.5" aria-hidden="true" />
            Add time
          </Button>
        </div>
        {duplicate && (
          <p role="alert" className="text-xs text-down">
            {duplicate} is already on the list.
          </p>
        )}
        {atCap && (
          <p className="text-xs text-muted-foreground">
            {MAX_SCHEDULE_TIMES} times is the maximum — remove one to add another.
          </p>
        )}
        {times.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No times yet — add at least one, e.g. 1:00 PM.
          </p>
        )}
        {/* The times are wall clock in the viewer's own zone, so the label is
            exactly what the user reads. */}
        {times.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Runs at {times.map(timeLabel).join(", ")}
          </p>
        )}
      </div>

      {error && (
        <p id="m-times-err" role="alert" className="text-xs text-down">
          {error}
        </p>
      )}
    </div>
  );
}
