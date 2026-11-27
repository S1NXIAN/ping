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

<!-- impeccable:design-map -->
Name: PING
Tokens: see the frontmatter above (colors, typography, spacing, rounded, components).
North Star: "The Blueprint"
Rules:
- The One Accent Rule. Signal White is the only brand color.
- The Data, Not Decoration Rule. A colored fill is always an alpha wash over charcoal (6–15% tint + matching text + 25–40% border, e.g. `bg-emerald/10 text-emerald border-emerald/30`).
- The Uptime Band Rule. Every uptime percentage shares one band language, from one helper (`uptimeTone`): displays-as-100% (≥ 99.995%) in Beacon Emerald (up), 90–99.99% in Caution Amber (warn), below 90% in Alarm Rose (down).
- The Honest-Empty Rule. "No data" is drawn as a dashed outline in muted gray (`border-dashed border-muted-foreground/60`, ≥3:1 non-text contrast) — never a near-invisible fill, and never faked as up.
- (+3 more)
Elevation:
- Card top highlight: inset 0 1px 0 0 rgba(255,255,255,α)
- CTA key light: 0 1px 2px rgba(255,255,255,0.25)
Don't:
- Don't round anything except the status dot (no `rounded-md/lg/xl`, no pill-shaped buttons) — the theme forces every radius token to 0, so don't reintroduce a non-zero one.
- Don't introduce a second brand hue, a gradient, or a drop shadow — depth is light, color is data.
- Don't stack rounded cards inside rounded cards or blur backgrounds (no glassmorphism) — the generic-SaaS look is the anti-reference.
- Don't go playful: no bouncy/spring animations, no emoji decoration, no casual illustration — motion is limited to the ripple, breathe, fade-up (0.35s), the stat trace's draw-in and scanline, and 200–320ms state transitions.
- Don't animate stat values through intermediate numbers; every displayed frame must be a measured reading.
- Don't fake data in any visual: gaps stay gaps (hatched/dashed bars, broken lines), unmeasured windows show "—".
Full: .impeccable/design-full.md (read a section when you need its detail)
