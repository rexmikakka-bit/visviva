import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { fmtResource } from '../lib/fmt.js';

export function PriceCard({value,source,loading=false,label=t('Price')}) {
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,
    marginBottom:14,padding:'8px 12px',background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
    <span style={{fontSize:11,color:C.textMute}}>{label} {source&&<span style={{color:C.textMute,opacity:.7}}>· {source}</span>}</span>
    <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>
      {loading?'…':`${fmtResource(value)} ISK`}
    </span>
  </div>;
}
