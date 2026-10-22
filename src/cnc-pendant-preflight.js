/* Shared staged-job UI; all Start/Resume authorization occurs on the Pi. */
(() => {
 'use strict';
 const endpoint='/machine/cnc_preflight/';let state={state:'empty'},latest=null,busy=false,polling=false,dialogSequence=0,resumePending=false,resumeDialogOpen=false,failedOperation='';
 const $=s=>document.querySelector(s),ui=()=>window.PendantUI;
 const el=(tag,text,cls)=>ui().el(tag,text,cls);
 const text=(node,value)=>{if(node&&node.textContent!==value)node.textContent=value;};
 async function api(name,method='GET',body){return ui().api(endpoint+name,method,body);}
 function isReturning(){return resumePending||state.operation?.state==='returning';}
 function canResume(){return latest?.webhooks?.state==='ready'&&latest?.toolhead?.homed_axes==='xyz'&&!busy&&!isReturning()&&!resumeDialogOpen&&!!latest?.pause_resume?.is_paused&&state.active_filename===state.filename&&state.state==='analyzed'&&!!state.verification?.approved;}
 function render(){
  const card=$('#pendant-stage-card');if(!card)return;
  const paused=!!latest?.pause_resume?.is_paused,running=!paused&&latest?.print_stats?.state==='printing';
  card.hidden=running||(!state.filename&&!paused);card.dataset.result=state.state==='scanning'?'pending':state.verification?.approved?'pass':'blocked';
  const filename=$('#pendant-stage-filename');text(filename,state.filename?.split('/').pop()||latest?.print_stats?.filename||'Paused file');filename.title=state.filename||'';
  const missing=[...'XYZ'].filter(a=>!latest?.toolhead?.homed_axes?.includes(a.toLowerCase()));
  const message=isReturning()?'Returning to saved position…':state.state==='scanning'?`Scanning ${Math.round((state.progress||0)*100)}%`:missing.length?'Not homed: '+missing.join(', '):state.verification?.approved?(paused?'Travel verified':'Ready to start'):'Verification required';
  text($('#pendant-stage-result'),message);
  const progress=$('#pendant-scan-progress');progress.hidden=state.state!=='scanning';progress.value=state.progress||0;
  const action=$('#pendant-quadrant-resume'),needsStage=paused&&!state.filename;
  action.disabled=latest?.webhooks?.state!=='ready'||!!missing.length||busy||running||isReturning()||(!needsStage&&(paused?!canResume():state.state!=='analyzed'||!state.verification?.approved));
  text(action,isReturning()?'Returning…':state.state==='scanning'?'Verifying…':paused?(needsStage?'Verify paused file…':'Resume job…'):'Start job…');
  const homing=$('#pendant-homing-needed');if(!card.hidden&&homing)homing.hidden=true;
  const old=$('#lowrider-pause-resume');if(paused&&old)old.disabled=!canResume();
  ui().queueFit();
 }
 function mount(){
  const body=$('.panel-body'),zone=$('#pendant-jog-zone'),pad=$('#lowrider-jog-pad');if(!body||!zone||!pad||$('#pendant-stage-card'))return;
  const card=el('section');card.id='pendant-stage-card';card.hidden=true;card.setAttribute('aria-label','Staged CNC job');
  const filename=el('strong');filename.id='pendant-stage-filename';const result=el('div');result.id='pendant-stage-result';result.setAttribute('role','status');const progress=el('progress');progress.id='pendant-scan-progress';progress.max=1;
  const action=el('button','Start job…');action.id='pendant-quadrant-resume';action.addEventListener('click',()=>latest?.pause_resume?.is_paused?resume():startJob());
  const controls=el('div',undefined,'preflight-actions'),details=el('button','Details');details.addEventListener('click',detailsDialog);controls.append(details);card.append(filename,result,progress,action,controls);pad.append(card);render();
 }
 async function clearLoadedFile(){if(busy||isReturning())return false;busy=true;render();try{state=await api('clear','POST',{});return true;}catch(error){const m=ui().modal('Cannot clear loaded file');m.insert(el('p',error.message));return false;}finally{busy=false;await refresh();}}
 async function refresh(){if(polling)return state;polling=true;try{state=await api('status');if(state.operation?.state==='complete'||state.operation?.state==='failed')resumePending=false;if(state.operation?.state==='failed'&&state.operation.id!==failedOperation){failedOperation=state.operation.id;const m=ui().modal('Resume stopped — check controller');m.insert(el('p',state.operation.message));}}catch(error){state={...state,state:'unavailable',verification:{approved:false,reason:'Verification service unavailable: '+error.message}};}finally{polling=false;render();}return state;}
 async function stage(filename){busy=true;render();try{state=await api('stage','POST',{filename});}finally{busy=false;render();}await refresh();}
 function verificationText(value){
  if(!value)return 'Verification has not completed.';
  const lines=[value.reason||'',...(value.violations||[]).map(v=>v.message),...(value.return_violations||[]).map(v=>v.message)];
  if(value.work_min)for(let i=0;i<3;i++)lines.push(`${'XYZ'[i]} work ${value.work_min[i].toFixed(3)} to ${value.work_max[i].toFixed(3)} mm · machine ${value.machine_min[i].toFixed(3)} to ${value.machine_max[i].toFixed(3)} mm`);
  if(value.label)lines.push('Tool section: '+value.label);if(value.scope)lines.push(value.scope);
  if(value.issues)for(const issue of value.issues.slice(0,8))lines.push(`Line ${issue.line}: ${issue.message}`);
  return lines.filter(Boolean).join('\n');
 }
 async function detailsDialog(){
  const m=ui().modal('G-code verification'),info=el('pre',undefined,'preflight-details');m.insert(info);m.insert(el('p','Travel verification does not certify stock, clamps, cutter length or fixture clearance.'));
  const show=()=>{info.textContent=[state.filename||'No file staged',state.state==='scanning'?`Scanning ${Math.round((state.progress||0)*100)}%`:verificationText(state.verification),state.report?`Scanned ${state.report.moves.toLocaleString()} moves in ${state.report.scan_seconds}s\nSHA-256: ${state.report.sha256}`:''].join('\n\n');};show();
  m.add('Verify again',async()=>{const result=await api('verify','POST',{});state.verification=result;show();render();});
  const timer=setInterval(show,1000);m.dialog.addEventListener('close',()=>clearInterval(timer));await refresh();show();
 }
 async function ensurePausedFile(){
  const status=(await ui().api('/printer/objects/query?pause_resume&print_stats')).status;
  if(!status.pause_resume?.is_paused)throw Error('No paused job.');const filename=status.print_stats?.filename;if(!filename)throw Error('No active file is available.');
  if(state.filename!==filename||state.state==='empty'||state.state==='error'||state.state==='unavailable')await stage(filename);else await refresh();
 }
 async function afterZero(){
  busy=true;render();try{await ensurePausedFile();const result=await api('verify','POST',{});state.verification=result;const m=ui().modal(result.approved?'Tool Z verified':'Resume blocked — check tool Z');m.insert(el('pre',verificationText(result),'preflight-details'));if(state.state==='scanning')m.insert(el('p','A background scan is running. Close this dialog and wait for the main verification panel.'));m.add('Verify again',async()=>{m.dialog.close();await afterZero();});}catch(error){const m=ui().modal('Tool Z verification');m.insert(el('p',error.message));}finally{busy=false;await refresh();}
 }
 async function resume(){
  if(busy||isReturning()||resumeDialogOpen)return;busy=true;render();try{await ensurePausedFile();const result=await api('verify','POST',{});state.verification=result;if(!result.approved){await detailsDialog();return;}
   const captured=state.id,m=ui().modal('Resume job?');resumeDialogOpen=true;m.dialog.addEventListener('close',()=>{resumeDialogOpen=false;render();});m.dialog.querySelector('.dialog-actions button').textContent='Cancel';m.insert(el('p','Travel verified — ready to resume. Check the tool, clamps and router power.'));
   const details=el('pre',verificationText(result),'preflight-details');details.hidden=true;m.insert(details);m.add('Details',()=>{details.hidden=!details.hidden;});
   m.add('Resume',async()=>{m.dialog.close();busy=true;resumePending=true;render();try{const accepted=await api('resume','POST',{stage_id:captured});if(accepted.operation)state.operation=accepted.operation;}catch(error){
     await refresh();let actual;try{actual=(await ui().api('/printer/objects/query?pause_resume&print_stats&virtual_sdcard')).status;}catch(_){}
     if(actual?.print_stats?.state==='printing'&&!actual?.pause_resume?.is_paused){resumePending=false;}
     else if(state.operation?.state!=='returning'){
       // A lost response does not cancel the Pi's accepted command. Keep the
       // action locked until the controller state is known; never retry it.
       const timeout=error.name==='TimeoutError'||error.name==='AbortError'||/timed? out|timeout|fetch|network/i.test(error.message);
       if(!timeout)resumePending=false;
       const failure=ui().modal(timeout?'Resume status uncertain':'Resume blocked');failure.insert(el('p',timeout?'The connection response was lost. The machine may still be returning. Watch the machine; do not send another Resume. The pendant will check its state.':error.message));
     }
    }finally{busy=false;await refresh();}});
  }catch(error){const m=ui().modal('Resume blocked');m.insert(el('p',error.message));}finally{busy=false;render();}
 }
 async function startJob(){
  if(busy)return;busy=true;render();try{await refresh();const verified=await api('verify','POST',{});state.verification=verified;if(!verified.approved){await detailsDialog();return;}
   const captured=state.id,filename=state.filename,m=ui().modal('Start verified CNC job?');m.dialog.querySelector('.dialog-actions button').textContent='Cancel';m.insert(el('p',filename));m.insert(el('p','Confirm work/tool zero, tool and clamps, clearance and manual router power. Later tool sections must be re-verified with their actual tool zeros.'));m.insert(el('pre',verificationText(verified),'preflight-details'));
   m.add('Start job',async()=>{m.dialog.close();busy=true;render();try{await api('start','POST',{stage_id:captured});}catch(error){const failure=ui().modal('Start blocked');failure.insert(el('p',error.message));}finally{busy=false;await refresh();}});
  }catch(error){const m=ui().modal('Start blocked');m.insert(el('p',error.message));}finally{busy=false;render();}
 }
 function viewer(filename){const m=ui().modal('Toolpath viewer');m.dialog.classList.add('pendant-viewer-dialog');const name=el('p',filename,'pendant-viewer-filename');name.title=filename;m.insert(name);const frame=el('iframe');frame.title='Mainsail G-code toolpath viewer';frame.src='/viewer?filename='+encodeURIComponent('gcodes/'+filename);frame.className='preflight-viewer';m.insert(frame);m.insert(el('p','Visualization is not verification. Enable travel visibility for CNC paths.','pendant-viewer-note'));}
 function optimizeTravel(filename,parentDialog){
  const m=ui().modal('Optimize marked travel'),summary=el('pre','Preview before creating a copy.','preflight-details');m.insert(el('p',filename));
  m.insert(el('p','Only versioned Fusion travel markers are eligible. Cutting, plunge and unproven moves keep their feeds. The original stays unchanged. Rates are mm/min; run-speed override still applies.'));
  const inputs={};for(const [key,label,value,max] of [['xy_feed','XY travel (mm/min)',3000,30000],['z_feed','Z upward retract (mm/min)',180,3000]]){
   const row=el('label',label,'dialog-field'),input=el('input');input.type='number';input.inputMode='decimal';input.min=1;input.max=max;input.value=value;input.setAttribute('aria-label',label);row.append(input);m.insert(row);inputs[key]=input;
  }
  m.insert(summary);let identity='',ready=false,created='',watch=null,working=false;
  const values=()=>{const v={};for(const [key,input] of Object.entries(inputs)){const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<1||n>Number(input.max))throw Error('Enter valid travel rates.');v[key]=String(n);}return v;};
  const render=result=>{
   ready=result.state==='preview';working=result.state==='working';created=result.state==='created'?result.filename:'';
   for(const input of Object.values(inputs))input.disabled=working;
   preview.disabled=working;create.disabled=!ready;stageCopy.disabled=!created;
   if(result.state==='working')summary.textContent='Preparing travel preview in the background…';
   else if(result.state==='error')summary.textContent=result.message;
   else summary.textContent=[result.message,`${result.changed_moves} changed moves · ${result.eligible_moves} eligible`,
     `XY ${result.xy_feed} · Z retract ${result.z_feed} mm/min`,`Declared work clearance Z${result.clearance_mm} mm`,
     `Nominal motion: ${result.nominal_before_seconds}s → ${result.nominal_after_seconds}s at 100%`,
     'Estimate excludes pauses, acceleration, controller limits and unknown initial moves.',created?`New file: ${created}`:''].filter(Boolean).join('\n');
  };
  const poll=async()=>{if(!m.dialog.open)return;try{const r=await api('optimization');if(r.id!==identity)throw Error('Another client replaced this preview. Preview again.');render(r);if(working)watch=setTimeout(poll,750);}catch(error){working=false;preview.disabled=false;m.feedback.textContent=error.message;}};
  async function request(mode){const rates=values();ready=false;create.disabled=true;stageCopy.disabled=true;const r=await api('optimize','POST',{mode,filename,...rates,...(mode==='create'?{preview_id:identity}:{})});identity=r.id;render(r);clearTimeout(watch);watch=setTimeout(poll,500);}
  const preview=m.add('Preview',()=>request('preview')),create=m.add('Create optimized copy',async()=>{if(!ready)throw Error('Preview the current settings first.');try{await request('create');}finally{setTimeout(()=>{create.disabled=!ready;},0);}}),stageCopy=m.add('Stage & verify copy',async()=>{if(!created)throw Error('Create a copy first.');await stage(created);m.dialog.close();parentDialog?.close();});create.disabled=true;stageCopy.disabled=true;
  for(const input of Object.values(inputs))input.addEventListener('input',()=>{ready=false;created='';create.disabled=true;stageCopy.disabled=true;summary.textContent='Settings changed. Preview again.';});
  m.dialog.addEventListener('close',()=>clearTimeout(watch));
 }
 async function files(){
  const m=ui().modal('Files / stage job'),search=el('input'),list=el('select'),details=el('div',undefined,'cnc-file-details');search.placeholder='Filter files';search.setAttribute('aria-label','Filter G-code files');search.className='file-search';list.size=6;list.className='file-list cnc-file-list';list.setAttribute('aria-label','G-code files');m.insert(search);m.insert(list);m.insert(details);
  let selected='',sequence=0,optimizer=null;
  async function inspect(){if(optimizer)optimizer.disabled=true;const filename=list.value;selected=filename;const token=++sequence;details.replaceChildren();if(!filename)return;details.append(el('p','Reading file details…'));try{
    const [info,metadata]=await Promise.all([api('inspect?filename='+encodeURIComponent(filename)),ui().api('/server/files/metadata?filename='+encodeURIComponent(filename)).catch(()=>({}))]);if(token!==sequence||!m.dialog.open)return;
    details.replaceChildren(el('strong',filename));if(optimizer){optimizer.disabled=!info.optimizer?.compatible||!!info.optimizer?.already_optimized;optimizer.title=info.optimizer?.compatible?'Preview optional travel-feed changes':'Requires the marked CNC Pendant Fusion post';}details.append(el('div',info.optimizer?.already_optimized?'Travel-optimized copy · verify before Start':info.optimizer?.compatible?'CNC Pendant travel markers V1 · optimizer ready':'No supported travel markers · original feeds retained'));details.append(el('p',`${(info.size/1e6).toFixed(2)} MB · modified ${new Date(info.modified).toLocaleString()}`));const warning=el('p',info.preliminary?.message||'No boundary metadata — full scan required.','file-fit-warning');if(info.preliminary?.fits===false)warning.classList.add('outside');details.append(warning);
    if(info.metadata?.available)details.append(el('pre',`Header bounds · mm\n${'XYZ'.split('').map((axis,i)=>axis+' '+info.metadata.min[i].toFixed(3)+' to '+info.metadata.max[i].toFixed(3)).join('\n')}`,'preflight-details'));
    const known={estimated_time:'Estimated time (s)',object_height:'Reported height (mm)',slicer:'Generator',slicer_version:'Generator version'};for(const [key,label] of Object.entries(known))if(metadata[key]!==undefined)details.append(el('div',label+': '+metadata[key]));
    if(info.header_comments?.length){const fold=el('details'),summary=el('summary','Program comments / tool notes');fold.append(summary,el('pre',info.header_comments.join('\n'),'preflight-details'));details.append(fold);}
   }catch(error){if(token===sequence)details.replaceChildren(el('p',error.message));}}
  try{const all=(await ui().api('/server/files/list?root=gcodes')).filter(f=>/\.(gcode|gco|gc|nc|ngc|tap)$/i.test(f.path)).sort((a,b)=>b.modified-a.modified);const renderFiles=()=>{const old=list.value;list.replaceChildren();for(const file of all.filter(f=>f.path.toLowerCase().includes(search.value.toLowerCase()))){const item=el('option',file.path);item.value=file.path;item.disabled=/quarantine|old-machine-origin/i.test(file.path);list.append(item);}if([...list.options].some(o=>o.value===old))list.value=old;inspect();};search.addEventListener('input',renderFiles);list.addEventListener('change',inspect);renderFiles();
   m.add('Stage & verify',async()=>{if(!selected)throw Error('Select a file.');await stage(selected);m.dialog.close();});m.add('View toolpath',()=>{if(!selected)throw Error('Select a file.');viewer(selected);});
   optimizer=m.add('Optimize travel…',()=>{if(!selected)throw Error('Select a file.');optimizeTravel(selected,m.dialog);});optimizer.disabled=true;
   const clear=m.add('Clear loaded file',async()=>{if(await clearLoadedFile())m.dialog.close();});clear.title='Clear the pendant selection; keep the G-code in Files.';clear.disabled=!state.filename||busy||isReturning()||!!latest?.pause_resume?.is_paused||latest?.print_stats?.state==='printing';
  }catch(error){m.feedback.textContent=error.message;}
 }
 document.addEventListener('cnc-pendant-status',event=>{latest=event.detail;render();});new MutationObserver(mount).observe(document.documentElement,{childList:true,subtree:true});mount();
 async function poll(){await refresh();setTimeout(poll,1500);}poll();
 window.CncPreflight={files,resume,afterZero,canResume,isReturning,hasStagedFile:()=>!!state.filename,refresh};
})();
