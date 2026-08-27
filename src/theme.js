// Shared colour palette. Used ~1000 times across the UI — every component imports C from here.
const C={
  bg:"#0f0f10",surface:"#1a1a1d",surfaceAlt:"#222226",border:"#2e2e33",borderStrong:"#3a3a40",
  // textMute carries 9-11px labels, so it is held at ~4:1 against surface. The old #55555f was
  // 2.4:1 — under WCAG AA and genuinely unreadable on a phone outdoors. Don't dim it back to
  // match `offline` below; that one is a 6px dot, not text, and is meant to stay recessed.
  text:"#f2f2f3",textMid:"#9898a6",textMute:"#78788a",
  accent:"#4f8ef7",accentLight:"rgba(79,142,247,0.1)",accentBorder:"rgba(79,142,247,0.3)",
  warning:"#f59e0b",danger:"#ef4444",success:"#22c55e",
  high:"#a78bfa",mid:"#4f8ef7",low:"#22d3ee",rig:"#34d399",
  // Module states. These four are used ONLY by STATE_COLORS in lib/core.js. `active` is a hotter,
  // more saturated green than C.rig (which it used to duplicate) and `online` is dimmer than
  // C.textMid (which it used to duplicate), so the running state now outranks the idle one on
  // brightness as well as hue — they were near-identical in luminance and hard to tell apart at 6px.
  offline:"#55555f",online:"#85858f",active:"#1ded96",overheat:"#f97316",
};
// Saira, the bundled display face (declared in index.css). Spread onto DISPLAY text only — the
// wordmark, the drawer's menu labels and the fit header's hull name. Body text, numbers and every
// stat readout stay on the system font: Saira is squarer and more mannered, which is what gives the
// large text its character and exactly what makes it tiring in a 10px table cell.
const DISPLAY={fontFamily:"var(--display)"};

// EVE damage type colours: EM=blue, Thermal=red, Kinetic=green, Explosive=orange
export { C, DISPLAY };
