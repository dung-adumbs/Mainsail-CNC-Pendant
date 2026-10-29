/* Shared machine preferences, persisted in Moonraker. No motion commands. */
(() => {
  'use strict';
  const defaults={units:'mm',jogSpeed:50,jogScale:'coarse',safeJogZ:5,belowZ5Cap:30,temperatureWarning:75,travelXY:3000,travelZ:180,spoilboardX:8.2,spoilboardY:9.5,homeXYMode:'spoilboard',lastWorkOriginX:8.2,lastWorkOriginY:9.5,routerDialMap:[],velocityTime:'s'};
  const valid=(key,value)=>key==='homeXYMode'?['machine','spoilboard','last'].includes(value):key==='velocityTime'?['s','min'].includes(value):key==='routerDialMap'?Array.isArray(value)&&value.length<=32&&value.every(p=>typeof p.label==='string'&&p.label.length>0&&p.label.length<=60&&Number.isFinite(p.rpm)&&p.rpm>0):key==='units'?['mm','cm','in'].includes(value):key==='jogScale'?['coarse','fine'].includes(value):typeof value==='number'&&Number.isFinite(value)&&(key==='jogSpeed'?value>=10&&value<=100:key==='belowZ5Cap'?value>=1&&value<=100:key==='temperatureWarning'?value>=40&&value<=85&&Number.isInteger(value):key==='safeJogZ'?value>=0&&value<=10000:key==='travelXY'?value>=1&&value<=30000:key==='travelZ'?value>=1&&value<=3000:['spoilboardX','spoilboardY','lastWorkOriginX','lastWorkOriginY'].includes(key)?value>=-10000&&value<=10000:false);
  const values={...defaults},pending=new Map(),deferred={};let ready=false,sequence=0,polling=false;
  const emit=(key,value)=>document.dispatchEvent(new CustomEvent('cnc-shared-setting',{detail:{key,value}}));
  async function request(method,key,value){const r=await fetch('/server/database/item'+(method==='GET'?'?namespace=cnc_pendant':''),{method,cache:'no-store',signal:AbortSignal.timeout(5000),...(method==='POST'?{headers:{'Content-Type':'application/json'},body:JSON.stringify({namespace:'cnc_pendant',key,value})}:{})});const data=await r.json();if(!r.ok||data.error){if(method==='GET'&&r.status===404)return {};throw Error('Shared settings unavailable');}return data.result?.value||{};}
  function error(){document.documentElement.dataset.settingsError='true';}
  async function set(key,value){if(!valid(key,value))throw Error('Invalid shared setting');const id=++sequence;pending.set(key,id);values[key]=value;emit(key,value);try{await request('POST',key,value);delete document.documentElement.dataset.settingsError;}catch(e){error();throw e;}finally{if(pending.get(key)===id)pending.delete(key);}}
  async function poll(){if(polling)return;polling=true;try{const remote=await request('GET');const editing=document.activeElement?.matches('input,textarea,select')||Number(document.documentElement.dataset.jogRequests||0)>0;
    for(const [key,defaultValue] of Object.entries(defaults)){const value=remote[key];if(value===undefined&&!ready){await set(key,defaultValue);continue;}if(!valid(key,value)||pending.has(key))continue;if(editing){deferred[key]=value;continue;}delete deferred[key];if(values[key]!==value){values[key]=value;emit(key,value);}}
    ready=true;document.documentElement.dataset.settingsReady='true';delete document.documentElement.dataset.settingsError;
  }catch(e){error();}finally{polling=false;setTimeout(poll,1500);}}
  function length(){const unit=values.units,factor=unit==='in'?25.4:unit==='cm'?10:1;return {unit,factor,fromMm:n=>n/factor,toMm:n=>n*factor,format:(n,d=unit==='in'?4:3)=>Number((n/factor).toFixed(d)).toString()};}
  function velocity(){const minute=values.velocityTime==='min',time=minute?60:1,scale=length(),factor=time/scale.factor;return {unit:scale.unit+(minute?'/min':'/s'),fromSecond:n=>n*factor,toSecond:n=>n/factor,fromMinute:n=>n*factor/60,toMinute:n=>n*60/factor};}
  function routerSpeed(rpm){
    if(!Number.isFinite(rpm)||rpm<=0)return 'Router RPM unavailable · check setup sheet';
    const points=values.routerDialMap;if(!points.length)return rpm+' RPM · dial reference unavailable';
    const point=points.reduce((a,b)=>Math.abs(b.rpm-rpm)<Math.abs(a.rpm-rpm)?b:a),low=Math.min(...points.map(p=>p.rpm)),high=Math.max(...points.map(p=>p.rpm));
    return rpm.toLocaleString()+' RPM · Dial: '+point.label+' — estimated (~'+point.rpm.toLocaleString()+' RPM)'+(rpm<low||rpm>high?' · requested RPM outside mapped range':'');
  }
  window.CncSettings={length,velocity,routerSpeed,get:key=>values[key],set,get ready(){return ready}};
  document.addEventListener('focusout',()=>{setTimeout(()=>{if(document.activeElement?.matches('input,textarea,select'))return;for(const [key,value] of Object.entries(deferred)){if(!pending.has(key)&&values[key]!==value){values[key]=value;emit(key,value);}delete deferred[key];}},0);});
  poll();
})();
