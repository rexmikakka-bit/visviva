import { useEffect, useRef, useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { ESI_SCOPES } from '../esi-config.js';
import { beginLogin, listCharacters, onCharactersChanged, getLastLoginError } from '../lib/esi.js';
import { ASSET_SCOPE, assetLocation, libraryModule } from '../lib/abyssal-library.js';
import { readAbyssals, saveAbyssalScan, editAbyssal } from '../lib/abyssal-store.js';
import { scanAbyssals, importAbyssals } from '../lib/abyssal-import.js';

export function AbyssalLibrary({slotType,search,onSelect,slots,formatValue,attributeLabel,renderRow}){
  const [records,setRecords]=useState([]),[characters,setCharacters]=useState(listCharacters);
  const [characterId,setCharacterId]=useState(''),[scan,setScan]=useState(null),[selected,setSelected]=useState([]);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState(''),[report,setReport]=useState(null);
  const [favorites,setFavorites]=useState(false),[allSlots,setAllSlots]=useState(false),[sort,setSort]=useState(''),[descending,setDescending]=useState(false);
  const [limit,setLimit]=useState(40),[expanded,setExpanded]=useState(null),[typeFilter,setTypeFilter]=useState('');
  const controller=useRef(null),mounted=useRef(true);
  useEffect(()=>{
    mounted.current=true;
    readAbyssals().then(rows=>{if(mounted.current)setRecords(rows);}).catch(e=>{if(mounted.current)setError(e.message);});
    const off=onCharactersChanged(()=>{setCharacters(listCharacters());const e=getLastLoginError();if(e)setError(e);});
    return()=>{mounted.current=false;controller.current?.abort();off();};
  },[]);
  const character=characters.find(c=>String(c.characterId)===characterId)??characters[0];
  const allowed=character?.scopes?.includes(ASSET_SCOPE);
  const run=async task=>{
    if(controller.current)return;
    const abort=new AbortController();controller.current=abort;setBusy(true);setError('');setReport(null);
    try{await task(abort.signal);}catch(e){if(mounted.current&&e.name!=='AbortError')setError(e.message);}
    finally{controller.current=null;if(mounted.current){setBusy(false);setProgress(null);try{setRecords(await readAbyssals());}catch(e){setError(e.message);}}}
  };
  const progressUpdate=value=>{if(mounted.current)setProgress(value);};
  const scanAssets=()=>run(async signal=>{
    setScan(null);
    const result=await scanAbyssals(character,{signal,onProgress:progressUpdate});
    if(signal.aborted)return;
    setScan(result);setSelected([...new Set(result.candidates.map(a=>String(a.location_id)))]);
  });
  const importSelected=()=>run(async signal=>{
    const result=await importAbyssals(scan,selected,await readAbyssals(),{signal,onProgress:progressUpdate,
      onBatch:async batch=>{const saved=await saveAbyssalScan(batch,scan);if(mounted.current)setRecords(saved);}});
    if(!signal.aborted)setReport(result);
  });
  const edit=async(item,changes)=>{try{setRecords(await editAbyssal(item.itemId,changes));}catch(e){setError(e.message);}};
  const byId=new Map((scan?.assets??[]).map(a=>[a.item_id,a]));
  const locations=new Map();
  for(const a of scan?.candidates??[]){const key=String(a.location_id),old=locations.get(key);locations.set(key,{name:assetLocation(a,byId,scan.names),count:(old?.count??0)+1});}
  const eligible=records.filter(r=>allSlots||r.slot===slotType||(slotType==='rigs'&&r.slot==='rig'));
  const names=[...new Set(eligible.map(r=>r.name))].sort();
  const words=search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filtered=eligible.filter(r=>(!favorites||r.favorite)&&(!typeFilter||r.name===typeFilter)&&
    words.every(w=>`${r.name} ${r.label??''} ${r.characterName} ${r.location} ${r.itemId}`.toLowerCase().includes(w)));
  const attributes=[...new Set(filtered.flatMap(r=>Object.keys(r.mutations)))].sort();
  filtered.sort((a,b)=>{
    if(sort){const av=a.mutations[sort],bv=b.mutations[sort];if(av==null)return bv==null?0:1;if(bv==null)return -1;const diff=(av-bv)*(descending?-1:1);if(diff)return diff;}
    return (a.name.localeCompare(b.name)||a.itemId.localeCompare(b.itemId))*(descending&&!sort?-1:1);
  });
  const fitted=new Set(Object.values(slots??{}).flatMap(v=>Array.isArray(v)?v:[]).map(m=>m?.abyssalItemId).filter(Boolean));
  const button={padding:'9px 12px',borderRadius:7,border:`1px solid ${C.border}`,background:C.surfaceAlt,color:C.text,cursor:'pointer',fontSize:12};
  const input={...button,minWidth:0,boxSizing:'border-box',fontSize:12,padding:'6px 8px'};
  return <div style={{color:C.text,fontSize:12}}>
    <details open={records.length===0||busy||!!error} style={{padding:'10px 16px',borderBottom:`1px solid ${C.border}`}}>
    <summary style={{color:C.accent,cursor:'pointer',fontWeight:600}}>{t('Import')} · {character?.characterName}</summary>
    <p style={{color:C.textMute}}>{t('Import your rolled modules from EVE. Saved rolls stay available offline.')}</p>
    <select aria-label={t('Character')} style={input} disabled={busy||!characters.length} value={String(character?.characterId??'')}
      onChange={e=>{setCharacterId(e.target.value);setScan(null);setReport(null);}}>
      {!characters.length&&<option value="">{t('No linked characters')}</option>}
      {characters.map(c=><option key={c.characterId} value={String(c.characterId)}>{c.characterName}</option>)}
    </select>
    <div style={{display:'flex',gap:8,marginTop:8,flexWrap:'wrap'}}>
      {!allowed&&<button style={button} disabled={busy} onClick={()=>run(()=>beginLogin([...new Set([...ESI_SCOPES,ASSET_SCOPE,...(character?.scopes??[])])]))}>{t('Connect with asset access')}</button>}
      {allowed&&<button style={button} disabled={busy} onClick={()=>run(()=>beginLogin([...new Set([...ESI_SCOPES,ASSET_SCOPE])]))}>{t('Add character')}</button>}
      {allowed&&<button style={button} disabled={busy} onClick={scanAssets}>{t('Scan character assets')}</button>}
      {busy&&<button style={button} onClick={()=>controller.current?.abort()}>{t('Cancel')}</button>}
    </div>
    <div role="status" style={{margin:'8px 0',color:C.textMute}}>
      {progress&&`${progress.stage==='scan'?t('Scanning assets'):t('Importing modules')} ${progress.done} / ${progress.total}`}
      {report&&t('Imported {n}; failed {failed}.',{n:report.imported,failed:report.failures.length})}
    </div>
    {error&&<p role="alert" style={{color:C.danger}}>{error}</p>}
    {!!report?.failures.length&&<details><summary>{t('Import errors')}</summary>{report.failures.map(f=><p key={f.itemId}>#{f.itemId}: {f.message}</p>)}</details>}
    {scan&&<details open={!report} style={{marginBottom:12}}>
      <summary>{t('Containers and locations')} ({scan.candidates.length})</summary>
      <p style={{color:C.textMute}}>{t('ESI assets can be cached for about an hour. Unresolved locations show their IDs.')}</p>
      {!!scan.warnings.length&&<p>{t('Some location names could not be loaded.')}</p>}
      <button style={button} disabled={busy} onClick={()=>setSelected([...locations.keys()])}>{t('Select all')}</button>{' '}
      <button style={button} disabled={busy} onClick={()=>setSelected([])}>{t('Clear')}</button>
      {[...locations].map(([key,l])=><label key={key} style={{display:'flex',gap:8,padding:'10px 0',overflowWrap:'anywhere'}}>
        <input type="checkbox" disabled={busy} checked={selected.includes(key)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,key]:prev.filter(k=>k!==key))}/>
        {l.name} ({l.count})
      </label>)}
      <button style={button} disabled={busy||(locations.size>0&&!selected.length)} onClick={importSelected}>{t('Import selected locations')}</button>
    </details>}
    </details>
    <div style={{padding:'8px 16px',borderBottom:`1px solid ${C.border}`}}>
    <div style={{display:'flex',gap:12,margin:'4px 0 8px',flexWrap:'wrap'}}>
      <label><input type="checkbox" checked={allSlots} onChange={e=>{setAllSlots(e.target.checked);setTypeFilter('');}}/> {t('All slot types')}</label>
      <label><input type="checkbox" checked={favorites} onChange={e=>setFavorites(e.target.checked)}/> {t('Favorites')}</label>
    </div>
    <select aria-label={t('Module type')} style={input} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
      <option value="">{t('All modules')}</option>{names.map(n=><option key={n}>{n}</option>)}
    </select>
    <div style={{display:'flex',gap:6,margin:'8px 0'}}>
      <select aria-label={t('Sort by attribute')} style={{...input,flex:1}} value={sort} onChange={e=>setSort(e.target.value)}>
        <option value="">{t('Name')}</option>{attributes.map(a=><option key={a} value={a}>{attributeLabel(a)}</option>)}
      </select>
      <button style={button} aria-label={t('Reverse sort order')} onClick={()=>setDescending(d=>!d)}>{descending?'↓':'↑'}</button>
    </div>
    <div style={{fontSize:10,color:C.textMute}}>{t('Saved modules')}: {filtered.length}</div>
    </div>
    {!filtered.length&&<p>{t('No saved modules match this slot or search.')}</p>}
    {filtered.slice(0,limit).map(item=>{
      const compatible=item.slot===slotType||(item.slot==='rig'&&slotType==='rigs');
      const isFitted=fitted.has(item.itemId);
      return <div key={item.itemId}>{renderRow({
        mod:{...libraryModule(item),name:item.label||item.name},
        disabled:!compatible||isFitted||busy,
        onAdd:()=>onSelect(libraryModule(item)),
        onInfo:()=>setExpanded(expanded===item.itemId?null:item.itemId),
        subtitle:`${isFitted?t('Fitted')+' · ':''}${item.characterName} · ${item.location}`,
        children:<>
          {!item.available&&<div style={{color:C.danger,fontSize:10,marginTop:4}}>{t('Not found in last asset scan')}</div>}
          <div style={{display:'flex',flexWrap:'wrap',gap:'3px 10px',marginTop:5,fontSize:10}}>
            {Object.entries(item.mutations).filter(([a])=>!['cpu','power'].includes(a)).map(([a,v])=>
              <span key={a} style={{color:C.textMid}}>{attributeLabel(a)} <span style={{fontWeight:700,color:C.text}}>{formatValue(a,v)}</span></span>)}
          </div>
          {expanded===item.itemId&&<div style={{paddingTop:8}}>
            <div style={{color:C.textMid,fontSize:11,overflowWrap:'anywhere'}}>{item.name} · #{item.itemId}</div>
            <div style={{color:C.textMute,fontSize:10,margin:'4px 0 8px'}}>{item.characterName} · {item.location}<br/>{t('Last seen')}: {new Date(item.lastSeen).toLocaleString()}</div>
            <div style={{display:'flex',gap:8}}>
              <input aria-label={t('Label')} placeholder={t('Label')} style={{...input,flex:1}} disabled={busy} defaultValue={item.label??''} maxLength={120}
                onBlur={e=>{if(e.target.value!==(item.label??''))edit(item,{label:e.target.value});}}/>
              <button style={button} disabled={busy} aria-label={t('Favorite')} aria-pressed={!!item.favorite} onClick={()=>edit(item,{favorite:!item.favorite})}>{item.favorite?'★':'☆'}</button>
            </div>
          </div>}
        </>
      })}</div>;
    })}
    {filtered.length>limit&&<button style={button} onClick={()=>setLimit(n=>n+40)}>{t('Show more')}</button>}
  </div>;
}
