// Line-art UI icons, replacing the emoji (📥 📤 📷 💰 🐛 ⚙ 📋 ✎ 🔍) that used to be injected as HTML
// entities. Emoji render as the platform's own full-colour artwork — iOS's in particular — so they
// carried a visual language the rest of the app doesn't use, and they ignore the colour of whatever
// they sit in.
//
// Every glyph draws in `currentColor` at a uniform 1.75 stroke on a 24x24 grid, so it inherits from
// its container exactly like text did, and a row of them shares one weight. Nothing here is filled:
// where a shape overlaps a line (the Settings knobs) the line is BROKEN around it rather than hidden
// under an opaque fill, which would need a background colour and break on any surface but one.
import { C } from "../theme.js";

function Glyph({size = 20, sw = 1.75, children}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
         style={{display:"block",flexShrink:0}}>
      {children}
    </svg>
  );
}

const TRAY = "M4 15.5v3A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5v-3";

export const IconImport = (p) => (
  <Glyph {...p}><path d={TRAY}/><path d="M12 4v11"/><path d="M7.5 10.5 12 15l4.5-4.5"/></Glyph>
);

export const IconExport = (p) => (
  <Glyph {...p}><path d={TRAY}/><path d="M12 15V4"/><path d="M7.5 8.5 12 4l4.5 4.5"/></Glyph>
);

// A viewfinder rather than a camera body: four corner brackets stay crisp at 20px where a lens,
// flash and shutter do not, and it reads as "frame this" instead of "take a photo of something".
export const IconSnapshot = (p) => (
  <Glyph {...p}>
    <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9"/><path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9"/>
    <path d="M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15"/><path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>
    <circle cx="12" cy="12" r="2.75"/>
  </Glyph>
);

export const IconPrice = (p) => (
  <Glyph {...p}>
    <path d="M4.5 11.4V6A1.5 1.5 0 0 1 6 4.5h5.4a2 2 0 0 1 1.42.59l6.6 6.6a2 2 0 0 1 0 2.82l-5.4 5.4a2 2 0 0 1-2.82 0l-6.6-6.6a2 2 0 0 1-.59-1.42z"/>
    <circle cx="8.6" cy="8.6" r="1.35"/>
  </Glyph>
);

export const IconFeedback = (p) => (
  <Glyph {...p}>
    <path d="M20 14.5A1.5 1.5 0 0 1 18.5 16h-7.7l-4.3 3.4A.4.4 0 0 1 5.85 19V16H5.5A1.5 1.5 0 0 1 4 14.5v-8A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5z"/>
  </Glyph>
);

// Faders, not a cogwheel: a gear's teeth turn to mush at this size and stroke weight, and a mixing
// desk suits the app's tone better anyway.
export const IconSettings = (p) => (
  <Glyph {...p}>
    <path d="M4 6.4h3.7"/><path d="M12.3 6.4H20"/><circle cx="10" cy="6.4" r="2.3"/>
    <path d="M4 12h7.7"/><path d="M16.3 12H20"/><circle cx="14" cy="12" r="2.3"/>
    <path d="M4 17.6h2.7"/><path d="M11.3 17.6H20"/><circle cx="9" cy="17.6" r="2.3"/>
  </Glyph>
);

export const IconClipboard = (p) => (
  <Glyph {...p}>
    <path d="M9 4.5H7A1.5 1.5 0 0 0 5.5 6v13A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2"/>
    <rect x="9" y="2.8" width="6" height="3.6" rx="1.1"/>
  </Glyph>
);

export const IconCharacter = (p) => (
  <Glyph {...p}><circle cx="12" cy="8.25" r="3.75"/><path d="M5.25 20a6.75 6.75 0 0 1 13.5 0"/></Glyph>
);

export const IconCopy = (p) => (
  <Glyph {...p}>
    <rect x="4" y="8" width="12" height="12" rx="2"/>
    <path d="M8 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2"/>
  </Glyph>
);

export const IconPencil = (p) => (
  <Glyph {...p}>
    <path d="M4 20l.9-3.6a1 1 0 0 1 .27-.48L16.1 4.9a1.5 1.5 0 0 1 2.12 0l1.88 1.88a1.5 1.5 0 0 1 0 2.12L9.08 19.83a1 1 0 0 1-.48.27z"/>
    <path d="M14.8 6.2l3 3"/>
  </Glyph>
);

export const IconSearch = (p) => (
  <Glyph {...p}><circle cx="10.75" cy="10.75" r="6.25"/><path d="M19.5 19.5l-4.3-4.3"/></Glyph>
);

export const IconPlus = (p) => (
  <Glyph {...p}><path d="M12 5v14"/><path d="M5 12h14"/></Glyph>
);

export const IconClose = (p) => (
  <Glyph {...p}><path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/></Glyph>
);

// The menu rows set no colour of their own, so the glyph would otherwise inherit the document
// default rather than sitting a step below the label the way the emoji visually did.
export function MenuGlyph({icon: Icon}) {
  return <span style={{display:"flex",color:C.textMid,flexShrink:0}}><Icon size={21}/></span>;
}
