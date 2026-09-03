// Shared colour palette. Used ~1000 times across the UI — every component imports C from here.
// C is a live Proxy over structurally-identical palettes (dark/light/amarr/sansha), so every call site
// keeps reading real hex/rgba strings exactly as before — including the `${C.border}22`-style
// alpha-suffix pattern used all over the app — while still tracking the current theme. Call
// setTheme() to switch; it takes effect on the next read, so pair it with a re-render (see
// App.jsx, which calls it synchronously at the top of its render body, same pattern as _tick).
const DARK_PALETTE={
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
// Same shape, inverted for a light background. Semantic hues (accent/warning/danger/success/
// high/mid/low/rig/overheat) are darkened from their dark-mode values rather than reused as-is —
// most of them sit under 3:1 contrast against white straight out of the dark palette, which reads
// fine glowing on near-black but washes out on paper-white.
const LIGHT_PALETTE={
  bg:"#f2f2f5",surface:"#ffffff",surfaceAlt:"#e9e9ee",border:"#d8d8de",borderStrong:"#c2c2cb",
  text:"#16161a",textMid:"#55555f",textMute:"#6d6d7d",
  accent:"#2f6fe0",accentLight:"rgba(47,111,224,0.1)",accentBorder:"rgba(47,111,224,0.35)",
  warning:"#a15c07",danger:"#dc2626",success:"#15803d",
  high:"#7c3aed",mid:"#2f6fe0",low:"#0e7490",rig:"#047857",
  offline:"#a8a8b3",online:"#6b6b78",active:"#0f9d58",overheat:"#c2410c",
};
// Amarr: warm near-black browns under an imperial gold accent. A dark theme, so it inherits the
// dark palette's contrast obligations — textMute is tuned against surfaceAlt (the row background,
// the LIGHTER of the two) at ~4.3:1, because tuning it against `surface` alone leaves every list
// row a step short.
//
// The one real conflict: gold sits 5 degrees from the standard amber `warning` (43 vs 38), so
// against this accent an amber warning reads as "highlighted", not "careful". Warning is pushed to
// orange HERE ONLY — don't "restore" it to #f59e0b, it disappears into the accent.
//
// That leaves four hot colours inside 45 degrees of hue: accent 43, warning 32, overheat 16,
// danger 358. Tighter than the dark palette, and accent/warning in particular lean on lightness
// (light gold vs deep orange) as much as hue to stay apart. Moving any one of them squeezes a
// neighbour, so re-space all four together or not at all.
const AMARR_PALETTE={
  bg:"#14100a",surface:"#1e1810",surfaceAlt:"#292117",border:"#3a3021",borderStrong:"#4d4029",
  text:"#f6f0e3",textMid:"#a89880",textMute:"#94836a",
  accent:"#e5b53e",accentLight:"rgba(229,181,62,0.12)",accentBorder:"rgba(229,181,62,0.35)",
  warning:"#e08b2a",danger:"#e5484d",success:"#3fa96a",
  // Slot colours keep their dark-theme hue identity on purpose: they are semantic labels you learn
  // once, not decoration, and a user who switches themes should not have to relearn which is a rig.
  // Only warmed and dimmed slightly so they sit on brown instead of glowing off it.
  high:"#b58bf0",mid:"#5b9ae8",low:"#3fc4d4",rig:"#4bc48a",
  offline:"#5a4d3a",online:"#9a8a72",active:"#3fdc9a",overheat:"#f4602a",
};
// Sansha: cold violet-tinted near-black under a crimson that has been pushed toward magenta.
//
// The accent hue (284) sits in the only wide lane the app's semantics leave open. The other nine
// are spoken for — danger 0, overheat 25, warning 38, success 142, active 155, rig 158, low 188,
// mid 218, high 255 — so an accent anywhere below 255 lands on a slot colour or a module state, and
// only 255->360 is free. Straight Sansha crimson would have landed on `danger` at 0, and in a
// fitting app red already means "over powergrid"; an accent you can't tell from an error is worse
// than the amber problem Amarr had.
//
// Sitting mid-lane rather than at either end is what makes this palette cheap: 76 degrees off
// `danger` and 29 off the high-slot violet, so every semantic HUE below is the dark palette's,
// completely unshifted — only `offline`/`online`, which are neutral greys rather than signal
// colours, are tinted to match the background. Amarr by contrast had to re-space warning, overheat
// and danger together before its gold would sit next to them.
// An earlier draft of this theme put the accent at 338, which forced `danger` off pure red to keep
// them apart; moving to purple made that nudge unnecessary and it was reverted.
//
// The near neighbour now is `high` at 255, 29 degrees away. They stay apart on saturation as much
// as hue — high is a pale lavender, this is saturated — and they rarely meet, since high labels a
// slot type and the accent is button and link chrome.
const SANSHA_PALETTE={
  bg:"#0c0a0e",surface:"#17131b",surfaceAlt:"#211b27",border:"#322839",borderStrong:"#453850",
  text:"#f0ecf2",textMid:"#9d92aa",textMute:"#8b8098",
  accent:"#bd5ce0",accentLight:"rgba(189,92,224,0.12)",accentBorder:"rgba(189,92,224,0.35)",
  warning:"#f59e0b",danger:"#ef4444",success:"#22c55e",
  high:"#a78bfa",mid:"#4f8ef7",low:"#22d3ee",rig:"#34d399",
  offline:"#4a4152",online:"#8b8199",active:"#1ded96",overheat:"#f97316",
};
const PALETTES={dark:DARK_PALETTE,light:LIGHT_PALETTE,amarr:AMARR_PALETTE,sansha:SANSHA_PALETTE};
let _theme="dark";
// Guarded against the palette map rather than a literal list, so adding a palette above is the only
// edit a new theme needs here. An unknown name is ignored, which keeps a stale stored pref from
// blanking every colour in the app.
function setTheme(theme){ if(PALETTES[theme]) _theme=theme; }
function getTheme(){ return _theme; }
// The pickable set, in the order the settings screen shows it. Derived from PALETTES so a palette
// added above appears in Settings on its own, rather than existing but being unreachable.
const THEMES=Object.keys(PALETTES);
const THEME_LABELS={dark:"Dark",light:"Light",amarr:"Amarr",sansha:"Sansha"};
const C=new Proxy({},{ get(_,prop){ return PALETTES[_theme][prop]; } });

// Saira, the bundled face (declared in index.css). It is now the app's base family, so spreading this
// is a no-op for the family itself — it stays because the call sites that use it (wordmark, hull name,
// drawer labels) are marking text as DISPLAY, and that intent is what would carry the difference if
// the two stacks ever split again.
const DISPLAY={fontFamily:"var(--display)"};

// EVE damage type colours: EM=blue, Thermal=red, Kinetic=green, Explosive=orange
export { C, DISPLAY, THEMES, THEME_LABELS, setTheme, getTheme };
