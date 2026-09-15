---
name: PING
description: Honest uptime monitoring for free-tier services that cold-boot — drafted, not decorated.
colors:
  soot: "#0b0c0e"
  card-charcoal: "#121316"
  popover-charcoal: "#15161a"
  muted-charcoal: "#181a1e"
  surface-charcoal: "#1b1d21"
  accent-charcoal: "#202227"
  hairline: "#25272d"
  input-charcoal: "#2c2e35"
  signal-white: "#ffffff"
  chalk: "#e6e8ec"
  ash-white: "#e9ebee"
  instrument-gray: "#9aa0a8"
  beacon-emerald: "#10b981"
  alarm-rose: "#f43f5e"
  caution-amber: "#f59e0b"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  meta:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.1em"
rounded:
  none: "0px"
  dot: "9999px"
spacing:
  2xs: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "14px"
  xl: "16px"
  2xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-white}"
    textColor: "{colors.soot}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "rgba(255,255,255,0.9)"
    textColor: "{colors.soot}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "36px"
  button-outline:
    backgroundColor: "rgba(44,46,53,0.3)"
    textColor: "{colors.ash-white}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "36px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ash-white}"
    rounded: "{rounded.none}"
    padding: "8px 16px"
    height: "36px"
  stat-card:
    backgroundColor: "{colors.card-charcoal}"
    textColor: "{colors.ash-white}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
  pill-status:
    backgroundColor: "rgba(255,255,255,0.1)"
    textColor: "{colors.signal-white}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  pill-up:
    backgroundColor: "rgba(16,185,129,0.1)"
    textColor: "{colors.beacon-emerald}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  pill-warn:
    backgroundColor: "rgba(245,158,11,0.15)"
    textColor: "{colors.caution-amber}"
    rounded: "{rounded.none}"
    padding: "2px 8px"
  input-field:
    backgroundColor: "rgba(44,46,53,0.3)"
    textColor: "{colors.ash-white}"
    rounded: "{rounded.none}"
    height: "36px"
  status-dot:
    backgroundColor: "{colors.beacon-emerald}"
    rounded: "{rounded.dot}"
    size: "10px"
---

# Design System: PING

## Overview

**Creative North Star: "The Drafting Table"**

PING's interface is a drafting table in a dark studio: a fixed blueprint-grid canvas of fine 24px cells and bold 120px majors sits under everything, and the UI floats above it as flat, sharp-cornered instruments — cards, pills, gauges and charts laid out the way a draughtsman lays out tools. The palette is charcoal paper and one white pencil: a neutral charcoal scale with zero hue tint carries every surface, while pure Signal White is the sole brand accent (primary actions, focus rings, links, highlights). Color that remains is data — emerald, rose and amber exist only because monitors have states.

The voice is technical calm. Everything is measurable, labeled, and aligned; nothing is decorative, and no number is invented. Type stays small and instrument-like (nothing over 24px — the system has no display type by design), numerals are always tabular so readings don't jitter, and depth comes from light — 1px inner highlights and a faint ambient glow — never from shadows. Corners are sharp everywhere except the single live status dot, the one circle in the entire system, whose 2.4s sonar ripple is the product's heartbeat.

**Key Characteristics:**
- Blueprint grid canvas (24px fine + 120px major, white lines at 3.8%/10% alpha) fixed behind all content
- One white accent on charcoal; status hues are data, not decoration
- Radius 0 everywhere — one exception: the 10px status dot
- Depth is light, not shadow: inset 1px top highlights + radial ambient glow
- Instrument typography: 10px uppercase tracked labels, tabular numerals, dense hierarchy
- Precise and responsive: 1px hover lift, 0.98 press, 200ms feedback on every control
- Hand-rolled SVG instruments (sparkline, uptime bars, response chart) instead of chart libraries

## Colors

A charcoal drafting-paper scale with no hue tint, one white pencil, and three semantic status inks.

