import { createContext, useContext, useMemo } from "react";
import { C } from "../theme.js";
import { itemSkillGap } from "../calc.js";

// The pilot's skills, for the item browsers only. They sit several components below the fit views
// that already receive `skills` as a prop (module browser -> module menu -> charge picker, drone
// tab -> drone browser, …), and threading it through every one of those signatures would touch far
// more of ui.jsx — this repo's worst merge hotspot — than the feature is worth. Read-only on
// purpose: nothing under here writes skills.
const SkillsContext = createContext(null);
export const SkillsProvider = SkillsContext.Provider;

const ROMAN = ["0", "I", "II", "III", "IV", "V"];

/**
 * Red book on a browser row whose item the pilot cannot use. Renders NOTHING when the item is
 * usable, so a fully-skilled pilot sees no change at all — and, because unset skills count as V
 * (the convention checkFitSkills and calcFitStats share), neither does a fresh install.
 *
 * Deliberately not interactive: it sits on rows whose whole area is already a tap target that
 * equips the item, and a second tappable thing there would just make the row harder to hit. The
 * detail lives in the title/aria-label instead.
 */
export function SkillMark({ typeID, size = 13 }) {
  const skills = useContext(SkillsContext);
  const gap = useMemo(() => (typeID ? itemSkillGap(typeID, skills) : []), [typeID, skills]);
  if (!gap.length) return null;
  const detail = gap.map(g => `${g.name} ${ROMAN[g.required] ?? g.required} (you have ${ROMAN[g.have] ?? g.have})`).join(", ");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" role="img" aria-label={`Missing skills: ${detail}`}
         style={{ flexShrink: 0 }}>
      <title>{`Requires ${detail}`}</title>
      <path d="M12 6.5C10.4 5.2 8.3 4.6 5.8 4.6c-.7 0-1.3.05-1.8.13v13c.5-.08 1.1-.13 1.8-.13 2.5 0 4.6.6 6.2 1.9"
            stroke={C.danger} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 6.5c1.6-1.3 3.7-1.9 6.2-1.9.7 0 1.3.05 1.8.13v13c-.5-.08-1.1-.13-1.8-.13-2.5 0-4.6.6-6.2 1.9"
            stroke={C.danger} strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 6.5v13" stroke={C.danger} strokeWidth="1.9" strokeLinecap="round"/>
    </svg>
  );
}
