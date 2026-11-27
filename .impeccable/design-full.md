---
name: PING
description: Honest uptime monitoring for free-tier services that cold-boot — measured, not decorated.
colors:
  soot: "#0b0c0e"
  card-charcoal: "#121316"
  popover-charcoal: "#15161a"
  muted-charcoal: "#181a1e"
  surface-charcoal: "#1b1d21"
  accent-charcoal: "#202227"
  sidebar-charcoal: "#0d0e11"
  hairline: "#25272d"
  sidebar-hairline: "#1f2126"
  input-charcoal: "#2c2e35"
  signal-white: "#ffffff"
  chalk: "#e6e8ec"
  ash-white: "#e9ebee"
  bright-chalk: "#f1f2f4"
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
  stats-strip:
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

**Creative North Star: "The Blueprint"**

PING is a blueprint on charcoal paper. A fixed two-tier grid — fine 24px cells and bold 120px majors, white lines at 3.8% and 10% alpha — sits behind every screen, and the interface floats above it as flat, sharp-cornered instruments: cards, pills, gauges, charts. The palette is drafting paper and one white pencil: a neutral charcoal scale with zero hue tint carries every surface, and pure Signal White is the sole brand accent. What color remains is measurement — emerald, rose and amber exist only because a monitor has a state, never to decorate.

The voice is precise and restrained. Every number is real, labeled, and aligned; nothing is ornamental. Type stays small and instrument-like (nothing exceeds 24px — the system has no display type by design), numerals are always tabular so live readings don't jitter, and depth comes from light — a 1px inner highlight and a faint ambient glow — never from shadows. Corners are sharp everywhere except the single live status dot, the one circle in the system, whose 2.4s sonar ripple is the product's heartbeat.

**Key Characteristics:**
- Blueprint grid canvas (24px fine + 120px major, white at 3.8%/10% alpha) fixed behind all content
- One white accent on charcoal; status hues are data, not decoration
- Uptime numbers tint by band (emerald 100% / amber 90–99.9% / rose <90%); "no data" is a dashed outline, never invisible
- Radius 0 everywhere — one exception, the 10px status dot
- Depth is light, not shadow: inset 1px top highlights + radial ambient glow
- Instrument typography: 10px uppercase tracked labels, tabular numerals, dense hierarchy
- Precise and restrained: 1px hover lift, 0.98 press, 200ms feedback on every control
- Hand-rolled SVG instruments (sparkline, uptime bars, response-time chart, stat trace) instead of chart libraries
- The stat strip is one instrument: three metric cells over a single live response trace

## Colors

A charcoal drafting-paper scale with no hue tint, one white pencil, and three semantic status inks.

