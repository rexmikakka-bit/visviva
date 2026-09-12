import { useEffect, useRef, useState } from 'react';
import { C } from '../theme.js';
import { t } from '../lib/i18n.js';
import { ESI_SCOPES } from '../esi-config.js';
import { beginLogin, listCharacters, onCharactersChanged, getLastLoginError } from '../lib/esi.js';
import { ASSET_SCOPE, assetLocation, libraryModule } from '../lib/abyssal-library.js';
import { readAbyssals, saveAbyssalScan, editAbyssal } from '../lib/abyssal-store.js';
import { scanAbyssals, importAbyssals } from '../lib/abyssal-import.js';
import { abyssalsForSlot, abyssalMarketGroups, abyssalContainerGroups, abyssalBrowseLevel, atJita44 } from '../lib/abyssal-browser.js';
import { bestFirstDirection } from '../lib/compare.js';
import { AttributeSort } from './attribute-sort.jsx';

export function AbyssalLibrary({slotType,search,onSelect,slots,marketTree,path,onPathChange,onBack,backSwipe,formatValue,attributeLabel,sortValue,renderRow,renderGroup,renderInfo,Sheet}){
  const [records,setRecords]=useState([]),[characters,setCharacters]=useState(listCharacters);
  const [characterId,setCharacterId]=useState(''),[scan,setScan]=useState(null),[selected,setSelected]=useState([]);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(null),[error,setError]=useState(''),[report,setReport]=useState(null);
  const [favorites,setFavorites]=useState(false),[jita,setJita]=useState(false),[groupBy,setGroupBy]=useState('market'),[sort,setSort]=useState(''),[descending,setDescending]=useState(false);
  const [limit,setLimit]=useState(40),[infoId,setInfoId]=useState(null);
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
  const eligible=abyssalsForSlot(records,slotType);
  const words=search.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matching=eligible.filter(r=>(!favorites||r.favorite)&&(!jita||atJita44(r))&&
    words.every(w=>`${r.name} ${r.label??''} ${r.characterName} ${r.location} ${r.itemId}`.toLowerCase().includes(w)));
  const group=rows=>groupBy==='market'?abyssalMarketGroups(rows,marketTree):abyssalContainerGroups(rows);
  // Use the full market tree for breadcrumbs: opening My Abyssals from a standard
  // category with no owned rolls must still name that category and allow Back.
  // Container breadcrumbs similarly survive removing the last favorite.
  const {breadcrumb}=abyssalBrowseLevel(groupBy==='market'?marketTree:group(eligible),path);
  const level=abyssalBrowseLevel(group(matching),path);
  const nodes=words.length?[]:level.nodes;
  const filtered=words.length?matching:level.records;
  const visibleCount=filtered.length+nodes.reduce((n,node)=>n+node.count,0);
  const nodeName=node=>node.other?t('Other modules'):node.name;
  const navigate=next=>{onPathChange(next);setLimit(40);};
  const info=records.find(r=>r.itemId===infoId);
  const attributes=[...new Set(filtered.flatMap(r=>Object.keys(r.mutations)))].sort();
  const activeSort=attributes.includes(sort)?sort:'';
  filtered.sort((a,b)=>{
    if(activeSort){const av=a.mutations[activeSort],bv=b.mutations[activeSort];if(av==null)return bv==null?0:1;if(bv==null)return -1;const diff=(sortValue(activeSort,av)-sortValue(activeSort,bv))*(descending?-1:1);if(diff)return diff;}
    return (a.name.localeCompare(b.name)||a.itemId.localeCompare(b.itemId))*(descending&&!activeSort?-1:1);
  });
  const fitted=new Set(Object.values(slots??{}).flatMap(v=>Array.isArray(v)?v:[]).map(m=>m?.abyssalItemId).filter(Boolean));
  // Share the mobile sort sheet with Variations.
  const button={padding:'5px 9px',borderRadius:6,border:`1px solid ${C.border}`,background:'none',color:C.textMid,cursor:'pointer',fontSize:11,fontWeight:700};
  const input={...button,width:'100%',minWidth:0,boxSizing:'border-box',background:C.surface,fontWeight:500,color:C.text,padding:'5px 6px'};
  const toggle=on=>({...button,background:on?C.accentLight:'none',borderColor:on?C.accentBorder:C.border,color:on?C.accent:C.textMute});
  return <><div style={{color:C.text,fontSize:12,flex:1}} {...backSwipe}>
    <details open={records.length===0||busy||!!error} style={{padding:'10px 16px',borderBottom:`1px solid ${C.border}`}}>
    <summary style={{color:C.textMid,cursor:'pointer',fontSize:12,fontWeight:700,overflowWrap:'anywhere'}}>{t('Import')}{character&&` · ${character.characterName}`}</summary>
    <p style={{color:C.textMute,fontSize:11,margin:'8px 0'}}>{t('Import your rolled modules from EVE. Saved rolls stay available offline.')}</p>
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
    <div role="status" style={{margin:progress||report?'8px 0':0,color:C.textMute}}>
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
    <div style={{display:'flex',alignItems:'center',gap:5,marginBottom:8,flexWrap:'wrap'}}>
      <button style={toggle(groupBy==='market')} aria-pressed={groupBy==='market'} onClick={()=>{setGroupBy('market');navigate([]);}}>{t('Browser')}</button>
      <button style={toggle(groupBy==='container')} aria-pressed={groupBy==='container'} onClick={()=>{setGroupBy('container');navigate([]);}}>{t('Containers')}</button>
      {/* Beside Favorites because it is the same kind of control — a filter over the whole library
          that survives browsing, not a place in the tree. Deliberately NOT a container node: rolls
          in Jita sit in dozens of different cans, and the question is the station, not the can. */}
      <button style={{...toggle(jita),marginLeft:'auto'}} aria-pressed={jita} onClick={()=>setJita(v=>!v)}>{t('Jita 4-4')}</button>
      <button style={toggle(favorites)} aria-pressed={favorites} onClick={()=>setFavorites(v=>!v)}>{t('Favorites')}</button>
    </div>
    <div style={{display:'flex',gap:6,alignItems:'center'}}>
      <span style={{fontSize:10,color:C.textMute,marginRight:'auto'}}>{t('Saved modules')}: {visibleCount}</span>
      {/* Aim a freshly picked attribute at its good end, as Variations does — the reason to sort a
          shelf of rolls by shield boost is to see the best one, not to scroll to the bottom. Name
          has no values to learn from, so it stays A–Z. */}
      {!!filtered.length&&<AttributeSort Sheet={Sheet} value={activeSort} direction={descending?'desc':'asc'}
        onChange={key=>{setSort(key);setDescending(bestFirstDirection(key,filtered.map(r=>({value:r.mutations[key],typeID:r.typeID})),sortValue)==='desc');}}
        onReverse={()=>setDescending(d=>!d)}
        options={[{value:'',label:t('Name')},...attributes.map(a=>({value:a,label:attributeLabel(a)}))]}/>}
    </div>
    </div>
    {(path.length>0||words.length>0)&&<div style={{position:'sticky',top:0,zIndex:3,display:'flex',alignItems:'center',gap:10,padding:'10px 14px',borderBottom:`1px solid ${C.border}`,background:C.surfaceAlt}}>
      <button onClick={onBack} style={{background:'none',border:'none',color:C.accent,fontSize:14,fontWeight:700,cursor:'pointer',padding:0,flexShrink:0}}>‹ {t('Back')}</button>
      <span style={{fontSize:12,color:C.textMute,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{words.length?t('Search results'):breadcrumb.map(nodeName).join(' / ')}</span>
    </div>}
    {!visibleCount&&<div style={{textAlign:'center',color:C.textMute,padding:'32px 16px',fontSize:14}}>{t('No saved modules match this slot or search.')}</div>}
    {nodes.map(node=><div key={node.id}>{renderGroup({node:{...node,name:nodeName(node)},count:node.count,onOpen:()=>navigate([...path,node.id]),wrapName:groupBy==='container'})}</div>)}
    {filtered.slice(0,limit).map(item=>{
      const compatible=item.slot===slotType||(item.slot==='rig'&&slotType==='rigs');
      const isFitted=fitted.has(item.itemId);
      return <div key={item.itemId}>{renderRow({
        mod:{...libraryModule(item),name:item.label||item.name},
        disabled:!compatible||isFitted||busy,
        onAdd:()=>onSelect(libraryModule(item)),
        onInfo:()=>setInfoId(item.itemId),
        actions:<button style={{background:'none',border:'none',padding:0,width:44,height:44,flexShrink:0,fontSize:20,color:item.favorite?C.accent:C.textMute,cursor:'pointer'}}
          disabled={busy} title={item.favorite?t('Remove from favorites'):t('Add to favorites')}
          aria-label={t('Favorite')} aria-pressed={!!item.favorite}
          onClick={()=>edit(item,{favorite:!item.favorite})}>{item.favorite?'★':'☆'}</button>,
        // A roll is one physical module, so it can only be in one slot — tapping it again has to do
        // nothing. Silence was the whole complaint: the row looked identical to every other one and
        // simply refused, which reads as a broken list rather than as "it is already in the fit".
        badges:isFitted?[{label:t('On this fit'),color:C.accent}]:undefined,
        subtitle:`${item.characterName} · ${item.location}`,
        children:<>
          {!item.available&&<div style={{color:C.danger,fontSize:10,marginTop:4}}>{t('Not found in last asset scan')}</div>}
          <div style={{display:'flex',flexWrap:'wrap',gap:'3px 10px',marginTop:5,fontSize:10}}>
            {Object.entries(item.mutations).filter(([a])=>!['cpu','power'].includes(a)).map(([a,v])=>
              <span key={a} style={{color:C.textMid}}>{attributeLabel(a)} <span style={{fontWeight:700,color:C.text}}>{formatValue(a,v)}</span></span>)}
          </div>
        </>
      })}</div>;
    })}
    {filtered.length>limit&&<button style={{...button,display:'block',margin:'12px auto'}} onClick={()=>setLimit(n=>n+40)}>{t('Show more')}</button>}
  </div>{info&&renderInfo({item:info,onClose:()=>setInfoId(null),children:<div style={{paddingTop:12,borderTop:`1px solid ${C.border}`,overflowWrap:'anywhere'}}>
    <div style={{color:C.textMid,fontSize:12}}>{info.characterName} · {info.location}</div>
    <div style={{color:C.textMute,fontSize:11}}>#{info.itemId}<br/>{t('Last seen')}: {new Date(info.lastSeen).toLocaleString()}</div>
    {!info.available&&<div style={{color:C.danger,fontSize:11}}>{t('Not found in last asset scan')}</div>}
    <input aria-label={t('Label')} placeholder={t('Label')} style={{...input,fontSize:16,marginTop:8}} disabled={busy} defaultValue={info.label??''} maxLength={120}
      onBlur={e=>{if(e.target.value!==(info.label??''))edit(info,{label:e.target.value});}}/>
  </div>})}</>;
}
