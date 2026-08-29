// Shared colour palette. Used ~1000 times across the UI — every component imports C from here.
// C is a live Proxy over two structurally-identical palettes (dark/light), so every call site
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
const PALETTES={dark:DARK_PALETTE,light:LIGHT_PALETTE};
let _theme="dark";
function setTheme(theme){ if(theme==="dark"||theme==="light") _theme=theme; }
function getTheme(){ return _theme; }
const C=new Proxy({},{ get(_,prop){ return PALETTES[_theme][prop]; } });

// Saira, the bundled face (declared in index.css). It is now the app's base family, so spreading this
// is a no-op for the family itself — it stays because the call sites that use it (wordmark, hull name,
// drawer labels) are marking text as DISPLAY, and that intent is what would carry the difference if
// the two stacks ever split again.
const DISPLAY={fontFamily:"var(--display)"};

// EVE damage type colours: EM=blue, Thermal=red, Kinetic=green, Explosive=orange
export { C, DISPLAY, setTheme, getTheme };
