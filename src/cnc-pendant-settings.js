/* Shared machine preferences, persisted in Moonraker. No motion commands. */
(() => {
  'use strict';
  const defaults={units:'mm',jogSpeed:50,jogScale:'coarse',safeJogZ:5,belowZ5Cap:30};
  const valid=(key,value)=>key==='units'?['mm','cm','in'].includes(value):key==='jogScale'?['coarse','fine'].includes(value):typeof value==='number'&&Number.isFinite(value)&&(key==='jogSpeed'?value>=10&&value<=100:key==='belowZ5Cap'?value>=1&&value<=100:key==='safeJogZ'?value>=0&&value<=10000:false);
  const values={...defaults},pending=new Map(),deferred={};let ready=false,sequence=0,polling=false;
  const emit=(key,value)=>document.dispatchEvent(new CustomEvent('cnc-shared-setting',{detail:{key,value}}));
  async function request(method,key,value){const r=await fetch('/server/database/item'+(method==='GET'?'?namespace=cnc_pendant':''),{method,cache:'no-store',signal:AbortSignal.timeout(5000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({namespace:'cnc_pendant',key,value})}:{})});const data=await r.json();if(!r.ok||data.error){if(method==='GET'&&r.status===404)return {};throw Error('Shared settings unavailable');}return data.result?.value||{};}
  function error(){document.documentElement.dataset.settingsError='true';}
  async function set(key,value){if(!valid(key,value))throw Error('Invalid shared setting');const id=++sequence;pending.set(key,id);values[key]=value;emit(key,value);try{await request('POST',key,value);delete document.documentElement.dataset.settingsError;}catch(e){error();throw e;}finally{if(pending.get(key)===id)pending.delete(key);}}
  async function poll(){if(polling)return;polling=true;try{const remote=await request('GET');const editing=document.activeElement?.matches('input,textarea,select')||Number(document.documentElement.dataset.jogRequests||0)>0;
    for(const [key,defaultValue] of Object.entries(defaults)){const value=remote[key];if(value===undefined&&!ready){await set(key,defaultValue);continue;}if(!valid(key,value)||pending.has(key))continue;if(editing){deferred[key]=value;continue;}delete deferred[key];if(values[key]!==value){values[key]=value;emit(key,value);}}
    ready=true;document.documentElement.dataset.settingsReady='true';delete document.documentElement.dataset.settingsError;
  }catch(e){error();}finally{polling=false;setTimeout(poll,1500);}}
  window.CncSettings={get:key=>values[key],set,get ready(){return ready}};
  document.addEventListener('focusout',()=>{setTimeout(()=>{if(document.activeElement?.matches('input,textarea,select'))return;for(const [key,value] of Object.entries(deferred)){if(!pending.has(key)&&values[key]!==value){values[key]=value;emit(key,value);}delete deferred[key];}},0);});
  poll();
})();
