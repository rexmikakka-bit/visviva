import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { abyssalContainerGroups } from '../lib/abyssal-browser.js';

export function AbyssalSources({records,selection,onChange,onClose,Sheet}){
  const row={display:'flex',alignItems:'center',gap:12,width:'100%',minHeight:48,padding:'12px 4px',background:'none',border:'none',borderBottom:`1px solid ${C.border}`,fontSize:13,textAlign:'left',cursor:'pointer'};
  const choice=(id,label,subtitle)=><button key={id} aria-pressed={selection===id} onClick={()=>{onChange(id);onClose();}} style={{...row,color:selection===id?C.accent:C.text}}>
    <span style={{flex:1,minWidth:0,overflowWrap:'anywhere'}}>{label}{subtitle&&<span style={{display:'block',marginTop:3,fontSize:11,color:C.textMute}}>{subtitle}</span>}</span>
    {selection===id&&<span aria-hidden="true">✓</span>}
  </button>;
  return <Sheet title={t('Abyssal sources')} onClose={onClose} height="65vh">
    <div style={{padding:'0 16px 16px'}}>
      {choice('owned',t('Owned only'),t('All saved containers'))}
      <div style={{padding:'18px 4px 4px',fontSize:11,fontWeight:700,color:C.textMute}}>{t('Containers')}</div>
      {abyssalContainerGroups(records).map(g=>choice(g.id,g.name,g.subtitle))}
      {!records.length&&<p style={{fontSize:12,color:C.textMute}}>{t('No saved modules match this slot or search.')}</p>}
      <div style={{paddingTop:12}}>{['MutaMarket'].map(name=><button key={name} disabled style={{...row,color:C.textMute,cursor:'default'}}>
        <span style={{flex:1}}>{name}<span style={{display:'block',fontSize:11,marginTop:3}}>{t('Not connected')}</span></span>
      </button>)}</div>
    </div>
  </Sheet>;
}
