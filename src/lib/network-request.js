export function requireOnline(){
  if(globalThis.navigator?.onLine===false)throw new Error('You are offline. Saved modules and contracts are still available.');
}

// Bound the whole response, including its body. Native networking may not honor AbortSignal,
// so the race also ensures that the interface leaves its loading state.
export async function networkJSON(url,{signal,timeout=15000,fetcher=globalThis.fetch,...options}={}){
  requireOnline();
  if(signal?.aborted)throw new DOMException('Cancelled','AbortError');
  const controller=new AbortController();let timer,abort;
  const stopped=new Promise((_,reject)=>{
    abort=()=>{controller.abort();reject(new DOMException('Cancelled','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    timer=setTimeout(()=>{controller.abort();reject(new Error('Connection timed out. Try again when you are online.'));},timeout);
  });
  try{
    return await Promise.race([stopped,(async()=>{
      const response=await fetcher(url,{...options,signal:controller.signal});
      if(!response.ok)throw Object.assign(new Error(`Request failed (${response.status})`),{status:response.status,retryAfter:response.headers.get('Retry-After')});
      return {response,body:await response.json()};
    })()]);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
