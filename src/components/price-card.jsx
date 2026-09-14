import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { fmtResource } from '../lib/fmt.js';

// `age` is set only when the figure came out of the cache past its refresh window — an unlabelled
// stale price is a wrong number presented as a current one.
export function PriceCard({value,source,loading=false,label=t('Price'),age=null}) {
  return <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',gap:8,
    marginBottom:14,padding:'8px 12px',background:C.surfaceAlt,borderRadius:8,border:`1px solid ${C.border}`}}>
    <span style={{fontSize:11,color:C.textMute}}>{label} {source&&<span style={{color:C.textMute,opacity:.7}}>· {source}</span>}
      {age&&<span style={{color:C.warning,opacity:.85}}> · {age}</span>}</span>
    <span style={{fontSize:13,fontWeight:700,color:C.text,fontVariantNumeric:'tabular-nums'}}>
      {loading?'…':`${fmtResource(value)} ISK`}
    </span>
  </div>;
}
