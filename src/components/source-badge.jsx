import { C } from '../theme.js';

// inline-block is load-bearing, not cosmetic: an INLINE box sizes its border box from the font's
// ascent+descent and ignores line-height, so `lineHeight:1` did nothing and the pill came out 22px
// against a 23.2px line box. Its border then landed 0.2px above the fitting-cost line under it and
// read as crowding that row. As inline-block the declaration applies and the pill is 17px.
export const BADGE_STYLE={display:'inline-block',fontSize:9,lineHeight:1,fontWeight:800,letterSpacing:'.4px',textTransform:'uppercase',
  borderRadius:4,padding:'3px 5px',whiteSpace:'nowrap'};

export function SourceBadge({label,color=C.success}){
  return <span style={{...BADGE_STYLE,color,background:`${color}1f`,border:`1px solid ${color}55`}}>{label}</span>;
}
