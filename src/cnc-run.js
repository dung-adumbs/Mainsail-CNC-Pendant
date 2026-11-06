/* Browser-side run context. Estimates never authorize motion. */
(() => {
 'use strict';
 const finite=x=>typeof x==='number'&&Number.isFinite(x),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
 const upper=(array,value)=>{let lo=0,hi=array.length;while(lo<hi){const mid=(lo+hi)>>>1;if(array[mid]<=value)lo=mid+1;else hi=mid;}return lo;};
 const duration=s=>!finite(s)?'Unavailable':s<60?Math.round(Math.max(0,s))+'s':Math.floor(s/3600)+'h '+Math.floor(s%3600/60)+'m';
 function build(bytes){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),lines=text.split(/(?<=\n)/),stages=[],ops=[],pauses=[],moves=[],identity={};let offset=0,stage=null,op=null,position=[null,null,null],feed=0,unsupported=false,stop=true,kind='UNKNOWN',pendingRpmChange=null;
  const encoder=new TextEncoder();
  const ensure=()=>{if(!stage){stage={number:1,start:0,operations:[],tool:null,rpm:null,setup:''};stages.push(stage);}return stage;};
  for(const raw of lines){const line=raw.trim(),start=offset;offset+=encoder.encode(raw).length;
   let m;if((m=line.match(/^; CNC_MOVE:\s*(\w+)/)))kind=m[1];
   if((m=line.match(/^; CNC_PROJECT_NAME:\s*(.*)/)))identity.name=m[1];
   if((m=line.match(/^; CNC_POSTING_MEMO:\s*(.*)/)))identity.memo=m[1];
   if((m=line.match(/^; CNC_PROJECT_STAGE:\s*(\d+)\/\d+\s*(.*)/))){stage={number:+m[1],start,operations:[],tool:null,rpm:null,setup:m[2]};stages.push(stage);op=null;}
   if((m=line.match(/^; CNC_BATCH_V1:\s*(.*)/))){try{const b=JSON.parse(m[1]);identity.document=identity.document||b.document;identity.name=identity.name||b.document;identity.memo=identity.memo||b.memo;ensure().setup=b.setup;}catch(_){}}
   if((m=line.match(/^; CNC_FUSION_SETUP:\s*(.*)/)))ensure().setup=m[1];
   if((m=line.match(/^; CNC_FUSION_OPERATION_V1:\s*(.*)/))){try{const o=JSON.parse(m[1]);ensure().operations.push(o);stage.tool=stage.tool||o.tool;stage.rpm=stage.rpm??o.rpm;}catch(_){}}
   if((m=line.match(/^; CNC_RPM_CHANGE_V1:\s*(.*)/))){try{const value=JSON.parse(m[1]),to=Number(value.to),from=value.from===null?null:Number(value.from);if(to>0&&Number.isFinite(to)&&(from===null||from>0&&Number.isFinite(from)))pendingRpmChange={from,to,reason:value.reason==='programmed'?'programmed':'section'};}catch(_){pendingRpmChange=null;}}
   if((m=line.match(/^; CNC_OPERATION:\s*(.*)/))){const st=ensure(),meta=st.operations.find(o=>o.name===m[1]);op={name:m[1],start,stage:st,meta};ops.push(op);}
   if(line==='PAUSE_BASE'||line==='PAUSE'){pauses.push({start,end:offset,stage:ensure(),operation:op,rpmChange:pendingRpmChange});pendingRpmChange=null;stop=true;}
   if(line==='M400')stop=true;
   if(/^M808\b|^G[23](?:\s|$)|^G9[12](?:\s|$)|^G20(?:\s|$)/.test(line))unsupported=true;
   if((m=line.match(/^G4\s+([PS])([\d.]+)/))){const seconds=Number(m[2])/(m[1]==='P'?1000:1);if(seconds>0)moves.push({start,end:offset,length:0,unit:[0,0,0],feed:1,fixed:seconds,stage:ensure(),op,stop:true});stop=true;}
   if(/^G1(?:\s|$)/.test(line)){
    const words=Object.fromEntries([...line.matchAll(/([XYZF])([-+\d.]+)/g)].map(m=>[m[1],Number(m[2])]));if(finite(words.F))feed=words.F;
    const next=position.map((v,i)=>finite(words['XYZ'[i]])?words['XYZ'[i]]:v);if(next.every(finite)&&position.every(finite)){
     const vector=next.map((v,i)=>v-position[i]),length=Math.hypot(...vector);if(length>1e-9&&feed>0)moves.push({start,end:offset,length,unit:vector.map(v=>v/length),feed:feed/60,stage:ensure(),op,stop,kind});stop=false;
    }position=next;kind='UNKNOWN';
   }
  }
  if(stage&&stage.operations.length&&!stage.tool)stage.tool=stage.operations[0].tool;
  for(let i=0;i<ops.length;i++)ops[i].end=ops[i+1]?.start??bytes.length;
  for(let i=0;i<stages.length;i++)stages[i].end=stages[i+1]?.start??bytes.length;
  return {size:bytes.length,identity,stages,ops,pauses,moves,unsupported,offsets:Float64Array.from(moves.map(m=>m.start))};
 }
 function jobIdentity(model,path=''){
  const identity=model?.identity||{},setups=[...new Set((model?.stages||[]).map(s=>s.setup).filter(Boolean))];
  return [identity.document||identity.name||path.split('/').pop().split('__')[0].replace(/\.(gcode|gco|gc|nc|ngc|tap)$/i,'').replaceAll('_',' ')||'CNC job',...setups,identity.memo||''].filter(Boolean).join(' · ');
 }
 function timing(model,settings){
  const factor=finite(settings.factor)&&settings.factor>0?settings.factor:1,vmax=finite(settings.velocity)&&settings.velocity>0?settings.velocity:Infinity,zmax=finite(settings.zVelocity)&&settings.zVelocity>0?settings.zVelocity:Infinity,accel=finite(settings.accel)&&settings.accel>0?settings.accel:null,corner=finite(settings.corner)&&settings.corner>=0?settings.corner:0;
  const n=model.moves.length,speeds=new Float64Array(n),junction=new Float64Array(n+1),times=new Float64Array(n+1);
  for(let i=0;i<n;i++){const m=model.moves[i];speeds[i]=Math.min(m.feed*factor,vmax,Math.abs(m.unit[2])>1e-9?zmax/Math.abs(m.unit[2]):Infinity);}
  for(let i=1;i<n;i++){
   const m=model.moves[i],p=model.moves[i-1];if(m.stop)continue;const dot=clamp(m.unit.reduce((s,v,k)=>s+v*p.unit[k],0),-1,1),half=Math.sqrt(Math.max(0,(1+dot)/2));
   junction[i]=Math.min(speeds[i-1],speeds[i],half>.999999?Infinity:corner*Math.sqrt((Math.SQRT2-1)*half/Math.max(1e-9,1-half)));
  }
  if(accel){for(let i=0;i<n;i++)junction[i+1]=Math.min(junction[i+1],Math.sqrt(junction[i]**2+2*accel*model.moves[i].length));for(let i=n-1;i>=0;i--)junction[i]=Math.min(junction[i],Math.sqrt(junction[i+1]**2+2*accel*model.moves[i].length));}
  for(let i=0;i<n;i++){
   const m=model.moves[i],v=speeds[i];if(m.fixed){times[i+1]=times[i]+m.fixed;continue;}let seconds=m.length/v;
   if(accel){const a=junction[i],b=junction[i+1],peak=Math.min(v,Math.sqrt(accel*m.length+(a*a+b*b)/2)),up=(peak*peak-a*a)/(2*accel),down=(peak*peak-b*b)/(2*accel);seconds=(peak-a)/accel+(peak-b)/accel+Math.max(0,m.length-up-down)/Math.max(peak,1e-9);}
   times[i+1]=times[i]+seconds;
  }
  return {times,total:times[n]||0};
 }
 function context(model,clock,status,now=Date.now()){
  const sd=status.virtual_sdcard||{},factor=status.gcode_move?.speed_factor||1,buffer=Math.max(0,(status.toolhead?.print_time||0)-(status.toolhead?.estimated_print_time||0)),paused=!!status.pause_resume?.is_paused,read=clamp(Number(paused&&status['gcode_macro PAUSE_BASE']?.valid?status['gcode_macro PAUSE_BASE'].file_position:sd.file_position)||0,0,model.size),readIndex=clamp(upper(model.offsets,read),0,model.moves.length),readTime=clock.times[readIndex]||0,doneTime=paused?readTime:Math.max(0,readTime-buffer),index=clamp(upper(clock.times,doneTime)-1,0,model.moves.length-1);
  let move=model.moves[index],op=move?.op,stage=move?.stage,toolChange=false,pause=null;
  if(paused){pause=[...model.pauses].reverse().find(p=>p.start<=read&&read<=p.end+4)||null;if(pause){stage=pause.stage;op=model.ops.find(o=>o.stage===stage&&o.start>=pause.start)||op;toolChange=true;}}
  const range=(start,end)=>{const a=clamp(upper(model.offsets,start-1),0,model.moves.length),b=clamp(upper(model.offsets,end-1),0,model.moves.length);return [clock.times[a]||0,clock.times[b]??clock.total];};
  const progress=item=>{if(!item)return null;const [a,b]=range(item.start,item.end);return b>a?clamp((doneTime-a)/(b-a),0,1):null;};
  const next=stage?model.stages.find(s=>s.number>stage.number&&JSON.stringify(s.tool)!==JSON.stringify(stage.tool)):null;
  const nextTime=next?range(next.start,next.end)[0]:null,remaining=Math.max(0,clock.total-doneTime),toNext=nextTime===null?null:Math.max(0,nextTime-doneTime);
  return {stage,op,next,toolChange,pause,rpmChange:pause?.rpmChange||null,move,index,read,readIndex,readTime,doneTime,buffer,remaining,toNext,stageProgress:progress(stage),operationProgress:progress(op),progress:clock.total?clamp(doneTime/clock.total,0,1):0,finish:now+remaining*1000,nextAt:toNext===null?null:now+toNext*1000,paused,factor,approximate:true};
 }
 function recoveryStart(model,clock,status,options={}){
  const c=context(model,clock,status),margin=finite(options.margin)?Math.max(1,options.margin):1.5,minimum=finite(options.minimum)?Math.max(0,options.minimum):5;
  const overlap=Math.max(minimum,c.buffer*margin),targetTime=Math.max(0,c.doneTime-overlap);
  let cutIndex=clamp(upper(clock.times,targetTime)-1,0,model.moves.length-1);
  while(cutIndex>0&&model.moves[cutIndex]?.kind!=='CUT')cutIndex--;
  const cut=model.moves[cutIndex],operation=cut?.op||c.op;let startIndex=cutIndex,boundary='cut';
  for(let i=cutIndex-1;i>=0;i--){const move=model.moves[i];if(operation&&move.op!==operation)break;if(move.kind==='PLUNGE'){startIndex=i;boundary='plunge';break;}if(['RETRACT_Z','TRAVEL_XY'].includes(move.kind))break;}
  if(boundary!=='plunge'&&operation){const first=clamp(upper(model.offsets,operation.start-1),0,model.moves.length-1);startIndex=first;boundary='operation';}
  return {context:c,overlap,targetTime,cutIndex,startIndex,start:model.moves[startIndex]?.start??operation?.start??0,boundary,operation,move:model.moves[startIndex]};
 }
 function runBytes(data,percent){
  if(!finite(percent)||percent<1||percent>300)throw Error('Choose a starting run speed from1to300%.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(data);if(!/^; CNC_ROLLUP_VERSION: 1\r?$/m.test(text))throw Error('Starting-speed selection requires a prepared Pendant program.');
  if(text.split(/\r?\n/).some(line=>/^M220\b/.test(line)&&!/^M220\s+S[\d.]+\s*$/.test(line)))throw Error('An unsupported programmed override requires separate review.');
  let count=0;const output=text.replace(/^M220[ \t]+S([\d.]+)[ \t]*(?=\r?$)/gm,(line,value)=>{let replacement;if(count++>0){if(Number(value)!==100)throw Error('A later programmed override requires separate review.');replacement='; reset';}else replacement='M220 S'+percent;return replacement.padEnd(line.length,' ');});
  if(!count)throw Error('Prepared startup override is missing.');return new TextEncoder().encode(output);
 }
 function speedValues(s,minute=false,distance='mm'){const length=distance==='in'?25.4:distance==='cm'?10:1,factor=(minute?60:1)/length,unit=' '+distance+(minute?'/min':'/s');const ready=s?.webhooks?.state==='ready',g=s?.gcode_move||{},valid=x=>ready&&finite(x);return {programmed:valid(g.speed)?(g.speed*factor/60).toFixed(distance==='in'?3:distance==='cm'?2:1)+unit:'—',override:valid(g.speed_factor)?Math.round(g.speed_factor*100)+'%':'—',adjusted:valid(g.speed)&&valid(g.speed_factor)?(g.speed*g.speed_factor*factor/60).toFixed(distance==='in'?3:distance==='cm'?2:1)+unit:'—',live:valid(s?.motion_report?.live_velocity)?(s.motion_report.live_velocity*factor).toFixed(distance==='in'?3:distance==='cm'?2:1)+unit:'—'};}
 function updateWait(previous,{filename='',active=false,paused=false,toolChange=false,now=Date.now()}={}){const prior=previous&&previous.filename===filename?previous:{filename,at:now,seconds:0};const delta=active&&prior.at&&now>=prior.at?(now-prior.at)/1000:0;return {filename,at:now,seconds:prior.seconds+(paused&&toolChange?delta:0)};}
 const modelApi={build,timing,context,recoveryStart,runBytes,duration,speedValues,jobIdentity,updateWait};if(typeof module!=='undefined'&&module.exports){module.exports=modelApi;return;}
 const ui=window.PendantUI;if(!ui)return;const $=s=>document.querySelector(s),el=ui.el,write=(id,value)=>{const n=$(id);if(n&&n.textContent!==value)n.textContent=value;};
 let pausedZero=null,pausedZeroFile='';
 const zOffset=s=>{const a=s?.gcode_move?.position?.[2],b=s?.gcode_move?.gcode_position?.[2];return finite(a)&&finite(b)?a-b:null;};
 let model=null,clock=null,filename='',fileHash='',loading='',error='',lastStatus=null,signature='',pausedAt=0,completion=null,completionDialog=false,completionLoaded=false,loadedAt=0,retryAfter=0,lastRecoverySave=0,recoverySaving=false,clearedRecovery='',waitState=null;
 function shortTool(tool){return tool?'T'+tool.number+' · '+(finite(tool.geometry?.DC)?window.CncSettings.length().format(tool.geometry.DC)+' '+window.CncSettings.get('units')+' ':'')+(String(tool.description||tool.type||'Tool').replace(/^CHECK BEFORE USE\s*-\s*T\d+\s*-\s*/i,'')):'Tool not identified';}
 const percent=p=>finite(p)?Math.min(99,Math.floor(p*100))+'%':'—';const at=t=>new Date(t).toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}).replaceAll(' ','\u00a0');
 async function load(name){
  // A failed early read must not permanently poison this filename. On a fresh
  // page the first controller status can arrive before optional helpers finish
  // loading; retry until a complete model exists.
  if((name===filename&&model)||name===loading||Date.now()<retryAfter)return;loading=name;error='';window.CncRunUI.current=null;try{const r=await fetch('/server/files/gcodes/'+name.split('/').map(encodeURIComponent).join('/'),{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Cannot read run metadata');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>64*1024*1024)throw Error('Program too large for live estimates');const built=build(bytes),hash=window.CncProjects?.model?.sha256?.(bytes);if(!hash)throw Error('Run checksum support unavailable; retrying.');try{const cfg=(await ui.api('/printer/objects/query?configfile')).status?.configfile?.config?.printer;window.CncRunLimits={maxZ:Number(cfg?.max_z_velocity)};}catch(_){}if(loading!==name)return;model=built;fileHash=hash;filename=name;signature='';retryAfter=0;loadedAt=Date.now();}catch(e){if(loading!==name)return;error=e.message;filename=name;fileHash='';model=null;retryAfter=Date.now()+2000;}finally{if(loading===name)loading='';}}
 function cells(bar){
  let grid=$('#pendant-speed-cells');if(grid)return grid;grid=el('div');grid.id='pendant-speed-cells';for(const [key,label] of [['programmed','Programmed'],['override','Run speed'],['adjusted','Adjusted'],['live','Live']]){const cell=el('div');cell.append(el('small',label));const value=el('strong','—');value.dataset.speed=key;cell.append(value);grid.append(cell);}bar.append(grid);return grid;
 }
 function updateSpeeds(s,bar){
  const grid=cells(bar),ready=s?.webhooks?.state==='ready',valid=x=>ready&&finite(x),values=speedValues(s,window.CncSettings?.get('velocityTime')==='min',window.CncSettings?.get('units')||'mm');
  for(const [key,value] of Object.entries(values)){const n=$('[data-speed='+key+']');if(n&&n.textContent!==value)n.textContent=value;}
  const live=$('#pendant-motion-speed');if(live)live.hidden=true;let details=$('#pendant-running-details');if(!details){details=el('details');details.id='pendant-running-details';details.append(el('summary','Details / motion limits'));const limits=el('p');limits.id='pendant-motion-limits';details.append(limits);$('#pendant-running-job')?.append(details);}
  const disclosure=$('#pendant-running-details');for(const key of ['programmed','adjusted']){const cell=$('[data-speed='+key+']')?.parentElement;if(cell&&cell.parentElement!==disclosure)disclosure.append(cell);}const buffer=$('#pendant-running-buffer');if(buffer&&buffer.parentElement!==disclosure)disclosure.append(buffer);const jogBuffer=$('#pendant-jog-buffer');if(jogBuffer)jogBuffer.hidden=true;const v=window.CncSettings.velocity();const f=k=>valid(s?.toolhead?.[k])?s.toolhead[k]:'—',speed=k=>valid(s?.toolhead?.[k])?v.fromSecond(s.toolhead[k]):'—';write('#pendant-motion-limits','Speed '+speed('max_velocity')+' '+v.unit+' · Accel '+(valid(s?.toolhead?.max_accel)?window.CncSettings.length().format(s.toolhead.max_accel):'—')+' '+window.CncSettings.get('units')+'/s² (≈ '+(valid(s?.toolhead?.max_accel)?(s.toolhead.max_accel/9806.65).toFixed(3):'—')+' G) · Corner '+speed('square_corner_velocity')+' '+v.unit+' · Cruise '+f('minimum_cruise_ratio')+'\n'+(s?.print_stats?.filename||'')+'\nMotion and operation estimates use file position minus estimated scheduled time; not encoder feedback. Unknown initial moves, manual tool-change time and exact Klipper planner behavior are not predicted. Travel currently shares the run override.');
 }
 function mount(){
  const job=$('#pendant-running-job');if(!job)return;const head=$('#pendant-job-title');head.classList.add('cnc-run-heading');
  if(!$('#pendant-run-context')){const box=el('div');box.id='pendant-run-context';for(const id of ['operation','stage','next','eta']){const line=el('div');line.id='pendant-context-'+id;box.append(line);}$('#pendant-job-motion-summary').before(box);}
  if(!$('#pendant-running-buffer')){const box=el('div');box.id='pendant-running-buffer';job.append(box);}
  if(!$('#pendant-jog-buffer')&&$('#lowrider-jog-pad')){const box=el('div');box.id='pendant-jog-buffer';$('#lowrider-jog-pad').append(box);}
  const summary=$('#pendant-job-motion-summary');if(summary&&!$('#pendant-job-timing')){const timingBox=el('div');timingBox.id='pendant-job-timing';timingBox.append(el('strong','0s'));timingBox.firstChild.id='pendant-job-countup';timingBox.append(el('small','(tool-change wait 0s)'));timingBox.lastChild.id='pendant-job-wait';summary.append(timingBox);}
 }
 function paintBuffer(id,value,ready){const n=$(id);if(!n)return;n.textContent=ready?'Buffer queue: ~'+value.toFixed(1)+' s':'Buffer unavailable';n.title='Estimated scheduled motion ahead, not an exact pause delay or MCU move count.';}
 function ackCompletion(){if(completion){try{localStorage.setItem('cnc-completion:'+completion.key,'done');}catch(_){}}completion=null;completionDialog=false;const app=$('#app');if(app)app.dataset.jobMode='setup';if(lastStatus)paint(lastStatus);}
 function showCompletion(){if(!completion||completionDialog||document.querySelector('dialog:modal'))return;completionDialog=true;const m=ui.modal('Job complete');m.dialog.querySelector('.dialog-actions button').textContent='Done';m.insert(el('p',completion.name));m.insert(el('p','Turn the router OFF if it was used.'));const statistics=el('p','Elapsed: '+duration(completion.elapsed));m.insert(statistics);ui.reviewTabs(m,[statistics],'Completed');m.dialog.addEventListener('close',ackCompletion);}
 function captureRecovery(s,force=false){
  const active=!!s?.pause_resume?.is_paused||s?.print_stats?.state==='printing'||!!s?.virtual_sdcard?.is_active,liveFilename=s?.print_stats?.filename||filename;if(!active||!liveFilename)return null;
  const complete=model&&clock&&fileHash&&liveFilename===filename,plan=complete?recoveryStart(model,clock,s):null,machine=s?.gcode_move?.position||[],work=s?.gcode_move?.gcode_position||[],origin=machine.map((value,i)=>finite(value)&&finite(work[i])?value-work[i]:null),buffer=Math.max(0,(s?.toolhead?.print_time||0)-(s?.toolhead?.estimated_print_time||0)),record={schema:1,state:'active',saved_at:new Date().toISOString(),filename:liveFilename,sha256:complete?fileHash:null,size:complete?model.size:null,identity:complete?jobIdentity(model,filename):liveFilename,file_position:plan?.context.read??(Number(s?.virtual_sdcard?.file_position)||0),estimated_executed_seconds:plan?.context.doneTime??null,buffer_seconds:plan?.context.buffer??buffer,rewind_seconds:plan?.overlap??Math.max(5,buffer*1.5),recovery_offset:plan?.start??null,recovery_boundary:plan?.boundary||'pending file verification',operation:plan?.operation?.name||'',stage:plan?.context.stage?.number||null,tool:plan?.context.stage?.tool||null,machine_position:machine,work_position:work,work_origin_machine:origin,feed_override:s?.gcode_move?.speed_factor||1};
  try{localStorage.setItem('cnc-interruption-record',JSON.stringify(record));}catch(_){}const now=Date.now();if((force||now-lastRecoverySave>=1500)&&!recoverySaving){lastRecoverySave=now;recoverySaving=true;ui.api('/server/database/item','POST',{namespace:'cnc_pendant',key:'interruption_record',value:record}).catch(()=>{}).finally(()=>{recoverySaving=false;});}return record;
 }
 function paint(s){
  lastStatus=s;mount();const job=$('#pendant-running-job');if(!job)return;const ps=s?.print_stats||{},ready=s?.webhooks?.state==='ready',paused=!!s?.pause_resume?.is_paused,active=paused||ps.state==='printing'||!!s?.virtual_sdcard?.is_active,name=ps.filename||'';
  if(name&&(active||ps.state==='complete'))load(name);
  if(active)write('#pendant-job-countup',duration(Number(ps.total_duration)||0));
  if(paused&&!pausedAt){pausedAt=Date.now();pausedZero=zOffset(s);pausedZeroFile=name;}if(!paused){pausedAt=0;pausedZero=null;pausedZeroFile='';}
  const queued=ready?Math.max(0,(s?.toolhead?.print_time||0)-(s?.toolhead?.estimated_print_time||0)):0;paintBuffer('#pendant-running-buffer',queued,ready);paintBuffer('#pendant-jog-buffer',queued,ready);
  const currentModel=name===filename?model:null;const basic=jobIdentity(currentModel,name);
  if(active){completion=null;completionLoaded=false;write('#pendant-job-file',basic);$('#pendant-job-file').title=name;}
  window.CncRunUI.current=null;
  if(currentModel&&!currentModel.unsupported&&ready){
   const settings={factor:s.gcode_move?.speed_factor||1,velocity:s.toolhead?.max_velocity,accel:s.toolhead?.max_accel,corner:s.toolhead?.square_corner_velocity,zVelocity:window.CncRunLimits?.maxZ},sig=JSON.stringify(settings);if(sig!==signature){clock=timing(model,settings);signature=sig;}
   const c=context(model,clock,s);window.CncRunUI.current=c;if(active)captureRecovery(s);
   if(active){if(!waitState||waitState.filename!==name){try{waitState=JSON.parse(sessionStorage.getItem('cnc-tool-wait:'+name));}catch(_){waitState=null;}}waitState=updateWait(waitState,{filename:name,active,paused,toolChange:c.toolChange,now:Date.now()});try{sessionStorage.setItem('cnc-tool-wait:'+name,JSON.stringify(waitState));}catch(_){}write('#pendant-context-operation','Est. operation: '+(c.op?.name||'Preparing tool')+' · '+percent(c.operationProgress));write('#pendant-context-stage','Stage '+(c.stage?.number||'?')+'/'+model.stages.length+' · '+shortTool(c.stage?.tool)+' · '+percent(c.stageProgress));write('#pendant-context-next',c.next?'Next: '+shortTool(c.next.tool)+(paused?'':' · ~'+at(c.nextAt)):'No further tool change');write('#pendant-context-eta',window.CncPreflight?.isReturning()?'Returning to saved position…':paused?'Paused · completion estimate updates on Resume':'Est. job completion ~'+at(c.finish)+' · '+duration(c.remaining)+' remaining (plus manual stops)');write('#pendant-job-percent',percent(c.progress));$('#pendant-job-progress').value=Math.min(.99,c.progress);const elapsed=Number(ps.total_duration)||0;write('#pendant-job-countup',duration(elapsed));write('#pendant-job-wait','(tool-change wait '+duration(waitState.seconds)+')');write('#pendant-job-elapsed','');write('#pendant-job-remaining','');}
   if(paused){const rpm=c.rpmChange,change=rpm?'SPINDLE SPEED CHANGE REQUIRED\n'+(rpm.from?rpm.from+' → ':'Set ')+rpm.to+' RPM · Router OFF while adjusting\n':'';const text=change+(c.toolChange?'TOOL CHANGE':'JOB PAUSED')+' · '+shortTool(c.stage?.tool)+'\n'+(c.op?.name||'Operation unavailable').slice(0,64)+'\nPaused '+duration((Date.now()-pausedAt)/1000)+' · Set tool Z if changed';write('#pendant-paused-note',text);$('#pendant-paused-note')?.classList.toggle('cnc-rpm-change-banner',!!rpm);const stageTitle=$('#pendant-stage-filename');if(stageTitle){stageTitle.textContent=basic;stageTitle.title=name;}}
  }else if(active){write('#pendant-context-operation',loading?'Reading operation metadata…':error||'Operation/time estimate unavailable');write('#pendant-context-stage','');write('#pendant-context-next','');write('#pendant-context-eta','');write('#pendant-job-percent',Math.min(99,Math.floor((s.virtual_sdcard?.progress||0)*100))+'%');}
  if((!loading||filename===name&&model)&&ps.state==='complete'&&!s?.virtual_sdcard?.is_active&&!paused&&ready&&queued<=.05&&name&&!completionLoaded){
   if(clearedRecovery!==name){clearedRecovery=name;const record={schema:1,state:'complete',filename:name,completed_at:new Date().toISOString()};try{localStorage.setItem('cnc-interruption-record',JSON.stringify(record));}catch(_){}ui.api('/server/database/item','POST',{namespace:'cnc_pendant',key:'interruption_record',value:record}).catch(()=>{clearedRecovery='';});}
   completionLoaded=true;const key=name+':'+ps.total_duration;let acknowledged=false;try{acknowledged=localStorage.getItem('cnc-completion:'+key)==='done';}catch(_){}if(!acknowledged)completion={key,name:basic,elapsed:Number(ps.total_duration)||0};
  }
  if(completion){$('#app').dataset.jobMode='complete';write('#pendant-job-title','JOB COMPLETE');write('#pendant-job-percent','100%');$('#pendant-job-progress').value=1;write('#pendant-job-file',completion.name);write('#pendant-job-elapsed','Elapsed: '+duration(completion.elapsed));write('#pendant-job-remaining','Completed — acknowledge Done');$('#pendant-running-pause').hidden=true;const staged=$('#pendant-stage-card');if(staged)staged.hidden=true;setTimeout(showCompletion,0);}else $('#pendant-running-pause').hidden=false;
  document.title=active?(paused?'Paused':'Running')+' · '+basic+' · CNC Pendant':'CNC Pendant';ui.queueFit();
 }
 function confirmInfo(){const c=window.CncRunUI.current;if(!c||!lastStatus?.pause_resume?.is_paused||lastStatus?.webhooks?.state!=='ready'||lastStatus?.print_stats?.filename!==filename||loading)return null;return {tool:shortTool(c.stage?.tool),operation:c.op?.name||'Operation unavailable',rpm:c.rpmChange?.to??c.op?.meta?.rpm??c.stage?.rpm,rpmChange:c.rpmChange,pauseSeconds:pausedAt?(Date.now()-pausedAt)/1000:0,identity:jobIdentity(model,filename),toolChange:c.toolChange,toolZeroChanged:pausedZeroFile===filename&&pausedZero!==null&&zOffset(lastStatus)!==null?Math.abs(zOffset(lastStatus)-pausedZero)>.001:null};}
 window.CncRunUI={...modelApi,updateSpeeds,confirmInfo,captureRecovery,completionPending:()=>!!completion,current:null};document.addEventListener('cnc-pendant-status',e=>paint(e.detail));new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});
})();
