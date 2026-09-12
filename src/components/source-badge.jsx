import { C } from '../theme.js';

export const BADGE_STYLE={fontSize:9,lineHeight:1,fontWeight:800,letterSpacing:'.4px',textTransform:'uppercase',
  borderRadius:4,padding:'3px 5px',whiteSpace:'nowrap'};

export function SourceBadge({label,color=C.success}){
  return <span style={{...BADGE_STYLE,color,background:`${color}1f`,border:`1px solid ${color}55`}}>{label}</span>;
}