### Primary
- **Signal White** (#ffffff): The only brand accent. Primary CTAs (white fill, Soot text), focus rings, links, pinned states, key numbers in the stat strip. Its rarity is the point — if white appears everywhere, nothing leads.
- **Chalk** (#e6e8ec): The soft-white working pencil — sparkline strokes, chart primary line, the `--teal` alias (`text-teal`/`bg-teal` all resolve here), and the `100%` badge fill. Used where pure white would shout.
- **Bright Chalk** (#f1f2f4): The `--accent-foreground` ink — text on Accent Charcoal hover fills (ghost/outline controls, sidebar hover). One step brighter than Ash White so hovered text lifts without going full white.

### Secondary (semantic status — data, not decoration)
- **Beacon Emerald** (#10b981): "Live". Status dots, up-pills, uptime values, healthy bar segments, chart success line.
- **Alarm Rose** (#f43f5e): "Down". Failed ticks, downtime bars, destructive actions, outage counts. Solid rose fills take Soot ink (`--down-foreground`, 5.33:1 AA) — never white; hover keeps the fill constant (darkening pushes contrast to a 4.5 knife-edge), the 0.98 CTA press is the interaction cue.
- **Caution Amber** (#f59e0b): "Slow". Slow-threshold lines on charts, slow pills, pending ripples.

### Neutral
- **Soot** (#0b0c0e): Page background. The drafting paper itself; also text on Signal White.
- **Sidebar Charcoal** (#0d0e11): The folder-dock surface, one shade below Soot so the dock reads as a separate sheet.
- **Card Charcoal** (#121316): Card and sheet surfaces — the instruments on the table.
- **Popover Charcoal** (#15161a): Menus, dropdowns, command palette — one step up from cards.
- **Muted Charcoal** (#181a1e): Muted fills, sidebar hover.
- **Surface Charcoal** (#1b1d21): Secondary buttons, quiet filled elements.
- **Accent Charcoal** (#202227): Hover fills for ghost/outline controls.
- **Hairline** (#25272d): Every border in the system. 1px, always.
- **Sidebar Hairline** (#1f2126): The dock's right edge, dimmed against the darker dock surface.
- **Input Charcoal** (#2c2e35): Input borders and dark input fills.
- **Instrument Gray** (#9aa0a8): Muted text — labels, metadata, captions. Never for body copy.
- **Ash White** (#e9ebee): Body text on charcoal.

### Named Rules
**The One Accent Rule.** Signal White is the only brand color. Emerald, rose and amber are measurement semantics — they may encode a monitor's state, never decorate a layout.

**The Data, Not Decoration Rule.** A colored fill is always an alpha wash over charcoal (6–15% tint + matching text + 25–40% border, e.g. `bg-emerald/10 text-emerald border-emerald/30`). Never solid color blocks; never colored text directly on a colored fill.

**The Uptime Band Rule.** Every uptime percentage shares one band language, from one helper (`uptimeTone`): displays-as-100% (≥ 99.995%) in Beacon Emerald (up), 90–99.99% in Caution Amber (warn), below 90% in Alarm Rose (down). No data stays neutral — unknown must never read as healthy. The dashboard stat strip and the detail sheet all speak it.

**The Honest-Empty Rule.** "No data" is drawn as a dashed outline in muted gray (`border-dashed border-muted-foreground/60`, ≥3:1 non-text contrast) — never a near-invisible fill, and never faked as up. The legend key mirrors the bar treatment exactly.

## Typography

**Display Font:** system sans stack (`-apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif`) — Inter is a fallback, not an identity
**Body Font:** the same stack — one family for the whole system
**Label/Mono Font:** `ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace` — rare; reserved for technical strings

**Character:** The native system font, unadorned: the interface reads as an instrument panel, not a marketing page. Hierarchy is built from size, weight, case and tracking — never from a second family.

### Hierarchy
- **Display** (700, 24px, 1.2): The wordmark and nothing else. The system deliberately has no larger display type.
- **Headline** (700, 20px, 1.25, −0.025em): Stat-strip values — the big readable numbers. Always tabular.
- **Title** (600, 16px, 1.4): Dialog headings, section titles, monitor names.
- **Body** (400, 14px, 1.5): Default UI text, buttons, form labels.
- **Meta** (400, 11px, 1.4): Timestamps, sub-lines, chart captions.
- **Label** (500, 10px, 0.1em, UPPERCASE): Card labels ("UPTIME 24H", "FAILURES 24H"), pill text, table headers. The system's signature type treatment.

### Named Rules
**The Instrument Type Rule.** Numbers are always tabular (`tabular-nums`) so live readings don't jitter; labels are 10px uppercase with 0.1em tracking (0.04em in the three-up stat strip below `sm`); nothing exceeds 24px. If a layout needs bigger type, it needs less content.

## Layout

A dense, single-page instrument panel inside a centered 72rem (`max-w-6xl`) column (88rem at `2xl`). A sticky 56px header (h-14) carries the wordmark, ⌘K search, live up/down counts, and primary actions; content scrolls under it. On `lg`+ a sticky 14rem (w-56) folder sidebar docks left with its own hairline border; below `lg` it collapses into a horizontal row of folder chips above the stats. The Scope summary is one instrument strip at every width: three hairline-divided cells — Uptime 24h, Checks 24h, Failures 24h — over a shared response-time trace, then a search + sort toolbar, then the monitor list. A slim sticky footer (wordmark, "Live service monitoring", non-affiliation note) anchors the bottom. The stat strip describes the active **Scope** (GLOSSARY.md): the whole Fleet on "All monitors", one Folder otherwise — never the search query. Each cell is label + value only; the trace carries the living context and is never a second, conflicting summary. The header counts stay Fleet-wide, the always-on "is anything down anywhere?" answer; the folder dock points at where, tinting a down folder's icon rose at every width.

Adaptation rules (2026-09-16 adapt pass):
- **Fleet health is never width-gated.** Below `md` the full count pills don't fit, so the header shows one compact chip — `1↑ 0↓` (plus `N~` when slow exists), tabular, numbers tinted only when the count is real (the idle rule). "Is anything down?" must be answerable from the header at every width.
- **Touch reads labels, not tooltips.** Native `title` tooltips don't exist on touch, so anything whose meaning lives only in a hover title is a defect. The Incidents trigger shows its text label at every width — 10px beside the icon on phones (natural width, never stretched equal thirds, 44px touch height kept), 12px from `sm` up. Field hints follow the same rule: the label's `?` toggles an inline hint paragraph on tap or keyboard (`aria-expanded`/`aria-controls`), never a hover-only Tooltip, and its hit area grows to the 44px floor the same way the time-chip remove button does.
- **Diagnosis wraps, it doesn't vanish.** A down card's error text clamps to two lines instead of one truncated hover-only line — the full error must be readable on touch where no tooltip can save it.
- **The down marker is peripheral, not an alert.** While any monitor is down, the tab title reads `PING — <n> down` and both declared favicons swap to the rose `logo-down` variant (SVG link keeps `.svg`, PNG link keeps `.png` — each link's declared `type` is honored). It clears to the base title and original icons when the fleet recovers or the view unmounts. This is the same truth the open dashboard shows, moved to the tab strip; it is never a notification, and the header pill remains the in-page answer.

Spacing is tight and rhythmic: 2px pill padding, 4–8px internal gaps, 14px/16px card padding, 24px section gaps. Touch targets stay ≥44px (`h-11`) even when type is small — density is visual, not physical.

## Elevation & Depth

Flat by default; depth is light, not shadow. Surfaces separate through the charcoal scale (Soot paper → Card Charcoal → Popover Charcoal) and 1px Hairline borders. Two light effects do the work shadows would: a 1px inset top highlight (`inset 0 1px 0 0 rgba(255,255,255,0.045)`) that reads as a gentle lift on every card, and twin radial ambient glows (white at 5.5%/3.5% alpha, top-left and top-right) that suggest a lamp over the drafting table. Interactive lift is physical, not shadowed: cards rise 1px on hover; CTAs press to 0.98 scale.

### Shadow Vocabulary
- **Card top highlight** (`box-shadow: inset 0 1px 0 0 rgba(255,255,255,α)`): one shape, two alphas — `0.045` at rest on every card surface, `0.14` on the card being dragged. The resting value is too faint to separate a card that is following the cursor, so the drag state brightens the same 1px top edge. Light in both cases, never a cast shadow.
- **CTA key light** (`box-shadow: 0 1px 2px rgba(255,255,255,0.25)`): the white button's subtle glow — light emitting, not casting.

### Named Rules
**The Light-Not-Shadow Rule.** No drop shadows on surfaces. Depth = background steps + hairline borders + 1px light. The only allowed "shadows" emit light; they never darken anything below them.

## Shapes

Sharp corners are the system's signature: every radius token is forced to 0px (`--radius-sm/md/lg/xl` all resolve to `0px` in `globals.css`, so `rounded-md/lg/xl` render flat), and edges meet as precise right angles against the grid. Structure is drawn with 1px hairlines — full borders on containers, one-sided borders (`border-r`, `border-b`) for docks and dividers — never with fill contrast alone. Fill is applied as thin alpha washes over charcoal. The single exception is deliberate and therefore loud: the 10px live status dot is a perfect circle (`border-radius: 9999px`) whose sonar ripple animates outward 6px every 2.4s. One circle, many right angles — that contrast is what makes the dot the product's heartbeat.

### Named Rules
**The Sharp Edge Rule.** Radius 0 everywhere, at every interactive size. The status dot is the only circle in the system; never round anything else.

## Components

### Buttons
- **Shape:** sharp corners (0px), 36px tall (`h-9`), 16px side padding; labels at 14px/500.
- **Primary:** Signal White fill, Soot text (`{button-primary}`); hover drops to 90% white; active presses to 0.98 scale; subtle key-light glow beneath.
- **Outline:** Input Charcoal at 30% over paper, hairline border, Ash White text; hover fills Accent Charcoal.
- **Ghost:** transparent until hovered, then Accent Charcoal wash; used for icon actions (refresh, menu, ⋮).
- **Toolbar state encoding:** outline tools tint when their state is live — Alarm Rose wash + count when unseen or ongoing incidents exist. Silent when idle: color only ever carries state.
- **Focus:** the one `focus-ring` utility — 3px Signal White ring at 50% (`ring-[3px] ring-focus/50`) — visible on every interactive element. On the solid rose destructive toast the ring goes opaque white (`ring-focus`, no alpha): white at 50% over rose measures 1.86:1, below the 3:1 non-text floor, while opaque white measures 3.67:1.

### Pills
- **Style:** the recurring status chip — 10px/500 text, 2px×8px padding, sharp corners, a Hairline-strength colored border at ~25–40% alpha over a 6–15% alpha wash of the same hue (e.g. up-pill: `border-emerald/30 bg-emerald/10 text-emerald`).
- **State:** tone encodes meaning — white (keyword), Beacon Emerald (up), Caution Amber (slow), chalk (account). Never larger than 11px text. Header count pills tint only when count > 0 — a zero is neutral, never a colored false alarm.

### Cards / Containers
- **Corner Style:** 0px, always.
- **Background:** Card Charcoal; popovers and menus step up to Popover Charcoal.
- **Shadow Strategy:** 1px inset top highlight only (see Elevation).
- **Border:** 1px Hairline; hover raises border to Signal White at 25% and lifts the card 1px.
- **Drag state:** while a card is dragged it lifts on `translate3d` at 1.015 scale with `border-primary/60` and the brighter top highlight (see Elevation); it is never dimmed or ghosted.
- **Internal Padding:** 14px top × 16px sides × 32px bottom for stat cells (the lower band holds the trace; 12 × 10 × 28 on phones); 16px for larger containers.
- **Outage row (down cards):** while a monitor is down, the card answers "how long, and what now?" in one 11px rose line: the real down duration (from the ongoing incident's first failed check — tabular, never estimated; hidden when no incident is known rather than guessed), then `View incident` (opens the incidents sheet) as a rose text action with a ≥44px hit area.

### Monitor Card
- **State is the edge:** the status pill is pinned flush to the card's top-left corner, with its top and left borders removed. The card carries no status dot — the pill is the state read in the list.
- **Identity line:** name, then the account pill, then the keyword pill (the quoted term; `no` prefixes an excludes check). The folder is not repeated on the card — the dock or sidebar already names the Scope.
- **Metadata:** one 11px row — last updated, cadence, average response time. Per-monitor 24h uptime is not repeated on the card; the stat strip owns the scope aggregate.
- **Bottom edge:** lower padding is tighter than the top (12/8px on phones, 20/12px from `sm`) so the metadata row sits close to the card's bottom rule.

### Detail Sheet
- **Header:** status pill first, then the monitor name, then the account pill. No status dot and no schedule/folder/last-updated sub-line — the host link is the only description line; the body owns history, timing, and stats.

### Stat Strip
- **Shape:** one Card Charcoal panel with a 1px Hairline border, 0px radius, and the shared inset top highlight — never three detached cards. Three equal columns are split by 1px hairlines at every width.
- **Cells:** label + value only. A 10px uppercase label sits above a 20px/700 tabular value; tone follows the metric — Uptime's band ink, Checks in Chalk, Failures rose when any monitor has failed and emerald at zero. Icons are 14px from `sm` up; phones drop them and tighten label tracking so "FAILURES 24H" stays on one line.
- **Trace:** a hand-rolled SVG spanning all three cells, fed by the same recent checks the strip already holds (within 24h of the newest sample, capped at 160 points). Chalk 1.5px at 55%, log-scaled response time, three faint quartile guides, short rose ticks for failed checks at the baseline, and small marks for isolated samples. A pause beyond the adaptive threshold (15–60 minutes, from the fleet's own rhythm) breaks the line rather than inventing a slope.
- **Motion:** the trace draws in once (1.1s, segments staggered up to 420ms), a 1px Signal White scanline at 12% sweeps the panel every 16s, and values snap in on change (320ms opacity/translate/blur). Values never count through intermediate readings — every frame must show a measured number. Reduced motion hides the scanline and collapses the entrances.
- **Accessibility:** the trace is `role="img"` with a spoken summary of recent-check count, failure count, and latest response; the three values remain plain text, and the trace's own facts are repeated in that label.

### Inputs / Fields
- **Style:** Input Charcoal at 30% fill, 1px Input Charcoal border, sharp corners, 36px tall, Ash White 14px text.
- **Focus:** `focus-ring` — 3px `ring-focus/50` Signal White ring + border brightens to white; the caret and selection (#ffffff29) stay white. One exception: the dashboard search field keeps a quieter ring — the same white at a lower alpha (`border-primary/40 ring-primary/20`).
- **Error:** destructive ring/border treatment (rose at 20–40%).

### Navigation
- **Header:** sticky 56px bar, Soot at 85% over the grid with backdrop blur, hairline bottom edge; wordmark left ("PING." + tagline in Instrument Gray), ⌘K search button, live up/down count pills (compact `1↑ 0↓` chip below `md` — see Adaptation rules), ghost icon actions, white primary "New monitor" right.
- **Folder sidebar** (lg+): 14rem sticky dock on Sidebar Charcoal, Sidebar Hairline right border, rows with Accent Charcoal hover; collapses to horizontal chips below `lg`.
- **Footer:** slim, sticky when content is short (see Layout for its contents).

### Status Dot (signature)
- **Form:** 10px circle — the only curved element in the system (`{status-dot}`).
- **States:** Beacon Emerald (up) / Alarm Rose (down) / Caution Amber (checking) / flat grays (#71717a paused, #a1a1aa pending, no ripple).
- **Behavior:** live states emit a sonar ripple — `box-shadow` ring expanding 0→6px in 2.4s `cubic-bezier(0.4, 0, 0.6, 1)`, infinite, tinted per state at 55% alpha.
- **Placement:** the dot is not a card or sheet-header ornament. Those lead with the status pill; the dot stays where it marks a row or compact live readout (command palette, Render status card, check-history rows).

### SVG Instruments (signature)
Hand-rolled, no chart library: **sparkline** (Chalk 1.6px stroke + soft white area fill, emerald latest-point dot, gaps where data is missing); **uptime bars** (12 sharp segments — emerald full, rose empty, amber partial, dashed-outline gray for "no data", never faked); **response-time chart** (real time axis, dashed hairline gridlines, rose ticks for failed checks, amber dashed slow-threshold line, hover tooltip); **stat trace** (recent checks, log response shape, adaptive gaps, rose failure ticks, isolated-sample marks). Charts with axes caption exactly what was measured; the stat trace carries the same truth in its accessible label.

## Do's and Don'ts

### Do:
- **Do** keep every surface one of the charcoal steps and separate them with 1px Hairline borders (#25272d).
- **Do** use Signal White for exactly one primary action per view; everything else gets outline or ghost treatment.
- **Do** render all numerals with `tabular-nums` and label all metrics as 10px uppercase + 0.1em tracking (the stat strip tightens to 0.04em on phones to keep three labels on one line).
- **Do** show alpha washes over charcoal for status fills (6–15% bg + matching text + 25–40% border).
- **Do** treat the three stats as one instrument — hairline-divided label/value cells over a single real trace — never three detached cards.
- **Do** give every interactive element the 3px white focus ring, 1px hover lift, and 0.98 press — feedback is part of the craft.

### Don't:
- **Don't** round anything except the status dot (no `rounded-md/lg/xl`, no pill-shaped buttons) — the theme forces every radius token to 0, so don't reintroduce a non-zero one.
- **Don't** introduce a second brand hue, a gradient, or a drop shadow — depth is light, color is data.
- **Don't** stack rounded cards inside rounded cards or blur backgrounds (no glassmorphism) — the generic-SaaS look is the anti-reference.
- **Don't** go playful: no bouncy/spring animations, no emoji decoration, no casual illustration — motion is limited to the ripple, breathe, fade-up (0.35s), the stat trace's draw-in and scanline, and 200–320ms state transitions.
- **Don't** animate stat values through intermediate numbers; every displayed frame must be a measured reading.
- **Don't** fake data in any visual: gaps stay gaps (hatched/dashed bars, broken lines), unmeasured windows show "—".
