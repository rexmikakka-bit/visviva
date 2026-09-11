import { useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';

// One control for the owned browser and Variations; directions refer to displayed values.
export function AttributeSort({value,direction,onChange,onReverse,options,Sheet}){
  const [open,setOpen]=useState(false);
  const style={minWidth:0,minHeight:44,padding:'0 4px',borderRadius:6,border:'none',background:'none',color:C.textMid,fontSize:11,fontWeight:500,cursor:'pointer'};
  const label=options.find(o=>o.value===value)?.label??'';
  return <><div style={{display:'flex',gap:0,minWidth:0,flex:1,maxWidth:'65%',justifyContent:'flex-end'}}>
    <button aria-label={t('Sort by {label}',{label})} aria-expanded={open} onClick={()=>setOpen(true)} style={{...style,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:7,textAlign:'right'}}>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span><svg aria-hidden="true" width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{flexShrink:0,color:C.textMute}}><path d="m3 4.5 3 3 3-3"/></svg>
    </button>
    <button aria-label={t('Reverse sort order')} title={direction==='desc'?t('{label}, highest first — tap to reverse',{label}):t('{label}, lowest first — tap to reverse',{label})} onClick={onReverse} style={{...style,width:44,flexShrink:0,fontSize:14}}>{direction==='desc'?'↓':'↑'}</button>
  </div>
  {open&&<Sheet title={t('Sort by attribute')} onClose={()=>setOpen(false)} height="65vh">
    <div style={{padding:'0 16px 16px'}}>{options.map(o=><button key={o.value} aria-pressed={o.value===value} onClick={()=>{onChange(o.value);setOpen(false);}}
      style={{display:'flex',alignItems:'center',gap:12,width:'100%',minHeight:48,padding:'12px 4px',background:'none',border:'none',borderBottom:`1px solid ${C.border}`,color:o.value===value?C.accent:C.text,fontSize:13,textAlign:'left',cursor:'pointer'}}>
      <span style={{flex:1}}>{o.label}</span>{o.value===value&&<span aria-hidden="true">✓</span>}
    </button>)}</div>
  </Sheet>}</>;
}
