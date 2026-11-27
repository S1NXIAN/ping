# Persisted formats: current-format-only, migrate the operator's export

PING stores monitor configuration as JSON exports and as rows in SQLite. The
app ships one current format. When that shape changes, the agent asks the
operator for an export (or the affected rows), updates that data to the new
shape, and re-imports it. The app carries no runtime branch for the old shape.

This replaces the previous compatibility habit. The interval clamp and the
import defaults for absent fields were removed in `4757e25`; the boot-time
HEAD+keyword repair was removed in `49a2049`. Each was permanent code for a
one-time migration in a single-operator product.

## Decision

- Ship current-format-only code. Validation accepts the current shape and
  rejects anything else.
- Ask the operator for the data when the shape changes. Use their export file
  or the affected database rows.
- Update the data yourself with a one-off transform. Show the result and get
  approval before replacing live data.
- Keep the transform outside the app. It is a one-off, not a runtime path, a
  migration framework, or a committed compatibility layer.
- **No runtime compatibility branch.** Do not add defaults for absent fields,
  boot-time repairs, out-of-range clamps, or dual-format parsers. Migrate the
  data instead.

## Agent procedure

1. Identify the persisted field or shape that changed and the current-format
   value it must become. Done when the target shape is written down.
2. Ask the operator for the export file or the affected rows. Done when the
   data is in hand.
3. Write and run a one-off transform. Report the changed rows and any values
   the transform cannot map. Done when every row has a target value.
4. Ask for approval, then replace or re-import the data. Done when the app
   reads the data in the current format.
5. Run the app's checks. Done when typecheck, lint, and tests pass and the
   diff contains no compatibility branch.

## Considered options

- **Runtime compatibility (defaults, clamps, boot repairs, dual parsers)** —
  rejected: permanent code for a one-time migration. It hides stale data and
  every future change has to keep the branch alive.
- **Tell the operator to fix their own export** — rejected: the operator has
  the data, not the transform; the agent can write and run it.
- **Drop old data silently** — rejected: data loss. The operator's export is
  the source of truth until the transform succeeds.

## Consequences

- An old export that lacks current fields fails validation. That is intended:
  the operator gets an error instead of a silent default.
- The agent needs the operator's export before a format change can land. If
  the data is unavailable, ask the operator how to proceed before writing
  compatibility code.
- The app stays one shape: no legacy branches to test, no dead defaults, no
  boot repairs.
- A legacy value outside the current bounds (for example a saved 15-minute
  interval) is shown as stored and rejected on save; the operator re-adds it
  in the current range.
