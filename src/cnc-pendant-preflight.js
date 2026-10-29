/* Shared staged-job UI; all Start/Resume authorization occurs on the Pi. */
(() => {
 'use strict';
 const endpoint='/machine/cnc_preflight/';let state={state:'empty'},latest=null,busy=false,polling=false,dialogSequence=0,resumePending=false,resumeDialogOpen=false,failedOperation='',pauseCheckPending=false,pauseCheckError=false;
 const $=s=>document.querySelector(s),ui=()=>window.PendantUI;
 const el=(tag,text,cls)=>ui().el(tag,text,cls);
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 async function api(name,method='GET',body){return ui().api(endpoint+name,method,body);}
 const identities=new Map();
 function fileIdentity(path,comments=[]){
  const fields={},setups=[];let documentName='';
  for(const raw of comments){const line=raw.trim().replace(/^;\s*/,''),m=line.match(/^(CNC_PROJECT_NAME|CNC_POSTING_MEMO|CNC_FUSION_SETUP|CNC_PROJECT_STAGE|CNC_BATCH_V1):\s*(.*)$/);if(!m)continue;
   if(m[1]==='CNC_BATCH_V1'){try{const b=JSON.parse(m[2]);documentName=documentName||b.document||'';if(b.setup)setups.push(b.setup);fields.CNC_POSTING_MEMO=fields.CNC_POSTING_MEMO||b.memo||'';}catch(_){} }
   else if(m[1]==='CNC_PROJECT_STAGE')setups.push(m[2].replace(/^\d+\/\d+\s*/,''));else if(m[1]==='CNC_FUSION_SETUP')setups.push(m[2]);else fields[m[1]]=m[2];
  }
  const basic=(path||'').split('/').pop().replace(/\.(gcode|gco|gc|nc|ngc|tap)$/i,'').split('__')[0].replaceAll('_',' ');
  const optimized=/^cnc_optimized\//i.test(path)||comments.some(x=>/CNC_OPTIMIZED:/.test(x));
  return [documentName||fields.CNC_PROJECT_NAME||basic||'CNC program',...new Set(setups.filter(Boolean)),fields.CNC_POSTING_MEMO||'',optimized?'Optimized':''].filter(Boolean).join(' · ');
 }
 function displayIdentity(path){return identities.get(path)?.label||fileIdentity(path);}
 async function readIdentity(path){
  if(!path)return;const key=state.filename===path?state.report?.sha256||'':'';const cached=identities.get(path);if(cached&&cached.key===key)return;
  const record={key,label:fileIdentity(path)};identities.set(path,record);
  try{const info=await api('inspect?filename='+encodeURIComponent(path));if(identities.get(path)!==record)return;record.label=fileIdentity(path,info.header_comments||[]);if(state.filename===path)render();}catch(_){}
 }
 function isRerun(){return latest?.print_stats?.state==='complete'&&!!state.filename&&state.filename===latest.print_stats.filename;}
 function isReturning(){return resumePending||state.operation?.state==='returning';}
 function canResume(){return latest?.webhooks?.state==='ready'&&latest?.toolhead?.homed_axes==='xyz'&&!busy&&!isReturning()&&!resumeDialogOpen&&!pauseCheckPending&&!!latest?.pause_resume?.is_paused&&state.active_filename===state.filename&&state.state==='analyzed'&&!!state.verification?.approved;}
 function render(){
  const card=$('#pendant-stage-card');if(!card)return;
  const paused=!!latest?.pause_resume?.is_paused,running=!paused&&latest?.print_stats?.state==='printing';
  card.hidden=!!window.CncRunUI?.completionPending()||running||(!state.filename&&!paused);card.dataset.result=state.state==='scanning'?'pending':state.verification?.approved?'pass':'blocked';
  const filename=$('#pendant-stage-filename');text(filename,displayIdentity(state.filename||latest?.print_stats?.filename||''));filename.title=state.filename||'';readIdentity(state.filename);
  const missing=[...'XYZ'].filter(a=>!latest?.toolhead?.homed_axes?.includes(a.toLowerCase()));
  const message=pauseCheckError?'Verification unavailable':pauseCheckPending?'Re-verifying paused job…':isReturning()?'Returning to saved position…':state.state==='scanning'?`Scanning ${Math.round((state.progress||0)*100)}%`:missing.length?'Not homed: '+missing.join(', '):state.verification?.approved?(paused?'Travel verified':'Ready to start'):(state.verification?.keepout_violations?.length?'Keep-out conflict: '+state.verification.keepout_violations.map(v=>v.name).join(', '):state.verification?.reason||'Verification required');
  text($('#pendant-stage-result'),message);
  const keepout=$('[data-pendant-dialog=keepouts]');if(keepout){const conflict=!!state.verification?.keepout_violations?.length;keepout.classList.toggle('cnc-keepout-conflict',conflict);keepout.title=conflict?state.verification.keepout_violations.map(v=>v.message).join('\n'):'Enabled keep-out areas protect pendant moves and participate in job verification.';}

  const progress=$('#pendant-scan-progress');progress.hidden=state.state!=='scanning';progress.value=state.progress||0;
  const action=$('#pendant-quadrant-resume'),needsStage=paused&&!state.filename;
  action.disabled=latest?.webhooks?.state!=='ready'||!!missing.length||busy||running||isReturning()||(!needsStage&&(paused?!canResume():state.state!=='analyzed'||!state.verification?.approved));
  text(action,pauseCheckError?'Retry verification':pauseCheckPending?'Re-verifying…':isReturning()?'Returning…':state.state==='scanning'?'Verifying…':paused?(needsStage?'Verify paused file…':'Resume job…'):isRerun()?'Re-run job…':'Start job…');
  if(pauseCheckError)action.disabled=busy||latest?.webhooks?.state!=='ready';
  if(state.state==='analyzed'&&state.verification?.approved===false&&!pauseCheckError&&!pauseCheckPending&&!running&&!needsStage&&!busy&&!isReturning()){action.disabled=false;text(action,"What’s wrong?");}
  const homing=$('#pendant-homing-needed');if(!card.hidden&&homing)homing.hidden=true;
  const old=$('#lowrider-pause-resume');if(paused&&old)old.disabled=!canResume();
  ui().queueFit();
 }
 function mount(){
  const body=$('.panel-body'),zone=$('#pendant-jog-zone'),pad=$('#lowrider-jog-pad');if(!body||!zone||!pad||$('#pendant-stage-card'))return;
  const card=el('section');card.id='pendant-stage-card';card.hidden=true;card.setAttribute('aria-label','Staged CNC job');
  const filename=el('strong');filename.id='pendant-stage-filename';const result=el('div');result.id='pendant-stage-result';result.setAttribute('role','status');const progress=el('progress');progress.id='pendant-scan-progress';progress.max=1;
  const action=el('button','Start job…');action.id='pendant-quadrant-resume';action.addEventListener('click',()=>pauseCheckError?refresh():state.state==='analyzed'&&!state.verification?.approved?problemDialog():latest?.pause_resume?.is_paused?resume():startJob());
  const controls=el('div',undefined,'preflight-actions'),details=el('button','Details');details.addEventListener('click',detailsDialog);controls.append(details);card.append(filename,result,progress,action,controls);pad.append(card);render();
 }
 async function clearLoadedFile(){if(busy||isReturning())return false;busy=true;render();try{state=await api('clear','POST',{});return true;}catch(error){const m=ui().modal('Cannot clear loaded file');m.insert(el('p',error.message));return false;}finally{busy=false;await refresh();}}
 async function refresh(){if(polling)return state;polling=true;const requestedPaused=!!latest?.pause_resume?.is_paused;try{const next=await api('status');if(requestedPaused!==!!latest?.pause_resume?.is_paused){setTimeout(refresh,0);return state;}state=next;pauseCheckError=false;if(requestedPaused&&next.paused!==false)pauseCheckPending=false;if(state.operation?.state==='complete'||state.operation?.state==='failed')resumePending=false;if(state.operation?.state==='failed'&&state.operation.id!==failedOperation){failedOperation=state.operation.id;const m=ui().modal('Resume stopped — check controller');m.insert(el('p',state.operation.message));}}catch(error){if(requestedPaused){pauseCheckPending=false;pauseCheckError=true;}state={...state,state:'unavailable',verification:{approved:false,reason:'Verification service unavailable: '+error.message}};}finally{polling=false;render();}return state;}
 async function stage(filename,reuse_stage_id=undefined){busy=true;render();try{state=await api('stage','POST',{filename,reuse_stage_id});}finally{busy=false;render();}await refresh();}
 const lengthDisplay=()=>globalThis.window?.CncSettings?.length?.()||{unit:'mm',factor:1,fromMm:n=>n,format:(n,d=3)=>Number(n.toFixed(d)).toString()};
 function verificationText(value){
  if(!value)return 'Verification has not completed.';
  const lines=[value.reason||'',...(value.violations||[]).map(v=>v.message),...(value.return_violations||[]).map(v=>v.message),...(value.keepout_violations||[]).map(v=>v.message)];
  if(value.work_min){const u=lengthDisplay();for(let i=0;i<3;i++)lines.push(`${'XYZ'[i]} work ${u.format(value.work_min[i])} to ${u.format(value.work_max[i])} ${u.unit} · machine ${u.format(value.machine_min[i])} to ${u.format(value.machine_max[i])} ${u.unit}`);}
  if(value.label)lines.push('Tool section: '+value.label);if(value.scope)lines.push(value.scope);
  if(value.issues)for(const issue of value.issues.slice(0,8))lines.push(`Line ${issue.line}: ${issue.message}`);
  return lines.filter(Boolean).join('\n');
 }
 function placementExplanation(value,status,paused=false){
  const units=globalThis.window?.CncSettings?.length?.()||{unit:'mm',factor:1},f=n=>(n/units.factor).toFixed(units.unit==='in'?4:2),lines=[];if(!value?.machine_min||!value?.machine_max||!['x','y','z'].every(axis=>status?.toolhead?.homed_axes?.includes(axis)))return lines;
  const low=status?.toolhead?.axis_minimum,high=status?.toolhead?.axis_maximum;
  for(let i=0;i<3;i++){
   const a=value.machine_min[i],b=value.machine_max[i];if(![a,b,low?.[i],high?.[i]].every(Number.isFinite))continue;
   const under=Math.max(0,low[i]-a),over=Math.max(0,b-high[i]);if(under<=.00001&&over<=.00001)continue;
   const axis='XYZ'[i],span=b-a,available=high[i]-low[i],minShift=low[i]-a,maxShift=high[i]-b;
   if(under>.00001)lines.push(axis+' travel exceeds '+axis+' minimum by '+f(under)+' '+units.unit+'.');if(over>.00001)lines.push(axis+' travel exceeds '+axis+' maximum by '+f(over)+' '+units.unit+'.');
   const wa=value.work_min?.[i],wb=value.work_max?.[i];if([wa,wb].every(Number.isFinite)){const offset=a-wa;lines.push('Required work '+axis+': '+f(wa)+' to '+f(wb)+' '+units.unit+'. Available work '+axis+' with current zero: '+f(low[i]-offset)+' to '+f(high[i]-offset)+' '+units.unit+'.');}
   if(minShift>maxShift+.00001){lines.push('An offset cannot make '+axis+' fit: job span '+f(span)+' '+units.unit+' exceeds available travel '+f(available)+' '+units.unit+'. Change the setup/toolpath.');continue;}
   const shift=Math.max(minShift,Math.min(0,maxShift));
   lines.push('Travel space is sufficient: the program placement would need at least '+(shift>=0?'+':'')+f(shift)+' '+units.unit+' along '+axis+'.');
   if(paused&&i<2)lines.push('Do not shift X/Y while paused. Restore the original job origin; do not relocate a partly machined job.');
   else if(i===2)lines.push('Check actual stock-top/tool Z and available physical clearance. Do not change tool zero merely to make this check pass.');
   else lines.push('Reposition the work/setup and establish the correct work zero, then verify again.');
  }
  return lines;
 }
 async function problemDialog(){
  await refresh();const m=ui().modal('What’s wrong?');m.dialog.querySelector('.dialog-actions button').textContent='Back to jog';
  const lines=placementExplanation(state.verification,latest,!!latest?.pause_resume?.is_paused);
  if(!lines.length)m.insert(el('p',state.verification?.approved?'The current setup now passes verification. Close and review Start again.':state.verification?.reason||'Verification is required.'));
  for(const line of lines)m.insert(el('p',line));
  for(const v of [...(state.verification?.return_violations||[]),...(state.verification?.keepout_violations||[])])m.insert(el('p',v.message));
  const details=el('details');details.append(el('summary','Details / machine coordinates'),el('pre',verificationText(state.verification),'preflight-details'));m.insert(details);
  const scope=el('p','This describes the checked tool section only. No offsets are changed here. Travel fit does not prove clearance from stock, clamps or keep-outs.');m.insert(scope);
  m.add('Verify again',async()=>{const r=await api('verify','POST',{});state.verification=r;m.dialog.close();await problemDialog();});ui().reviewTabs(m,[details,scope],'Problem');
 }
 async function detailsDialog(){
  const m=ui().modal('Job checks'),identity=el('p',displayIdentity(state.filename)),summary=el('p'),info=el('pre',undefined,'preflight-details');m.dialog.querySelector('.dialog-actions button').textContent='Back';m.insert(identity);m.insert(summary);m.insert(info);const technical=el('p',state.filename||'No file selected');m.insert(technical);const scope=el('p','Travel checks cover the checked tool section and return path, not actual stock, clamps or cutter clearance.');m.insert(scope);
  const show=()=>{identity.textContent=displayIdentity(state.filename);summary.textContent=state.state==='scanning'?'Re-verifying…':state.verification?.approved?'No travel-check problems found.':state.verification?.reason||'Verification required';info.textContent=[verificationText(state.verification),state.report?'Scanned '+state.report.moves.toLocaleString()+' moves in '+state.report.scan_seconds+'s\nSHA-256: '+state.report.sha256:''].filter(Boolean).join('\n\n');};show();m.add('Verify again',async()=>{const result=await api('verify','POST',{});state.verification=result;show();render();});ui().reviewTabs(m,[info,technical,scope],'Status');const timer=setInterval(show,1000);m.dialog.addEventListener('close',()=>clearInterval(timer));await refresh();show();
 }
 async function ensurePausedFile(){
  const status=(await ui().api('/printer/objects/query?pause_resume&print_stats')).status;
  if(!status.pause_resume?.is_paused)throw Error('No paused job.');const filename=status.print_stats?.filename;if(!filename)throw Error('No active file is available.');
  if(state.filename!==filename||state.state==='empty'||state.state==='error'||state.state==='unavailable')await stage(filename);else await refresh();
 }
 async function afterZero(){
  busy=true;render();try{await ensurePausedFile();const result=await api('verify','POST',{});state.verification=result;if(result.approved)return;const outOfBounds=placementExplanation(result,latest,true).length>0;const m=ui().modal(outOfBounds?'Job cannot proceed: tool offset out of bounds.':'Job cannot proceed: check tool Z');m.dialog.querySelector('.dialog-actions button').textContent='Back to jog / set tool Z';const lines=placementExplanation(result,latest,true);if(!lines.length)m.insert(el('p',result.reason||'Tool Z travel verification did not pass.'));for(const line of lines)m.insert(el('p',line));for(const v of [...(result.return_violations||[]),...(result.keepout_violations||[])])m.insert(el('p',v.message));if(state.state==='scanning')m.insert(el('p','File analysis is still running. Return to the jog screen and wait for verification.'));m.add('Verify again',async()=>{m.dialog.close();await afterZero();});}catch(error){const m=ui().modal('Tool Z needs attention');m.dialog.querySelector('.dialog-actions button').textContent='Back to jog / set tool Z';m.insert(el('p',error.message));}finally{busy=false;await refresh();}
 }
 async function resume(){
  if(busy||isReturning()||resumeDialogOpen)return;busy=true;render();try{await ensurePausedFile();const result=await api('verify','POST',{});state.verification=result;if(!result.approved){await problemDialog();return;}
   const captured=state.id,m=ui().modal('Resume job?');resumeDialogOpen=true;m.dialog.addEventListener('close',()=>{resumeDialogOpen=false;render();});m.dialog.querySelector('.dialog-actions button').textContent='Back';
   toolInfo(m);const saveRouter=window.CncChipLoad?.routerEditor?.(m);const selected=overrideInput(m,(latest?.gcode_move?.speed_factor||1)*100);
   const details=el('pre',verificationText(result),'preflight-details');m.insert(details);
   m.add('Resume',async()=>{if(!state.capabilities?.resume_run_percent)throw Error('Resume speed selection needs the updated verification service. Refresh after activation.');const requested=selected();saveRouter?.();const info=window.CncRunUI?.confirmInfo();if((!info||info.toolChange&&info.toolZeroChanged!==true)&&!await confirmUnchangedZero(info||{tool:'Tool details unavailable',toolZeroChanged:null},m)){m.dialog.close();return;}m.dialog.close();busy=true;resumePending=true;render();try{const accepted=await api('resume','POST',{stage_id:captured,run_percent:String(requested)});if(accepted.operation)state.operation=accepted.operation;document.dispatchEvent(new CustomEvent('cnc-pendant-status',{detail:latest}));}catch(error){
     await refresh();let actual;try{actual=(await ui().api('/printer/objects/query?pause_resume&print_stats&virtual_sdcard')).status;}catch(_){}
     if(actual?.print_stats?.state==='printing'&&!actual?.pause_resume?.is_paused){resumePending=false;}
     else if(state.operation?.state!=='returning'){
       // A lost response does not cancel the Pi's accepted command. Keep the
       // action locked until the controller state is known; never retry it.
       const timeout=error.name==='TimeoutError'||error.name==='AbortError'||/timed? out|timeout|fetch|network/i.test(error.message);
       if(!timeout)resumePending=false;
       const failure=ui().modal(timeout?'Resume status uncertain':'Resume blocked');failure.insert(el('p',timeout?'The connection response was lost. The machine may still be returning. Watch the machine; do not send another Resume. The pendant will check its state.':error.message));
     }
    }finally{busy=false;await refresh();}});ui().reviewTabs(m,[details],'Overview',{toggle:true});
  }catch(error){const m=ui().modal('Resume blocked');m.insert(el('p',error.message));}finally{busy=false;render();}
 }
 function confirmUnchangedZero(info,parent){return new Promise(resolve=>{const step=ui().inlineStep(parent,'Check tool Z offset');let settled=false;const finish=value=>{if(settled)return;settled=true;parent.dialog.removeEventListener('close',closed);step.finish();resolve(value);};const closed=()=>finish(false);parent.dialog.addEventListener('close',closed,{once:true});step.insert(el('p',info.toolZeroChanged===false?'Tool Z offset has not changed from the previous tool.':'Pendant cannot confirm that the tool Z offset changed from the previous tool.','cnc-attention-summary'));step.insert(el('p',info.tool));step.insert(el('p','Set the fitted tool Z, or confirm that keeping the same zero is intentional.'));step.add('Jog / set tool Z',()=>finish(false));step.add('Confirm unchanged Z and resume',()=>finish(true));});}
 function overrideInput(m,value){
  const row=el('label','Run speed (%)','dialog-field cnc-run-override'),input=el('input');input.type='number';input.min=1;input.max=300;input.step=1;input.value=Math.round(value);input.setAttribute('aria-label','Run speed (%)');row.append(input);const paint=()=>row.classList.toggle('cnc-fast',Number(input.value)>100);input.addEventListener('input',paint);paint();m.insert(row);return ()=>{const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<1||n>300)throw Error('Choose a run speed from1to300%.');return n;};
 }
 function toolInfo(m){const info=window.CncRunUI?.confirmInfo();if(!info){m.insert(el('p','Tool details unavailable — check the posted setup sheet.'));return;}m.insert(el('p',info.tool));m.insert(el('p','Operation: '+info.operation));const router=el('p',window.CncSettings?.routerSpeed?.(info.rpm)||'Router speed unavailable','cnc-router-highlight');m.insert(router);m.insert(el('p','Before Resume: tool zero set; spindle ON for cutting, OFF for an air test. Router OFF while changing tools.'));}
 async function startCopy(percent,captured,progress=()=>{}){
  progress('Reading and checking the prepared program…');
  if(!window.CncRunUI||!window.CncProjects)throw Error('Run controls unavailable. Refresh Pendant.');await refresh();if(state.id!==captured)throw Error('The selected program changed. Reopen Start.');
  const source=state.filename,expected=state.report?.sha256;if(!expected)throw Error('Wait for source analysis.');const r=await fetch('/server/files/gcodes/'+source.split('/').map(encodeURIComponent).join('/'),{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Cannot read the prepared program.');const bytes=new Uint8Array(await r.arrayBuffer());if(bytes.length>64*1024*1024||window.CncProjects.model.sha256(bytes)!==expected)throw Error('Prepared source changed. Stage and review it again.');
  if(!/^; CNC_ROLLUP_VERSION: 1\r?$/m.test(new TextDecoder().decode(bytes))){if(percent===100)return captured;throw Error('A custom starting speed requires a prepared Pendant program.');}
  progress('Applying your starting speed…');await new Promise(resolve=>setTimeout(resolve,0));
  const output=window.CncRunUI.runBytes(bytes,percent),hash=window.CncProjects.model.sha256(output),filename='run-'+Date.now()+'-'+hash.slice(0,16)+'.gcode',path='cnc_runs/'+filename,form=new FormData();form.append('root','gcodes');form.append('path','cnc_runs');form.append('file',new Blob([output]),filename);
  await refresh();if(state.id!==captured)throw Error('Selection changed during preparation.');progress('Saving and checking the run copy…');const upload=await fetch('/server/files/upload',{method:'POST',body:form});if(!upload.ok)throw Error('Cannot save the run-specific copy.');const check=await fetch('/server/files/gcodes/'+path,{cache:'no-store'});if(!check.ok||window.CncProjects.model.sha256(new Uint8Array(await check.arrayBuffer()))!==hash)throw Error('Run-copy checksum differs. Nothing started.');
  progress('Analysing the run copy — this may take a few seconds…');await stage(path,captured);const id=state.id;if(state.state==='analyzed')return id;for(let i=0;i<180;i++){await new Promise(resolve=>setTimeout(resolve,500));await refresh();if(state.id!==id)throw Error('Another client changed the selected program.');if(state.state==='error')throw Error(state.message||'Run-copy analysis failed.');if(state.state==='analyzed')return id;}throw Error('Analysis is still running. Nothing started; wait and review the staged run copy.');
 }
 async function startJob(){
  if(busy)return;busy=true;render();try{await refresh();const verified=await api('verify','POST',{});state.verification=verified;if(!verified.approved){await problemDialog();return;}
   const captured=state.id,filename=state.filename;await readIdentity(filename);await refresh();if(state.id!==captured||state.filename!==filename)throw Error('The selected program changed. Reopen Start.');const rerun=isRerun(),m=ui().modal(rerun?'Re-run completed CNC job?':'Start verified CNC job?');m.dialog.querySelector('.dialog-actions button').textContent='Cancel';m.insert(el('p',displayIdentity(filename)));const startNotes=el('p','Previous run speed: '+Math.round((latest?.gcode_move?.speed_factor||1)*100)+'%. Run speed affects cutting and travel. Start creates a verified run copy; it does not overwrite the prepared program.');m.insert(startNotes);
   const selected=overrideInput(m,100);m.insert(el('p','Check tool zero and clearance. Spindle OFF for an air test.'));
   const progress=el('p','','cnc-start-progress');progress.setAttribute('role','status');progress.setAttribute('aria-live','polite');progress.hidden=true;m.insert(progress);const showProgress=text=>{progress.hidden=false;progress.classList.add('cnc-processing');progress.textContent=text;};
   if(rerun)m.insert(el('p','This is the same program that just completed. Confirm you intend to run it again.'));const start=m.add(rerun?'Re-run job':'Start job',async()=>{if(m.dialog.hasAttribute('aria-busy'))return;busy=true;start.disabled=true;m.dialog.querySelector('input').disabled=true;showProgress('Preparing to start — no motion yet…');m.dialog.setAttribute('aria-busy','true');m.dialog.querySelector('.dialog-actions button').disabled=true;render();try{const id=await startCopy(selected(),captured,showProgress);showProgress('Checking the current machine setup…');const result=await api('verify','POST',{});state.verification=result;if(!result.approved)throw Error(result.reason||'Run-copy verification failed.');showProgress('Sending Start to the controller…');await api('start','POST',{stage_id:id});m.dialog.close();}catch(error){progress.hidden=true;m.feedback.textContent=error.message;}finally{busy=false;start.disabled=false;m.dialog.querySelector('input').disabled=false;progress.classList.remove('cnc-processing');m.dialog.removeAttribute('aria-busy');m.dialog.querySelector('.dialog-actions button').disabled=false;await refresh();}});ui().reviewTabs(m,[startNotes]);
  }catch(error){const m=ui().modal('Start blocked');m.insert(el('p',error.message));}finally{busy=false;render();}
 }
 function viewer(filename,onBack=null){const m=ui().modal('Toolpath viewer');if(onBack){m.dialog.querySelector('.dialog-actions button').textContent='Back';m.dialog.addEventListener('close',onBack,{once:true});}m.dialog.classList.add('pendant-viewer-dialog');const name=el('p',displayIdentity(filename),'pendant-viewer-filename');readIdentity(filename).then(()=>{name.textContent=displayIdentity(filename);});name.title=filename;m.insert(name);const frame=el('iframe');frame.title='Mainsail G-code toolpath viewer';frame.src='/viewer?filename='+encodeURIComponent('gcodes/'+filename);frame.className='preflight-viewer';m.insert(frame);m.insert(el('p','Visualization is not verification. Enable travel visibility for CNC paths.','pendant-viewer-note'));}
 function optimizeTravel(filename,parentDialog,onCreated=null,prepareSource=null,options={}){
  const velocity=window.CncSettings.velocity();
  const m=ui().modal(options.automatic?'Prepare program':'Optimize marked travel'),summary=el('pre','Preview before creating a copy.','preflight-details');m.insert(el('p',options.identity||displayIdentity(filename),'cnc-job-identity'));
  m.insert(el('p','Only versioned Fusion travel markers are eligible. Cutting, plunge and unproven moves keep their feeds. The original stays unchanged. Displayed rates follow Machine velocity units; run-speed override still applies.'));
  const starting={xy_feed:options.rates?.xy_feed??window.CncSettings?.get('travelXY')??3000,z_feed:options.rates?.z_feed??window.CncSettings?.get('travelZ')??180};
  m.insert(el('p',options.rates?'Using this project’s previous travel rates.':'Starting travel values; review for this machine and fixtures.'));
  const inputs={};for(const [key,label,value,max] of [['xy_feed','XY travel ('+velocity.unit+')',starting.xy_feed,30000],['z_feed','Z upward retract ('+velocity.unit+')',starting.z_feed,3000]]){
   const row=el('label',label,'dialog-field'),input=el('input');input.type='number';input.inputMode='decimal';input.min=velocity.fromMinute(1);input.max=velocity.fromMinute(max);input.step='any';input.value=velocity.fromMinute(value);input.setAttribute('aria-label',label);row.append(input);m.insert(row);inputs[key]=input;
  }
  const remember=el('input');remember.type='checkbox';const rememberLabel=el('label',' Remember these as my shared travel defaults.');rememberLabel.prepend(remember);m.insert(rememberLabel);
  m.insert(summary);let toolReview=null,reviewHash='',leavingToRun=false;let prepared=!prepareSource,recorded='',identity='',autoCreating=false,ready=false,created='',watch=null,working=false;
  const values=()=>{const v={};for(const [key,input] of Object.entries(inputs)){const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<Number(input.min)||n>Number(input.max))throw Error('Enter valid travel rates.');v[key]=String(velocity.toMinute(n));}return v;};
  const render=result=>{
   ready=result.state==='preview';if(ready&&reviewHash&&result.source_sha256!==reviewHash){ready=false;working=false;toolReview=null;reviewHash='';preview.disabled=false;for(const input of Object.values(inputs))input.disabled=false;summary.classList.remove('cnc-processing');m.dialog.querySelector('.dialog-actions button').disabled=false;m.dialog.removeAttribute('aria-busy');summary.textContent='Source changed after tool review. Preview again to review the current file.';create.disabled=true;stageCopy.disabled=true;return;}working=result.state==='working';summary.classList.toggle('cnc-processing',working);created=result.state==='created'?result.filename:'';
   m.dialog.toggleAttribute('aria-busy',working);const close=m.dialog.querySelector('.dialog-actions button');if(options.automatic)close.disabled=working;
   for(const input of Object.values(inputs))input.disabled=working;
   preview.disabled=working;create.disabled=!ready;stageCopy.disabled=!created;
   if(result.state==='working')summary.textContent='Preparing travel preview in the background…';
   else if(result.state==='error')summary.textContent=result.message;
   else summary.textContent=[result.message,`${result.changed_moves} changed moves · ${result.eligible_moves} eligible`,
     `XY ${Number(velocity.fromMinute(result.xy_feed).toFixed(3))} · Z retract ${Number(velocity.fromMinute(result.z_feed).toFixed(3))} ${velocity.unit}`,`Declared work clearance Z${lengthDisplay().format(result.clearance_mm)} ${lengthDisplay().unit}`,
     `Nominal motion: ${result.nominal_before_seconds}s → ${result.nominal_after_seconds}s at 100%`,
     'Estimate excludes pauses, acceleration, controller limits and unknown initial moves.',created?`New file: ${created}`:''].filter(Boolean).join('\n');
  };
  const poll=async()=>{if(!m.dialog.open)return;try{const r=await api('optimization');if(r.id!==identity)throw Error('Another client replaced this preview. Preview again.');render(r);if(options.automatic&&ready&&!autoCreating){autoCreating=true;await request('create');return;}if(created&&recorded!==created){stageCopy.disabled=true;const rates={xy_feed:Number(r.xy_feed),z_feed:Number(r.z_feed)};if(remember.checked){if(!window.CncSettings)throw Error('Shared settings unavailable.');await window.CncSettings.set('travelXY',rates.xy_feed);await window.CncSettings.set('travelZ',rates.z_feed);}if(onCreated)await onCreated(created,{rates,tool_review:toolReview});recorded=created;stageCopy.disabled=false;if(options.automatic){summary.textContent='Saved in Prepared programs.';m.dialog.querySelector('h3').textContent='Program prepared';const report=el('pre','XY '+Number(velocity.fromMinute(r.xy_feed).toFixed(3))+' / Z '+Number(velocity.fromMinute(r.z_feed).toFixed(3))+' '+velocity.unit+'\n'+r.changed_moves+' travel moves adjusted.\nOriginal post files preserved.\n'+created,'preflight-details');m.insert(report);ui().reviewTabs(m,[report],'Prepared');}}if(working)watch=setTimeout(poll,750);}catch(error){working=false;preview.disabled=false;stageCopy.disabled=true;m.dialog.querySelector('.dialog-actions button').disabled=false;m.dialog.removeAttribute('aria-busy');summary.classList.remove('cnc-processing');m.feedback.textContent=error.message;}};
  async function request(mode){const rates=values();ready=false;create.disabled=true;stageCopy.disabled=true;
   try{
    if(!prepared){working=true;preview.disabled=true;for(const input of Object.values(inputs))input.disabled=true;summary.classList.add('cnc-processing');summary.textContent='Processing… checking and combining source files.';await new Promise(resolve=>setTimeout(resolve,20));const built=await prepareSource(message=>summary.textContent='Processing… '+message,m);filename=typeof built==='string'?built:built.filename;toolReview=built.tool_review||null;reviewHash=built.sha256||'';prepared=true;}
    if(!toolReview){if(mode==='create')throw Error('Preview and complete tool review first.');if(!window.CncToolReview||!window.CncProjects)throw Error('Tool review unavailable. Refresh Pendant.');working=true;preview.disabled=true;summary.classList.add('cnc-processing');summary.textContent='Reading tool specifications…';const response=await fetch('/server/files/gcodes/'+filename.split('/').map(encodeURIComponent).join('/'),{cache:'no-store',signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error('Cannot read tool metadata.');const bytes=new Uint8Array(await response.arrayBuffer());if(bytes.length>64*1024*1024)throw Error('File exceeds tool-review size limit.');const model=window.CncProjects.model,meta=model.metadata(new TextDecoder('utf-8',{fatal:true}).decode(bytes).split(/\r?\n/).filter(line=>line.startsWith(';')),{path:filename,size:bytes.length});reviewHash=model.sha256(bytes);meta.sha256=reviewHash;toolReview=await window.CncToolReview.review([meta],m);}
    const r=await api('optimize','POST',{mode,filename,...rates,...(mode==='create'?{preview_id:identity}:{})});identity=r.id;render(r);clearTimeout(watch);watch=setTimeout(poll,500);
   }catch(error){working=false;preview.disabled=false;summary.classList.remove('cnc-processing');for(const input of Object.values(inputs))input.disabled=false;summary.textContent='Processing stopped. '+error.message;if(error.cancelled&&options.automatic&&options.onCancelled){leavingToRun=true;m.dialog.removeAttribute('aria-busy');m.dialog.close();options.onCancelled();return;}throw error;}
  }
  const preview=m.add('Preview',()=>request('preview')),create=m.add('Create optimized copy',async()=>{if(!ready)throw Error('Preview the current settings first.');try{await request('create');}finally{setTimeout(()=>{create.disabled=!ready;},0);}}),stageCopy=m.add('Set up to run copy',async()=>{if(!created)throw Error('Create a copy first.');await stage(created);leavingToRun=true;m.dialog.close();parentDialog?.close();});create.disabled=true;stageCopy.disabled=true;
  for(const input of Object.values(inputs))input.addEventListener('input',()=>{ready=false;created='';create.disabled=true;stageCopy.disabled=true;summary.textContent='Settings changed. Preview again.';});
  if(options.automatic){
   for(const paragraph of [...m.dialog.children].filter(e=>e.tagName==='P'&&e!==summary&&!e.classList.contains('dialog-feedback')&&!e.classList.contains('cnc-job-identity')))paragraph.hidden=true;
   summary.textContent='Preparing selected stages…';
   for(const input of Object.values(inputs))input.closest('label').hidden=true;rememberLabel.hidden=true;preview.hidden=true;create.hidden=true;stageCopy.textContent='Set up to run';m.dialog.querySelector('.dialog-actions button').textContent='Done';
   // Settings were reviewed on the batch screen; preview/create remain backend checks.
   m.dialog.querySelector('.dialog-actions button').disabled=true;
   setTimeout(()=>request('preview').catch(error=>{m.feedback.textContent=error.message;m.dialog.querySelector('.dialog-actions button').disabled=false;m.dialog.removeAttribute('aria-busy');}),0);
  }
  m.dialog.addEventListener('close',()=>{clearTimeout(watch);if(options.onClose&&!leavingToRun)options.onClose();});
 }
 function prepare(filename){
  const m=ui().modal('Set up to run');
  m.insert(el('p','Check the fitted tool and work/tool zero before verification.'));
  m.add('Set up to run',async()=>{await stage(filename);m.dialog.close();});
  m.add('Details',()=>files(filename));
  m.add('View toolpath',()=>viewer(filename));
 }
 async function files(initialFilename=''){
  const m=ui().modal('Files / stage job');const oldBack=m.dialog.querySelector('.dialog-actions button'),back=oldBack.cloneNode(true);back.textContent='Back to Files';oldBack.replaceWith(back);back.addEventListener('click',()=>{m.dialog.close();window.CncProjects?.overview();});m.dialog.classList.add('cnc-files-screen','cnc-other-files');window.CncProjects?.navigation(m,'other');m.insert(el('p','Standalone and legacy G-code. New Fusion posts: Inbox. Finished preparations: Prepared. Temporary run copies are hidden.'));const search=el('input'),list=el('select'),details=el('div',undefined,'cnc-file-details');search.placeholder='Filter files';search.setAttribute('aria-label','Filter G-code files');search.className='file-search';list.size=6;list.className='file-list cnc-file-list';list.setAttribute('aria-label','G-code files');m.insert(search);
  const sortRow=el('label','Sort: ','dialog-field'),sort=el('select');sort.setAttribute('aria-label','File sort order');for(const [value,label] of [['newest','Date · newest first'],['oldest','Date · oldest first'],['az','Name · A–Z'],['za','Name · Z–A']]){const option=el('option',label);option.value=value;sort.append(option);}try{sort.value=localStorage.getItem('cnc-file-sort')||'newest';}catch(_){}if(!sort.value)sort.value='newest';sortRow.append(sort);m.insert(sortRow);m.insert(list);m.insert(details);const sourceToggle=el('input');sourceToggle.type='checkbox';sourceToggle.checked=/^Inbox\//i.test(initialFilename);const sourceRow=el('label','Include project source posts');sourceRow.prepend(sourceToggle);m.insert(sourceRow);
  const selectedButton=el('button','Choose a file…','cnc-selected-file');selectedButton.hidden=true;m.insert(selectedButton);let uploadRowElement=null,pickerChosen=!!initialFilename;const collapse=()=>{search.hidden=true;sortRow.hidden=true;list.hidden=true;sourceRow.hidden=true;selectedButton.hidden=false;selectedButton.textContent=displayIdentity(selected);details.hidden=false;if(uploadRowElement)uploadRowElement.hidden=true;};selectedButton.addEventListener('click',()=>{search.hidden=false;sortRow.hidden=false;list.hidden=false;sourceRow.hidden=false;selectedButton.hidden=true;details.hidden=true;if(uploadRowElement)uploadRowElement.hidden=false;});
  let selected='',sequence=0,optimizer=null,thumbnailTimer=null;
  m.dialog.addEventListener('close',()=>clearTimeout(thumbnailTimer));
  async function thumbnail(filename,token,box){
   if(token!==sequence||!m.dialog.open)return;
   try{const result=await api('thumbnail?filename='+encodeURIComponent(filename));if(token!==sequence||!m.dialog.open)return;
    if(result.state==='ready'){const image=el('img');image.src=result.data_url;image.alt='Sampled XY toolpath preview, including travel';image.style.cssText='display:block;width:100%;max-height:210px;object-fit:contain;background:#171717;border-radius:4px';const button=el('button');button.style.cssText='width:100%;padding:0;border:0;background:transparent';button.title='Open full toolpath viewer';button.append(image);button.addEventListener('click',()=>viewer(filename));box.replaceChildren(button,el('small','XY toolpath preview · includes travel · tap to open viewer'));}
    else if(result.state==='error')box.textContent='Toolpath preview unavailable — use View toolpath.';
    else{box.textContent=result.message||'Generating toolpath preview in the background…';thumbnailTimer=setTimeout(()=>thumbnail(filename,token,box),2000);}
   }catch(_){if(token===sequence)box.textContent='No thumbnail available — use View toolpath.';}
  }
  async function inspect(){if(optimizer)optimizer.disabled=true;const filename=list.value;selected=filename;const token=++sequence;details.replaceChildren();if(!filename)return;details.append(el('p','Reading file details…'));try{
    const [info,metadata]=await Promise.all([api('inspect?filename='+encodeURIComponent(filename)),ui().api('/server/files/metadata?filename='+encodeURIComponent(filename)).catch(()=>({}))]);if(token!==sequence||!m.dialog.open)return;
    identities.set(filename,{key:state.filename===filename?state.report?.sha256||'':'',label:fileIdentity(filename,info.header_comments||[])});const option=[...list.options].find(o=>o.value===filename);if(option)option.textContent=displayIdentity(filename);details.replaceChildren();if(pickerChosen)collapse();const technical=el('details');technical.append(el('summary','Technical filename'),el('p',filename));details.append(technical);if(optimizer){optimizer.disabled=!info.optimizer?.compatible||!!info.optimizer?.already_optimized;optimizer.title=info.optimizer?.compatible?'Preview optional travel-feed changes':'Requires the marked CNC Pendant Fusion post';}details.append(el('div',info.optimizer?.already_optimized?'Travel-optimized copy · verify before Start':info.optimizer?.compatible?'CNC Pendant travel markers V1 · optimizer ready':'No supported travel markers · original feeds retained'));details.append(el('p',`${(info.size/1e6).toFixed(2)} MB · modified ${new Date(info.modified).toLocaleString()}`));const warning=el('p',info.preliminary?.message||'No boundary metadata — full scan required.','file-fit-warning');if(info.preliminary?.fits===false)warning.classList.add('outside');details.append(warning);
    const more=el('details'),moreLabel=el('summary','File details / preview');more.append(moreLabel);details.append(more);const visibleDetails=details;const detailTarget=more;
    clearTimeout(thumbnailTimer);const preview=el('div');preview.style.cssText='margin:8px 0;font-size:11px;color:#bbb';detailTarget.append(preview);
    const existing=(metadata.thumbnails||[]).filter(t=>t.relative_path).sort((a,b)=>(b.width||0)-(a.width||0))[0];
    if(existing){const image=el('img');const parent=filename.includes('/')?filename.slice(0,filename.lastIndexOf('/')+1):'';const relative=parent+existing.relative_path;if(!relative.split('/').includes('..')&&!relative.startsWith('/')){image.src='/server/files/gcodes/'+relative.split('/').map(encodeURIComponent).join('/');image.alt='Embedded file thumbnail';image.style.cssText='display:block;width:100%;max-height:210px;object-fit:contain';image.addEventListener('error',()=>thumbnail(filename,token,preview),{once:true});preview.append(image);}else thumbnail(filename,token,preview);}
    else more.addEventListener('toggle',()=>{if(more.open&&!preview.dataset.requested){preview.dataset.requested='true';thumbnail(filename,token,preview);}},{once:true});
    if(info.metadata?.available)details.append(el('pre',`Header bounds · ${lengthDisplay().unit}\n${'XYZ'.split('').map((axis,i)=>axis+' '+lengthDisplay().format(info.metadata.min[i])+' to '+lengthDisplay().format(info.metadata.max[i])).join('\n')}`,'preflight-details'));
    const known={estimated_time:'Estimated time (s)',object_height:'Reported height ('+lengthDisplay().unit+')',slicer:'Generator',slicer_version:'Generator version'};for(const [key,label] of Object.entries(known))if(metadata[key]!==undefined)details.append(el('div',label+': '+(key==='object_height'?lengthDisplay().format(metadata[key]):metadata[key])));
    if(info.header_comments?.length){const fold=el('details'),summary=el('summary','Program comments / tool notes');fold.append(summary,el('pre',info.header_comments.join('\n'),'preflight-details'));details.append(fold);}
   }catch(error){if(token===sequence)details.replaceChildren(el('p',error.message));}}
  try{const archived=await window.CncProjects?.archivedPaths?.()||new Set();const all=(await ui().api('/server/files/list?root=gcodes')).filter(f=>/\.(gcode|gco|gc|nc|ngc|tap)$/i.test(f.path));const renderFiles=()=>{const old=list.value;list.replaceChildren();const named=(a,b)=>a.path.split('/').pop().localeCompare(b.path.split('/').pop(),undefined,{numeric:true,sensitivity:'base'})||a.path.localeCompare(b.path);const ordered=all.filter(f=>(!archived.has(f.path)||f.path===initialFilename)&&(!/^cnc_runs\//i.test(f.path)||f.path===initialFilename)&&(sourceToggle.checked||!/^Inbox\//i.test(f.path))&&f.path.toLowerCase().includes(search.value.toLowerCase())).sort((a,b)=>sort.value==='az'?named(a,b):sort.value==='za'?named(b,a):sort.value==='oldest'?a.modified-b.modified||named(a,b):b.modified-a.modified||named(a,b));for(const file of ordered){const item=el('option',displayIdentity(file.path));item.value=file.path;item.disabled=/quarantine|old-machine-origin/i.test(file.path);list.append(item);}if([...list.options].some(o=>o.value===old))list.value=old;inspect();};sourceToggle.addEventListener('change',renderFiles);search.addEventListener('input',renderFiles);sort.addEventListener('change',()=>{try{localStorage.setItem('cnc-file-sort',sort.value);}catch(_){}renderFiles();});list.addEventListener('change',()=>{pickerChosen=true;inspect();});if(initialFilename)list.value=initialFilename;renderFiles();if(initialFilename&&[...list.options].some(o=>o.value===initialFilename)){list.value=initialFilename;inspect();}
   const picker=el('input');picker.type='file';picker.accept='.gcode,.gco,.gc,.nc,.ngc,.tap';picker.setAttribute('aria-label','Upload G-code');picker.style.cssText='width:100%;min-height:44px;margin:6px 0';const uploadRow=el('label','Upload G-code from this device:');uploadRow.append(picker);m.insert(uploadRow);uploadRowElement=uploadRow;uploadRow.hidden=!selectedButton.hidden;const upload=picker;
   picker.addEventListener('change',async()=>{const file=picker.files?.[0];if(!file)return;upload.disabled=true;m.feedback.textContent='Uploading '+file.name+'…';try{
    if(!/\.(gcode|gco|gc|nc|ngc|tap)$/i.test(file.name))throw Error('Choose a G-code file.');
    const current=await ui().api('/server/files/list?root=gcodes');if(current.some(f=>f.path.toLowerCase()===file.name.toLowerCase()))throw Error('A file with this name already exists. Rename your local file before uploading.');
    const form=new FormData();form.append('root','gcodes');form.append('file',file,file.name);
    const response=await fetch('/server/files/upload',{method:'POST',body:form});const result=await response.json();if(!response.ok||result.error)throw Error(result.error?.message||'Upload failed.');
    const path=result.result?.item?.path||file.name;const fresh=await ui().api('/server/files/list?root=gcodes');all.splice(0,all.length,...fresh.filter(f=>/\.(gcode|gco|gc|nc|ngc|tap)$/i.test(f.path)));search.value='';renderFiles();list.value=path;await inspect();m.feedback.textContent='Uploaded. Select Set up to run when ready.';
   }catch(error){m.feedback.textContent=error.message;}finally{upload.disabled=false;picker.value='';}});
   m.add('Set up to run',async()=>{if(!selected)throw Error('Select a file.');await stage(selected);m.dialog.close();});const viewButton=m.add('View toolpath',()=>{if(!selected)throw Error('Select a file.');m.dialog.close();viewer(selected,()=>files(selected));});
   optimizer=m.add('Optimize travel…',()=>{if(!selected)throw Error('Select a file.');m.dialog.close();optimizeTravel(selected,null,null,null,{onClose:()=>files(selected)});});optimizer.disabled=true;
   const clear=m.add('Clear loaded file',async()=>{if(await clearLoadedFile())m.dialog.close();});clear.title='Clear the pendant selection; keep the G-code in Files.';clear.disabled=!state.filename||busy||isReturning()||!!latest?.pause_resume?.is_paused||latest?.print_stats?.state==='printing';const information=ui().reviewTabs(m,[details],'Select file');information.details.append(viewButton,optimizer,clear);
  }catch(error){m.feedback.textContent=error.message;}
 }
 document.addEventListener('cnc-pendant-status',event=>{const wasPaused=!!latest?.pause_resume?.is_paused;latest=event.detail;const paused=!!latest?.pause_resume?.is_paused;if(paused&&!wasPaused){pauseCheckPending=true;pauseCheckError=false;refresh();}if(!paused){pauseCheckPending=false;pauseCheckError=false;}render();});new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});mount();
 async function poll(){await refresh();setTimeout(poll,1500);}poll();
 window.CncPreflight={files,prepare,stage,optimizeTravel,viewToolpath:viewer,resume,afterZero,canResume,isReturning,hasStagedFile:()=>!!state.filename,refresh};
})();
