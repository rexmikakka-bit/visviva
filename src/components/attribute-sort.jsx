import { useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';

const Padlock=({open})=><svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
  <rect x="3.2" y="7" width="9.6" height="7" rx="1.6"/>
  {/* The open shackle leans off the right post, so locked and unlocked differ in SHAPE and not only
      in tint — the two states sit in the same column and a colour-only difference is unreadable
      down a list of twelve. */}
  <path d={open?'M5.8 7V4.9a2.6 2.6 0 0 1 5-1':'M5.8 7V4.9a2.2 2.2 0 0 1 4.4 0V7'}/>
</svg>;

// One control for the owned browser and Variations; directions refer to displayed values.
//
// `locks` is optional and the owned browser passes none: a lock means "no worse than the module
// currently FITTED", which is a question only the compare view has a baseline to answer.
export function AttributeSort({value,direction,onChange,onReverse,options,Sheet,locks,onToggleLock}){
  const [open,setOpen]=useState(false);
  const style={minWidth:0,minHeight:44,padding:'0 4px',borderRadius:6,border:'none',background:'none',color:C.textMid,fontSize:11,fontWeight:500,cursor:'pointer'};
  const label=options.find(o=>o.value===value)?.label??'';
  const row={display:'flex',alignItems:'center',gap:12,minHeight:48,padding:'12px 4px',background:'none',border:'none',fontSize:13,textAlign:'left',cursor:'pointer'};
  // Two targets in one row, the same shape the abyssal source sheet's character rows use: the label
  // picks what to sort by, the padlock filters by it. Splitting them across two sheets would mean
  // leaving the list to say "at least as good as fitted" about the attribute you just chose.
  const option=o=>{
    const lockable=!!onToggleLock&&o.lockable;
    const locked=lockable&&locks?.has(o.value);
    return <div key={o.value} style={{display:'flex',alignItems:'center',borderBottom:`1px solid ${C.border}`}}>
      <button aria-pressed={o.value===value} onClick={()=>{onChange(o.value);setOpen(false);}}
        style={{...row,flex:1,minWidth:0,color:o.value===value?C.accent:C.text}}>
        <span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{o.label}</span>{o.value===value&&<span aria-hidden="true">✓</span>}
      </button>
      {lockable&&<button aria-pressed={!!locked}
        aria-label={locked?t('Show any {label}',{label:o.label}):t('Only show {label} at least as good as fitted',{label:o.label})}
        title={locked?t('Show any {label}',{label:o.label}):t('Only show {label} at least as good as fitted',{label:o.label})}
        onClick={()=>onToggleLock(o.value)}
        style={{width:44,height:44,flexShrink:0,padding:0,background:'none',border:'none',cursor:'pointer',color:locked?C.accent:C.textMute,display:'flex',alignItems:'center',justifyContent:'center'}}>
        <span style={{width:28,height:26,borderRadius:6,background:locked?C.accentLight:'none',display:'flex',alignItems:'center',justifyContent:'center'}}><Padlock open={!locked}/></span>
      </button>}
    </div>;
  };
  return <><div style={{display:'flex',gap:0,minWidth:0,flex:1,maxWidth:'65%',justifyContent:'flex-end'}}>
    <button aria-label={t('Sort by {label}',{label})} aria-expanded={open} onClick={()=>setOpen(true)} style={{...style,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:7,textAlign:'right'}}>
      <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{label}</span>
      {/* The count, not the names: a lock hides rows from a list this button is not on screen with,
          and without it "31 variants" and "4 variants" look like two different markets. */}
      {locks?.size>0&&<span style={{flexShrink:0,display:'flex',alignItems:'center',gap:3,color:C.accent}}><Padlock open={false}/>{locks.size}</span>}
      <svg aria-hidden="true" width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" style={{flexShrink:0,color:C.textMute}}><path d="m3 4.5 3 3 3-3"/></svg>
    </button>
    <button aria-label={t('Reverse sort order')} title={direction==='desc'?t('{label}, highest first — tap to reverse',{label}):t('{label}, lowest first — tap to reverse',{label})} onClick={onReverse} style={{...style,width:44,flexShrink:0,fontSize:14}}>{direction==='desc'?'↓':'↑'}</button>
  </div>
  {open&&<Sheet title={t('Sort by attribute')} onClose={()=>setOpen(false)} height="65vh">
    <div style={{padding:'0 16px 16px'}}>
      {onToggleLock&&<p style={{fontSize:11,color:C.textMute,margin:'2px 4px 8px'}}>
        {t('Tap a name to sort by it. Tap its padlock to hide anything worse than the fitted module.')}
      </p>}
      {options.map(option)}
    </div>
  </Sheet>}</>;
}