### Primary
- **Signal White** (#ffffff): The only brand accent. Primary CTAs (white fill, Soot text), focus rings, links, pinned states, key numbers on stat cards. Its rarity is the point — if white appears everywhere, nothing leads.
- **Chalk** (#e6e8ec): The soft-white working pencil — sparkline strokes, chart primary, the legacy `--teal` alias (`text-teal`/`bg-teal` all resolve here). Used where pure white would shout.

### Secondary (semantic status — data, not decoration)
- **Beacon Emerald** (#10b981): "Up". Status dots, up-pills, uptime values, healthy bar segments, chart line for success.
- **Alarm Rose** (#f43f5e): "Down". Failed ticks, downtime bars, destructive actions, outage counts. Solid rose fills take Soot ink (`--down-foreground` / `--destructive-foreground`, 5.33:1 AA) — never white; hover keeps the fill constant (darkening pushes contrast to a 4.5 knife-edge), the CTA press (0.98 scale) is the interaction cue.
- **Caution Amber** (#f59e0b): "Slow / degraded / maintenance / confirming". Slow-threshold lines on charts, maintenance states, pending ripples.

### Neutral
- **Soot** (#0b0c0e): Page background. The drafting paper itself; also text on Signal White.
- **Card Charcoal** (#121316): Card and sheet surfaces — the instruments on the table.
- **Popover Charcoal** (#15161a): Menus, dropdowns, command palette — one step up from cards.
- **Muted Charcoal** (#181a1e): Muted fills, sidebar hover.
- **Surface Charcoal** (#1b1d21): Secondary buttons, quiet filled elements.
- **Accent Charcoal** (#202227): Hover fills for ghost/outline controls.
- **Hairline** (#25272d): Every border in the system. 1px, always.
- **Input Charcoal** (#2c2e35): Input borders and dark input fills.
- **Instrument Gray** (#9aa0a8): Muted text — labels, metadata, captions. Never for body copy.
- **Ash White** (#e9ebee): Body text on charcoal.

### Named Rules
**The One Accent Rule.** Signal White is the only brand color. Emerald, rose and amber are measurement semantics — they may encode a monitor's state, never decorate a layout.

**The Data, Not Decoration Rule.** A colored fill is always an alpha wash over charcoal (10–15% tint + matching text, e.g. `bg-emerald/10` + `text-emerald`). Never solid color blocks; never colored text directly on colored fills.

## Typography

**Display Font:** system sans stack (`-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`) — Inter is a fallback, not an identity
**Body Font:** the same stack — one family for the whole system
**Label/Mono Font:** `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace` — rare; reserved for technical strings

**Character:** The native system font, unadorned: the interface reads as an instrument panel, not a marketing page. Hierarchy is built from size, weight, case and tracking — never from a second family.

### Hierarchy
- **Display** (700, 24px, 1.2): The wordmark and nothing else. The system deliberately has no larger display type.
- **Headline** (700, 20px, 1.25, −0.025em): Stat-card values — the big readable numbers. Always tabular.
- **Title** (600, 16px, 1.4): Dialog headings, section titles, monitor names.
- **Body** (400, 14px, 1.5): Default UI text, buttons, form labels.
- **Meta** (400, 11px, 1.4): Timestamps, sub-lines, captions under stat values.
- **Label** (500, 10px, 0.1em, UPPERCASE): Card labels ("MONITORS", "UPTIME 24H"), pill text, table headers. The system's signature type treatment.

### Named Rules
**The Instrument Type Rule.** Numbers are always tabular (`tabular-nums`) so live readings don't jitter; labels are 10px uppercase with 0.1em tracking; nothing exceeds 24px. If a layout needs bigger type, it needs less content.

## Layout

A dense, single-page instrument panel inside a centered 72rem (`max-w-6xl`) column. A sticky 56px header (h-14) carries the wordmark, ⌘K search, live up/down counts, and primary actions; content scrolls under it. On `lg`+ a sticky 14rem (w-56) folder sidebar docks left with its own hairline border; below `lg` it collapses into a horizontal row of folder chips above the stats. Four stat cards sit in a 2-up mobile / 4-up desktop grid, then a search + sort toolbar, then the monitor list. A slim sticky footer ("updated Ns ago") anchors the bottom.

Spacing is tight and rhythmic: 2px pill padding, 4–8px internal gaps, 14px/16px card padding, 24px section gaps. Touch targets stay ≥44px even when type is small — density is visual, not physical.

## Elevation & Depth

Flat by default; depth is light, not shadow. Surfaces separate through the charcoal scale (Soot paper → Card Charcoal → Popover Charcoal) and 1px Hairline borders. Two light effects do the work shadows would: a 1px inset top highlight (`inset 0 1px 0 0 rgba(255,255,255,0.045)`) that reads as a gentle lift on every card, and twin radial ambient glows (white at 5.5%/3.5% alpha, top-left and top-right) that suggest a lamp over the drafting table. Interactive lift is physical, not shadowed: cards rise 1px on hover; CTAs press to 0.98 scale.

### Shadow Vocabulary
- **Card top highlight** (`box-shadow: inset 0 1px 0 0 rgba(255,255,255,0.045)`): applied to every card surface at rest.
- **CTA key light** (`box-shadow: 0 1px 2px rgba(255,255,255,0.25)`): the white button's subtle glow — light emitting, not casting.

### Named Rules
**The Light-Not-Shadow Rule.** No drop shadows on surfaces. Depth = background steps + hairline borders + 1px light. The only allowed "shadows" emit light; they never darken anything below them.

## Shapes

Sharp corners are the system's signature: every radius token is forced to 0px (cards, buttons, inputs, pills, dialogs, thumbnails all use `rounded-none`), and edges meet as precise right angles against the grid. Structure is drawn with 1px hairlines — full borders on containers, one-sided borders (`border-r`, `border-b`) for docks and dividers — never with fill contrast alone. Fill is applied as thin alpha washes over charcoal. The single exception is deliberate and therefore loud: the 10px live status dot is a perfect circle (`border-radius: 9999px`) whose sonar ripple animates outward 6px every 2.4s. One circle, many right angles — that contrast is what makes the dot the product's heartbeat.

### Named Rules
**The Sharp Edge Rule.** Radius 0 everywhere, at every interactive size. The status dot is the only circle in the system; never round anything else.

## Components

### Buttons
- **Shape:** sharp corners (0px), 36px tall (`h-9`), 16px side padding; labels at 14px/500.
- **Primary:** Signal White fill, Soot text (`{button-primary}`); hover drops to 90% white; active presses to 0.98 scale; subtle key-light glow beneath.
- **Outline:** Input Charcoal at 30% over paper, hairline border, Ash White text; hover fills Accent Charcoal.
- **Ghost:** transparent until hovered, then Accent Charcoal wash; used for icon actions (refresh, menu, ⋮).
- **Focus:** 3px Signal White ring at 50% (`ring-[3px] ring-ring/50`) — visible on every interactive element.

### Pills
- **Style:** the recurring status chip — 10px/500 text, 2px×8px padding, sharp corners, Hairline-strength colored border at ~25–40% alpha over a 6–15% alpha wash of the same hue (e.g. up-pill: `border-emerald/30 bg-emerald/10 text-emerald`).
- **State:** tone encodes meaning — white (pinned/account), Beacon Emerald (up), Caution Amber (slow/maintenance/confirming "2/3"), chalk (keyword/intervals). Never larger than 11px text.

### Cards / Containers
- **Corner Style:** 0px, always.
- **Background:** Card Charcoal; popovers and menus step up to Popover Charcoal.
- **Shadow Strategy:** 1px inset top highlight only (see Elevation).
- **Border:** 1px Hairline; hover raises border to Signal White at 25% and lifts the card 1px.
- **Internal Padding:** 14px vertical × 16px horizontal (stat cards); 16px for larger containers.

### Inputs / Fields
- **Style:** Input Charcoal at 30% fill, 1px Input Charcoal border, sharp corners, 36px tall, Ash White 14px text.
- **Focus:** 3px Signal White ring at 50% + border brightens to white; the caret and selection (#ffffff29) stay white.
- **Error:** destructive ring/border treatment (rose at 20–40%).

### Navigation
- **Header:** sticky 56px bar, Soot over the grid, hairline bottom edge; wordmark left ("PING." + tagline in Instrument Gray), ⌘K search button, live up/down count pills, ghost icon actions, white primary "New monitor" right.
- **Folder sidebar** (lg+): 14rem sticky dock, hairline right border, rows with Accent Charcoal hover, 10px uppercase "MONITORS" section label; collapses to horizontal chips below `lg`.
- **Footer:** slim, sticky when content is short — "honest uptime monitoring" left, refresh time right.

### Status Dot (signature)
- **Form:** 10px circle — the only curved element in the system (`{status-dot}`).
- **States:** Beacon Emerald (up) / Alarm Rose (down) / Caution Amber (checking) / flat grays (#71717a paused, #a1a1aa pending, no ripple).
- **Behavior:** live states emit a sonar ripple — `box-shadow` ring expanding 0→6px in 2.4s `cubic-bezier(0.4, 0, 0.6, 1)`, infinite, tinted per state at 55% alpha.

### SVG Instruments (signature)
Hand-rolled, no chart library: **sparkline** (Chalk 1.5px stroke + soft white area fill, emerald latest-point dot, gaps where data is missing); **uptime bars** (20 sharp segments — emerald full, rose empty, amber partial, hatched/gray for "no data", never faked); **response-time chart** (real time axis, dashed hairline gridlines, rose ticks for failed checks, amber dashed slow-threshold line, hover tooltip). Captions state exactly what was measured.

## Do's and Don'ts

### Do:
- **Do** keep every surface one of the charcoal steps and separate them with 1px Hairline borders (#25272d).
- **Do** use Signal White for exactly one primary action per view; everything else gets outline or ghost treatment.
- **Do** render all numerals with `tabular-nums` and label all metrics as 10px uppercase + 0.1em tracking.
- **Do** show alpha washes over charcoal for status fills (10–15% bg + matching text + 25–40% border).
- **Do** give every interactive element the 3px white focus ring, 1px hover lift, and 0.98 press — feedback is part of the craft.

### Don't:
- **Don't** round anything except the status dot (no `rounded-md/lg/xl`, no pill-shaped buttons).
- **Don't** introduce a second brand hue, a gradient, or a drop shadow — depth is light, color is data.
- **Don't** stack rounded cards inside rounded cards or blur backgrounds (no glassmorphism) — the generic-SaaS look is the anti-reference.
- **Don't** go playful: no bouncy/spring animations, no emoji decoration, no casual illustration — motion is limited to the ripple, breathe, fade-up (0.35s) and 200ms state transitions.
- **Don't** fake data in any visual: gaps stay gaps (hatched bars, broken lines), unmeasured windows show "—".
