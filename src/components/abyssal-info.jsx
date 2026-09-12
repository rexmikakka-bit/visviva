import { useEffect, useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { customAbyssal, MANUAL_OWNER } from '../lib/abyssal-library.js';
import { readAbyssals, readListings, editAbyssal, saveCustomAbyssal, forgetAbyssal } from '../lib/abyssal-store.js';
import { abyssalProvenance, BUYABLE, EXPIRED } from '../lib/shopping-list.js';
import { mutaMarketUrl, JITA_4_4_STATION_ID } from '../lib/mutamarket.js';
import { listCharacters, onCharactersChanged, openContractWindow, UI_SCOPE } from '../lib/esi.js';
import { useOnline } from '../lib/use-online.js';
import { SourceBadge } from './source-badge.jsx';
import { PriceCard } from './price-card.jsx';

const isk=value=>`${value.toLocaleString(undefined,{maximumFractionDigits:2})} ISK`;
const positive=value=>typeof value==='number'&&Number.isFinite(value)&&value>0;

export function AbyssalInfo({mod,initialRecord,onChanged,onSaved}){
  const online=useOnline();
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [label,setLabel]=useState(initialRecord?.label??''),[savedId,setSavedId]=useState(null);
  const [characters,setCharacters]=useState(listCharacters),[characterId,setCharacterId]=useState('');
  const [sent,setSent]=useState(false),[remove,setRemove]=useState(false);
  useEffect(()=>{
    let active=true;
    Promise.all([readAbyssals(),readListings()]).then(([owned,listings])=>{
      if(active){setData({owned,listings});setLabel(owned.find(r=>r.itemId===mod.abyssalItemId)?.label??initialRecord?.label??'');}
    }).catch(e=>{if(active)setError(e.message);});
    return()=>{active=false;};
  },[mod.abyssalItemId,initialRecord]);
  useEffect(()=>onCharactersChanged(()=>setCharacters(listCharacters())),[]);
  const id=savedId??mod.abyssalItemId;
  const {record,listing,state,expiresAt}=abyssalProvenance(id,data??{owned:initialRecord?[initialRecord]:[]});
  const permitted=characters.filter(c=>c.scopes?.includes(UI_SCOPE));
  const character=permitted.find(c=>String(c.characterId)===characterId)??permitted[0];
  const action=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  const changed=rows=>{setData(d=>({...d,owned:rows}));onChanged?.(rows);};
  const save=()=>action(async()=>{
    const copy=customAbyssal(mod,{label,ownerName:t('Custom modules'),locationName:t('Saved locally')});
    changed(await saveCustomAbyssal(copy));setSavedId(copy.itemId);onSaved?.(copy);
  });
  const url=mutaMarketUrl(listing?.slug);
  const button={minHeight:44,padding:'6px 10px',borderRadius:6,border:`1px solid ${C.border}`,background:'none',color:C.accent,fontSize:11,fontWeight:600,cursor:'pointer'};
  const line=(name,value)=><div style={{display:'flex',gap:12,padding:'4px 0',fontSize:12}}><span style={{color:C.textMute,flexShrink:0}}>{name}</span><span style={{color:C.text,marginLeft:'auto',textAlign:'right',overflowWrap:'anywhere',minWidth:0}}>{value}</span></div>;
  const badge=(text,color=C.textMute)=><span style={{fontSize:10,fontWeight:700,color,border:`1px solid ${color}55`,borderRadius:5,padding:'2px 5px'}}>{text}</span>;
  return <section aria-label={t('Abyssal details')} style={{padding:'0 0 12px',marginBottom:12,borderBottom:`1px solid ${C.border}`}}>
    {state===BUYABLE&&positive(listing.price)&&<PriceCard value={listing.price} source={t('MutaMarket')}/>}
    {(record||listing)&&<div style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:6,marginBottom:8}}>
      {record?<SourceBadge label={record.manual?t('Custom'):t('Owned')} color={C.accent}/>:<SourceBadge label={t('MutaMarket')}/>}
      {!record&&listing?.contractKind==='bid'&&badge(t('Auction'),C.warning)}
      {!record&&listing?.contractKind==='ask'&&badge(t('Item exchange'))}
      {!record&&(listing?.contractKind==='bundle'||listing?.contractItems>1)&&badge(t('Multi-item contract'),C.warning)}
    </div>}
    {!online&&<p role="status" style={{fontSize:11,color:C.textMute}}>{t('Offline · showing saved details. Contract availability may have changed.')}</p>}
    {!data&&!error&&<div role="status" style={{fontSize:11,color:C.textMute}}>{t('Loading saved module details…')}</div>}
    {error&&<p role="alert" style={{fontSize:11,color:C.danger}}>{error}</p>}
    {record&&<>
      {line(t('Owner'),record.characterName)}
      {line(t('Location'),record.location)}
      {line(record.characterId===MANUAL_OWNER?t('Saved'):t('Last seen'),new Date(record.lastSeen).toLocaleString())}
      {record.characterId===MANUAL_OWNER&&<div style={{fontSize:11,color:C.textMute}}>{t('Custom roll saved on this device; not verified in EVE assets.')}</div>}
      {!record.available&&<div style={{fontSize:11,color:C.danger}}>{t('Not found in last asset scan')}</div>}
    </>}
    {!record&&listing&&<>
      {listing.sellerName&&line(t('Seller'),listing.sellerName)}
      {line(t('Location'),listing.stationId===JITA_4_4_STATION_ID?t('Jita 4-4'):listing.stationId?`#${listing.stationId}`:t('Unknown'))}
      {line(t('Last checked'),new Date(listing.lastSeen).toLocaleString())}
      {expiresAt!=null&&line(t('Expires'),new Date(expiresAt).toLocaleString())}
    </>}
    {id&&!record?.manual&&line(t('Item ID'),id)}
    {!(state===BUYABLE&&positive(listing.price))&&
      <div style={{padding:'4px 0',fontSize:12,color:C.textMute}}>{t('No confirmed price')}</div>}
    {state===EXPIRED&&<div style={{fontSize:11,color:C.danger}}>{t('Saved contract has expired or is unavailable.')}</div>}
    {!record&&listing?.contractKind==='bid'&&positive(listing.cost)&&line(t('Auction bid'),isk(listing.cost))}
    {!record&&listing?.contractKind==='bundle'&&positive(listing.cost)&&line(t('Contract total'),isk(listing.cost))}
    {positive(listing?.estimatedValue)&&line(t('MutaMarket estimate'),isk(listing.estimatedValue))}
    {(url||state===BUYABLE)&&<div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
      {url&&<button style={button} disabled={busy||!online} onClick={()=>action(async()=>{
        if(window.Capacitor?.isNativePlatform?.()){const {Browser}=await import('@capacitor/browser');await Browser.open({url});}
        else window.open(url,'_blank','noopener,noreferrer');
      })}>{t('View on MutaMarket')}</button>}
      {state===BUYABLE&&<button style={button} disabled={busy||!character||!online} title={!character?t('Connect with contract access'):undefined}
        onClick={()=>action(async()=>{await openContractWindow(character.characterId,listing.contractId);setSent(true);})}>{sent?t('Sent to EVE'):t('Open in EVE')}</button>}
    </div>}
    {state===BUYABLE&&permitted.length>1&&<select aria-label={t('Character')} value={String(character?.characterId??'')} onChange={e=>setCharacterId(e.target.value)} style={{...button,width:'100%',marginTop:8,background:C.surface}}>{permitted.map(c=><option key={c.characterId} value={c.characterId}>{c.characterName}</option>)}</select>}
    {(record||data)&&<label style={{display:'block',marginTop:10,color:C.textMute,fontSize:11}}>{t('Custom name')}
      <input aria-label={t('Label')} value={label} maxLength={120} disabled={busy} onChange={e=>setLabel(e.target.value)} onBlur={()=>{
        if(record&&label!==(record.label??''))action(async()=>changed(await editAbyssal(record.itemId,{label})));
      }} style={{display:'block',boxSizing:'border-box',width:'100%',marginTop:4,padding:'8px 10px',fontSize:16,color:C.text,background:C.surfaceAlt,border:`1px solid ${C.border}`,borderRadius:6}}/>
    </label>}
    {!record&&data&&<button style={{...button,marginTop:8}} disabled={busy} onClick={save}>{listing?t('Save custom copy to My Abyssals'):t('Save to My Abyssals')}</button>}
    {record?.characterId===MANUAL_OWNER&&(remove?<div style={{marginTop:8,fontSize:11,color:C.textMute}}>
      {t('Remove this saved copy? Fitted modules keep their rolls.')}
      <div style={{display:'flex',gap:8}}><button style={button} disabled={busy} onClick={()=>action(async()=>{changed(await forgetAbyssal(record.itemId));setSavedId(null);setRemove(false);})}>{t('Remove')}</button><button style={button} onClick={()=>setRemove(false)}>{t('Cancel')}</button></div>
    </div>:<button style={{...button,marginTop:8,color:C.textMute}} disabled={busy} onClick={()=>setRemove(true)}>{t('Remove from My Abyssals')}</button>)}
  </section>;
}
