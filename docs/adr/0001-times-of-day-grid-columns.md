# Times-of-day chips: 4×3 on desktop, 3×4 on mobile

The schedule editor lays clock-time chips out in a wrapping grid. The
requirement was "4x3 not 3x4", but four columns only fit where the dialog is
wide enough: at a 390px viewport four chips would each get ≤83px, under the
~90px a `12:00 PM` chip needs for its text plus its remove button. Forcing
four columns on mobile would therefore reintroduce the AM/PM truncation the
same request was fixing. Mobile stays 3×4 — a deliberate deviation from the
stated requirement, not an oversight. The constraint is the dialog width, so
the grid stays 4×3 at every width from `sm` up.

## Considered options

- **Four columns at every width** — rejected: clips the AM/PM suffix at 390px.
- **Shrink the chip on mobile** (smaller type or a narrower remove target) —
  rejected: 12px is already the floor for form-field text, and the remove
  target would fall below the 44px touch minimum.

## Consequences

A reader comparing the code to the "4×3" requirement will see 3×4 on a phone.
That is intended. Do not "fix" it to four columns without re-measuring the
chip against the dialog width at 390px.
