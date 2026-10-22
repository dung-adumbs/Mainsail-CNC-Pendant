/* Standalone pendant bridge; existing controller macros remain authoritative. */
(() => {
  'use strict';
  let latest=null, fitted=false, fitQueued=false;
  const $=selector=>document.querySelector(selector);
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const originalFetch=window.fetch.bind(window);
  window.fetch=(input,options)=>{const path=typeof input==='string'?input:input?.url||'';let activityOnly=false;try{activityOnly=JSON.parse(options?.body||'{}').script?.trim()==='LED_IDLE_ACTIVITY';}catch(_){}if(!activityOnly&&options?.method?.toUpperCase()==='POST'&&/\/(?:printer\/(?:gcode\/script|emergency_stop|restart|firmware_restart)|machine\/cnc_preflight\/(?:start|resume))(?:\?|$)/.test(path))document.dispatchEvent(new Event('cnc-command-start'));return originalFetch(input,options);};
  async function api(path,method='GET',value){const r=await fetch(path,{method,cache:'no-store',signal:AbortSignal.timeout(10000),...(value!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)}:{})});const data=await r.json();if(!r.ok||data.error)throw Error(data.error?.message||'Controller request failed');return data.result;}
  const command=script=>api('/printer/gcode/script','POST',{script});
  async function idle(){const s=(await api('/printer/objects/query?webhooks&print_stats&pause_resume&idle_timeout&toolhead&virtual_sdcard')).status;if(s?.webhooks?.state!=='ready'||['printing','paused'].includes(s.print_stats?.state)||s.pause_resume?.is_paused||s.virtual_sdcard?.is_active||s.idle_timeout?.state==='Printing')throw Error('Wait until the machine is idle, with no running or paused job.');return s;}
  let stoppedShown=false,stopCheckPending=false,stoppedWasNotReady=false;
  function stoppedDialog(message){if(stoppedShown)return;stoppedShown=true;const m=modal('Controller stopped');m.dialog.querySelector('.dialog-actions button').textContent='Cancel';m.insert(el('p',message||'Emergency stop is active.'));m.insert(el('p','Correct the cause and check the machine before restarting. Restart clears homing and work zeros; rehome and reset work/tool zeros before use.'));m.add('Restart controller',async()=>{const info=await api('/printer/info');if(info.state==='ready'){m.dialog.close();return;}if(!['shutdown','error'].includes(info.state))throw Error('Wait for the controller state to settle, then try again.');await api('/printer/firmware_restart','POST',{});m.dialog.close();$('#pendant-live-state').textContent='Controller restarting…';});}
  async function emergencyStop(){try{await api('/printer/emergency_stop','POST',{});$('#pendant-live-state').textContent='EMERGENCY STOP — controller restart required';stoppedDialog('Emergency stop is active.');}catch(error){$('#pendant-live-state').textContent='Stop request failed — use the physical emergency stop';}}
  async function checkStopped(){if(stopCheckPending||latest?.webhooks?.state==='ready')return;stopCheckPending=true;try{const info=await api('/printer/info');if(info.state==='shutdown'){stoppedWasNotReady=true;stoppedDialog(info.state_message);}}catch(_){}finally{stopCheckPending=false;}}
  setInterval(checkStopped,2500);
  function stopButton(){const b=el('button','E-STOP','pendant-stop');b.type='button';b.setAttribute('aria-label','Emergency stop');b.addEventListener('click',emergencyStop);return b;}
  function modal(title){
    const dialog=el('dialog');dialog.setAttribute('aria-label',title);dialog.append(el('h3',title));const feedback=el('p','','dialog-feedback');feedback.setAttribute('role','status');dialog.append(feedback);const actions=el('div',undefined,'dialog-actions');dialog.append(actions);
    const add=(label,handler)=>{const b=el('button',label);b.type='button';b.addEventListener('click',async()=>{b.disabled=true;try{await handler();}catch(error){feedback.textContent=error.message;}finally{b.disabled=false;}});actions.append(b);return b;};
    add('Close',()=>dialog.close());dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return{dialog,feedback,add,insert(e){dialog.insertBefore(e,feedback);}};
  }
  function fit(){const frame=$('#pendant-viewport'),content=$('#pendant-scale'),panel=$('.toolhead-control-panel');if(!frame||!panel)return;const mobile=matchMedia('(max-width:799px), (pointer:coarse)').matches;const scale=mobile?1:Math.min(1,frame.clientHeight/Math.max(1,panel.offsetHeight+8));const transform=scale<.999?`scale(${scale})`:'';if(content.style.transform!==transform)content.style.transform=transform;content.dataset.scale=scale.toFixed(3);}
  function queueFit(){if(fitQueued)return;fitQueued=true;requestAnimationFrame(()=>{fitQueued=false;fit();});}
  window.PendantUI={modal,el,api,queueFit};
  window.addEventListener('resize',queueFit);window.visualViewport?.addEventListener('resize',queueFit);
  document.addEventListener('cnc-pendant-status',event=>{
    const s=event.detail,bar=$('#pendant-job-motion-summary');if(!bar)return;
    let readout=$('#pendant-motion-speed');if(!readout){readout=el('div',undefined);readout.id='pendant-motion-speed';readout.style.cssText='text-align:center;font-size:12px;color:#ccc;margin:3px 0 6px';readout.title='Live: Klipper planned tool speed, not encoder-measured. Requested: last parsed feed including Run speed override; buffered commands may be ahead of current motion.';bar.append(readout);}
    const ready=s?.webhooks?.state==='ready',live=s?.motion_report?.live_velocity,feed=s?.gcode_move?.speed,factor=s?.gcode_move?.speed_factor;
    const target=Number.isFinite(feed)&&Number.isFinite(factor)?feed*factor/60:null;
    const text='Motion · Live '+(ready&&Number.isFinite(live)?live.toFixed(1):'—')+' mm/s · Requested '+(ready&&target!==null?target.toFixed(1):'—')+' mm/s';if(readout.textContent!==text)readout.textContent=text;
  });
  document.addEventListener('cnc-pendant-status',event=>{
    const s=event.detail;latest=s;const ready=s?.webhooks?.state==='ready',active=!!s?.pause_resume?.is_paused||['paused','printing'].includes(s?.print_stats?.state);$('#pendant-live-state').textContent=!ready?'Disconnected / controller not ready':(s.pause_resume?.is_paused||s.print_stats?.state==='paused'?'Paused':s.print_stats?.state==='printing'?'Running':'Ready')+(active&&s.print_stats?.filename?' · '+s.print_stats.filename:'');
    if(ready&&stoppedWasNotReady){stoppedShown=false;stoppedWasNotReady=false;document.querySelector('dialog[aria-label="Controller stopped"]')?.close();}else if(s?.webhooks?.state==='shutdown'){stoppedWasNotReady=true;stoppedDialog(s.webhooks.state_message);}
    const stopped=!ready&&stoppedWasNotReady,banner=$('#pendant-live-state');banner.setAttribute('role',stopped?'button':'status');banner.tabIndex=stopped?0:-1;if(stopped)banner.textContent='Controller stopped — tap for restart';
    renderCoordinates(s);renderJobView(s);updateStepperButton(s);updateHomingNeeded(s);queueFit();
  });
  const liveBanner=$('#pendant-live-state');
  function reopenRestart(){if(latest?.webhooks?.state==='ready'||!stoppedWasNotReady)return;stoppedShown=false;stoppedDialog(latest?.webhooks?.state_message);}
  liveBanner.addEventListener('click',reopenRestart);liveBanner.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();reopenRestart();}});
  document.documentElement.dataset.coordinateUnit=window.CncSettings?.get('units')||'mm';
  document.addEventListener('cnc-shared-setting',event=>{if(event.detail.key!=='units')return;document.documentElement.dataset.coordinateUnit=event.detail.value;renderCoordinates(latest);document.dispatchEvent(new Event('cnc-coordinate-units'));queueFit();});
  function renderCoordinates(s){
    const unit=document.documentElement.dataset.coordinateUnit,factor=unit==='in'?25.4:unit==='cm'?10:1;
    const format=(value,i)=>(value/factor).toFixed(unit==='in'?4:i===2?3:2);const table=$('.positions');if(table)table.setAttribute('aria-label','Spindle coordinates in '+(unit==='in'?'inches':unit==='cm'?'centimeters':'millimeters'));
    for(const [i,a] of [...'XYZ'].entries()){
      const input=$(`[data-native-axis="${a}"]:not([data-lowrider-position])`);if(s?.gcode_move&&input)input.value=format(s.gcode_move.gcode_position[i],i);
      const range=$('#lowrider-range-'+i),limits=$('#machine-range-'+a);
      if(s?.gcode_move&&s?.toolhead){const offset=s.gcode_move.position[i]-s.gcode_move.gcode_position[i];const text=s.toolhead.homed_axes.includes(a.toLowerCase())?format(s.toolhead.axis_minimum[i]-offset,i)+' to '+format(s.toolhead.axis_maximum[i]-offset,i):'Home '+a+' first';if(range&&range.textContent!==text)range.textContent=text;const machineText=format(s.toolhead.axis_minimum[i],i)+' to '+format(s.toolhead.axis_maximum[i],i);if(limits&&limits.textContent!==machineText)limits.textContent=machineText;}
    }
    const toggle=$('#pendant-coordinate-units');if(toggle){const text='Coordinates · '+unit+' ⇄';if(toggle.textContent!==text)toggle.textContent=text;toggle.setAttribute('aria-label','Coordinate and jog units: '+unit+'. Switch to '+({mm:'centimeters',cm:'inches',in:'millimeters'}[unit]));}
  }
  async function homeEndstops(dialog){
    if(dialog.dataset.endstopsRequested)return;dialog.dataset.endstopsRequested='true';const row=el('div',undefined,'pendant-endstop-row');row.append(el('span','Endstops'));const switches=el('div',undefined,'switches');row.append(switches);const names=[['X','stepper_x'],['Y','stepper_y'],['Y1','y1'],['Z','stepper_z'],['Z1','z1']];const tiles=names.map(([name])=>{const e=el('span',name);e.setAttribute('role','status');e.style.background='#555';e.title='Reading';switches.append(e);return e;});dialog.querySelector('h3')?.after(row);
    try{const states=await api('/printer/query_endstops/status');names.forEach(([name,key],i)=>{const value=String(states[key]??'unavailable').toLowerCase();tiles[i].style.background=value==='triggered'?'#b71c1c':value==='open'?'#2e7d32':'#555';tiles[i].title=name+': '+value;tiles[i].setAttribute('aria-label',name+': '+value);});row.title='Snapshot on Home entry. Reopen Home to refresh.';}catch(error){row.title=error.message;tiles.forEach(e=>e.title='Unavailable');}
  }
  document.addEventListener('click',event=>{
    const b=event.target.closest?.('[data-lowrider-disable-steppers]');if(!b)return;if(b.dataset.pendantConfirmed){delete b.dataset.pendantConfirmed;return;}
    event.preventDefault();event.stopImmediatePropagation();const m=modal('Disable steppers?');m.dialog.querySelector('.dialog-actions button').textContent='Cancel';m.insert(el('p','This releases motor holding torque. The gantry may shift or drop, and axes will need homing again. Continue?'));m.add('Yes, disable steppers',async()=>{await idle();m.dialog.close();b.dataset.pendantConfirmed='true';b.click();});
  },true);
  function jobViewState(s){
    const ready=s?.webhooks?.state==='ready',paused=!!s?.pause_resume?.is_paused||s?.print_stats?.state==='paused';
    const running=!paused&&(s?.print_stats?.state==='printing'||!!s?.virtual_sdcard?.is_active);
    const progress=Number(s?.virtual_sdcard?.progress),seconds=Number(s?.print_stats?.print_duration);
    return {mode:!ready?'disconnected':paused?'paused':running?'running':'setup',progress:Number.isFinite(progress)?Math.max(0,Math.min(1,progress)):0,seconds:Number.isFinite(seconds)?Math.max(0,seconds):0};
  }
  function stepperTimer(s){
    if(s?.webhooks?.state!=='ready')return {label:'Unavailable'};
    if(!Object.values(s?.stepper_enable?.steppers||{}).some(Boolean))return {label:'Disabled'};
    const idle=s?.['gcode_macro _LED_IDLE_STATE']||{},now=s?.toolhead?.estimated_print_time||0,grace=Number(idle.disable_after??1800);
    if(s?.pause_resume?.is_paused||['printing','paused'].includes(s?.print_stats?.state)||s?.idle_timeout?.state==='Printing')return {label:'Auto-disable held'};
    if(grace<=0)return {label:'Auto-disable off'};
    if(Number(idle.steady??0)<=0)return {label:'Timer inactive · light off'};
    const warning=!!idle.automatic,until=warning&&idle.warning_since>=0?Number(idle.warning_since)+grace:Number(idle.snooze_until)>now?Number(idle.snooze_until)+grace:(Number(idle.idle_since)>=0?Number(idle.idle_since):now)+Number(idle.timeout??1800)+grace;
    const seconds=Math.max(0,Math.ceil(until-now));return {label:`Disable in ${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`,seconds,warning};
  }
  function updateStepperButton(s){const button=$('#pendant-steppers');if(!button)return;const timer=stepperTimer(s),energized=Object.values(s?.stepper_enable?.steppers||{}).some(Boolean);button.replaceChildren(el('span','Steppers'),el('small',timer.label));button.disabled=s?.webhooks?.state!=='ready';button.classList.toggle('stepper-warning',!!timer.warning);button.classList.toggle('stepper-energized',energized);}
  function showSteppers(){
    const m=modal('Steppers / idle timer'),status=el('p',stepperTimer(latest).label);m.insert(status);
    m.insert(el('p','Reset starts the full idle reminder period again. Snooze postpones an active warning for 15 minutes. Running and paused jobs do not automatically disable steppers.'));
    m.add('Reset idle timer',async()=>{await command('SET_GCODE_VARIABLE MACRO=_LED_IDLE_STATE VARIABLE=snooze_until VALUE=0\nLED_IDLE_ACTIVITY');m.feedback.textContent='Idle timer reset.';});
    const snooze=m.add('Snooze warning',async()=>{await command('LED_IDLE_SNOOZE');m.feedback.textContent='Warning snoozed for 15 minutes.';});
    m.add('Auto-disable settings',()=>{m.dialog.close();$('#lowrider-stepper-timeout').click();});
    const disable=m.add('Disable steppers…',()=>{m.dialog.close();$('[data-lowrider-disable-steppers]').click();});
    const update=()=>{textNode(status,stepperTimer(latest).label);snooze.disabled=!latest?.['gcode_macro _LED_IDLE_STATE']?.automatic;disable.disabled=!!$('[data-lowrider-disable-steppers]')?.disabled;};
    function textNode(node,text){if(node.textContent!==text)node.textContent=text;}
    update();const timer=setInterval(update,1000);m.dialog.addEventListener('close',()=>clearInterval(timer));
  }
  function updateHomingNeeded(s){
    const box=$('#pendant-homing-needed');if(!box)return;const missing=[...'XYZ'].filter(a=>!s?.toolhead?.homed_axes?.includes(a.toLowerCase()));
    box.hidden=s?.webhooks?.state!=='ready'||!missing.length||jobViewState(s).mode!=='setup'||!!window.CncPreflight?.hasStagedFile();const message='Not homed: '+missing.join(', ')+'\nHome before starting.';if(box.textContent!==message)box.textContent=message;
  }
  function renderJobView(s){
    const card=$('#pendant-running-job');if(!card)return;
    const state=jobViewState(s),app=$('#app');app.dataset.jobMode=state.mode;
    const text=(id,value)=>{const node=$(id);if(node&&node.textContent!==value)node.textContent=value;};
    text('#pendant-job-title',state.mode==='paused'?'JOB PAUSED — jogging available':'JOB RUNNING');
    text('#pendant-job-file',s?.print_stats?.filename||'No file selected');
    const pct=Math.round(state.progress*100);text('#pendant-job-percent',pct+'%');$('#pendant-job-progress').value=state.progress;
    const duration=n=>{const minutes=Math.floor(n/60);return `${Math.floor(minutes/60)}h ${minutes%60}m`;};
    text('#pendant-job-elapsed','Cutting time: '+duration(state.seconds));
    text('#pendant-job-remaining',state.progress>.02&&state.seconds>0?'Est. remaining: '+duration(state.seconds*(1-state.progress)/state.progress):'Remaining time: estimating…');
    const original=$('#lowrider-pause-resume'),pause=$('#pendant-running-pause');pause.disabled=state.mode!=='running'||!!original?.disabled;
    const abort=$('[data-lowrider-job-action="abort"]');$('#pendant-abort-job').disabled=!['running','paused'].includes(state.mode)||!abort||abort.disabled;
    text('#pendant-paused-note','Paused — jog to inspect or change tools, then Resume.');
  }
  function arrangePendant(){
    if($('#pendant-jog-zone'))return;
    const pad=$('#lowrider-jog-pad'),z=$('#lowrider-horizontal-z'),scale=$('#lowrider-scale-toggle'),safe=$('#lowrider-z5-controls'),active=$('#lowrider-active-controls'),home=$('#lowrider-home-dialog'),timeout=$('#lowrider-stepper-timeout-row');
    if(!pad||!z||!safe||!active||!home||!timeout||!$('#lowrider-feed-factor')||!$('[data-lowrider-disable-steppers]'))return;
    const rate=pad.querySelector('[aria-label="Jog speed adjustment"]'),oldScale=scale.parentElement;
    const settings=el('div',undefined,'pendant-jog-settings');pad.before(settings);settings.append(rate);
    const zone=el('div');zone.id='pendant-jog-zone';pad.before(zone);zone.append(pad);
    $('#pendant-old-xy-label')?.remove();scale.dataset.pendantCenter='true';scale.dataset.mode='';scale.style.cssText='grid-column:4;grid-row:5';pad.append(scale);scale.replaceChildren(el('span','X / Y'),el('small',scale.textContent));
    z.dataset.pendantQuadrant='true';pad.append(z);const motion=el('div');motion.id='pendant-motion-notice';motion.hidden=true;motion.setAttribute('role','status');motion.append(el('strong','IN MOTION'),el('span','Additional moves will be queued.'),el('span','Proceed with caution.'));pad.append(motion);
    const safety=el('div');safety.id='pendant-safety-strip';zone.after(safety);safety.append(safe);oldScale.hidden=true;
    const cap=safe.lastElementChild;cap.prepend(el('span','Jog cap','pendant-cap-caption'));
    const safetySettings=el('button');safetySettings.id='pendant-z-safety-settings';safetySettings.type='button';
    const safeInput=$('#lowrider-safe-jog-z'),capInput=$('#lowrider-z5-cap');
    const updateSafety=()=>{safetySettings.textContent=`Z Safety: ${safeInput.value} mm · Cap ${capInput.value}%`;};
    for(const input of [safeInput,capInput])input.parentElement.closest('label').hidden=true;
    safe.append(safetySettings);updateSafety();
    document.addEventListener('cnc-shared-setting',()=>setTimeout(updateSafety,0));
    safetySettings.addEventListener('click',()=>{
      const m=modal('Z Safety');m.dialog.classList.add('pendant-safety-dialog');
      m.dialog.querySelector('.dialog-actions button').textContent='Cancel';
      m.insert(el('p',`Current: Safe Z ${safeInput.value} mm; below-safe-Z jog cap ${capInput.value}%.`));
      const fields=[];
      for(const [original,label,max] of [[safeInput,'Safe work Z height (mm)',109],[capInput,'Below-safe-Z jog cap (%)',100]]){
        const row=el('label',label,'dialog-field'),input=el('input');input.type='number';input.inputMode='decimal';input.step='any';input.min=original===capInput?'1':'0';input.max=String(max);input.value=original.value;input.setAttribute('aria-label',label);row.append(input);m.insert(row);fields.push({original,input,max});
        input.addEventListener('focus',()=>setTimeout(()=>input.scrollIntoView({block:'nearest'}),150));
        input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}});
      }
      m.add('Save',()=>{
        for(const {input,max} of fields){const n=Number(input.value);if(!input.value.trim()||!Number.isFinite(n)||n<Number(input.min)||n>max)throw Error(`Enter a value from ${input.min} to ${max}.`);}
        for(const {original,input} of fields){original.value=input.value;original.dispatchEvent(new Event('blur'));}
        updateSafety();m.dialog.close();
      });
    });
    const actions=el('div');actions.id='pendant-actions';safety.after(actions);actions.append(home,$('#lowrider-grid-zero'),$('#lowrider-pause-resume'),$('#lowrider-grid-light').parentElement);active.hidden=true;
    const auxiliary=$('#pendant-auxiliary');auxiliary.append($('.macrogroup_lowrider-homing_panel'),timeout);
    const disable=$('[data-lowrider-disable-steppers]');disable.textContent='Disable Steppers';disable.setAttribute('aria-label','Disable Steppers');auxiliary.append(disable);
    const steppers=el('button');steppers.id='pendant-steppers';steppers.setAttribute('aria-label','Steppers timer and controls');steppers.addEventListener('click',showSteppers);$('.pendant-tabs').append(steppers);
    const unhomed=el('div');unhomed.id='pendant-homing-needed';unhomed.hidden=true;unhomed.setAttribute('role','status');pad.append(unhomed);
    actions.after($('#lowrider-feed-factor'));
    const body=$('.panel-body'),toolbar=body.querySelector('.panel-toolbar'),positions=body.querySelector('.positions'),feed=$('#lowrider-feed-factor');
    const job=el('section');job.id='pendant-running-job';job.setAttribute('aria-label','Current CNC job');
    job.append(el('h2','JOB RUNNING'));job.firstChild.id='pendant-job-title';
    const filename=el('div');filename.id='pendant-job-file';job.append(filename);
    const percent=el('strong','0%');percent.id='pendant-job-percent';const summary=el('div');summary.id='pendant-job-motion-summary';summary.style.cssText='display:flex;justify-content:center;align-items:center;gap:20px;flex-wrap:wrap';summary.append(percent);job.append(summary);
    const progress=el('progress');progress.id='pendant-job-progress';progress.max=1;progress.value=0;progress.setAttribute('aria-label','Job progress');job.append(progress);
    for(const id of ['elapsed','remaining']){const line=el('div');line.id='pendant-job-'+id;job.append(line);}
    const pause=el('button','Pause job');pause.id='pendant-running-pause';pause.addEventListener('click',()=>$('#lowrider-pause-resume').click());job.append(pause);
    const paused=el('div');paused.id='pendant-paused-note';
    const abort=el('button','Abort Job…');abort.id='pendant-abort-job';abort.addEventListener('click',()=>{const original=$('[data-lowrider-job-action="abort"]');if(original&&!original.disabled)original.click();});
    actions.append(abort);
    body.prepend(job,paused,zone,toolbar,positions,feed,settings,safety,actions);
    const headings=el('div',undefined,'position-table-heading');headings.setAttribute('role','row');
    for(const label of ['Machine limits','Machine','Axis','Work','Work limits']){const cell=el('span',label);cell.setAttribute('role','columnheader');headings.append(cell);}positions.prepend(headings);positions.setAttribute('role','table');positions.setAttribute('aria-label','Spindle coordinates in millimeters');
    for(const row of positions.querySelectorAll('.position-box')){row.setAttribute('role','row');row.querySelector('.v-input').classList.add('work-position-cell');}
    for(const [i,row] of [...positions.querySelectorAll('.position-box')].entries()){const range=el('div','Reading…','machine-range');range.id='machine-range-'+'XYZ'[i];row.prepend(range);}
    const caption=$('.coordinate-caption');caption.textContent='';const toggle=el('button','Coordinates · mm ⇄');toggle.id='pendant-coordinate-units';toggle.title='Switch coordinate entry and normal jog increments between millimeters and inches. Safe Z settings and speed readouts retain their labeled units.';
    toggle.title='Double-tap to switch mm → cm → inches. Safe Z settings and speeds retain their labeled units.';
    let lastUnitTap=0;
    toggle.addEventListener('click',()=>{const now=Date.now();if(now-lastUnitTap>550){lastUnitTap=now;toggle.classList.add('unit-tap-armed');setTimeout(()=>toggle.classList.remove('unit-tap-armed'),550);return;}lastUnitTap=0;toggle.classList.remove('unit-tap-armed');document.activeElement?.blur();const next={mm:'cm',cm:'in',in:'mm'}[document.documentElement.dataset.coordinateUnit]||'mm';window.CncSettings.set('units',next).catch(()=>{const m=modal('Settings not saved');m.insert(el('p','Check the connection to the Pi.'));});});
    caption.append(toggle);renderCoordinates(latest);
    renderJobView(latest);updateStepperButton(latest);updateHomingNeeded(latest);queueFit();
  }
  const sections={
    async keepouts(){const m=modal('Keep-out areas'),panel=$('#lowrider-keepout-panel');if(panel){panel.style.setProperty('display','block','important');m.insert(panel);}else m.feedback.textContent='Settings are loading; close and try again.';m.dialog.addEventListener('close',()=>{if(panel){panel.style.removeProperty('display');$('.pendant-column').append(panel);}});},
    async files(){if(!window.CncPreflight)throw Error('Verification controls are loading.');return window.CncPreflight.files();},
    async machine(){
      const reloadButton=()=>{const button=el('button','Reload pendant');button.type='button';button.addEventListener('click',()=>location.replace('/cnc-pendant.html?refresh='+Date.now()));return button;};
      const m=modal('Machine limits (current session)');m.insert(reloadButton());const appLinks=el('p');const download=el('a','Download Android preview app');download.href='/cnc-pendant.apk';download.download='CNC-Pendant-preview.apk';appLinks.append(download,document.createTextNode(' · '));const launch=el('a','Open installed Android app');launch.href='intent://open?url='+encodeURIComponent(location.origin)+'#Intent;scheme=cncpendant;package=org.mainsailcnc.pendant;end';appLinks.append(launch);m.insert(appLinks);const timeout=$('#lowrider-stepper-timeout-row');if(timeout){m.insert(timeout);m.dialog.addEventListener('close',()=>$('#pendant-auxiliary').append(timeout));}try{const s=(await api('/printer/objects/query?toolhead')).status.toolhead,inputs={};for(const [key,label,min,max] of [['max_velocity','Velocity mm/s',1,1000],['max_accel','Acceleration mm/s²',1,50000],['square_corner_velocity','Corner velocity mm/s',0,100],['minimum_cruise_ratio','Minimum cruise ratio',0,1]]){const row=el('label',label,'dialog-field'),value=el('input');value.type='number';value.min=min;value.max=max;value.step='any';value.value=s[key]??'';value.setAttribute('aria-label',label);if(s[key]===undefined)value.disabled=true;row.append(value);inputs[key]={value,min,max};m.insert(row);}m.insert(el('p','Session changes only; printer.cfg is not rewritten.'));
        m.add('Apply session limits',async()=>{await idle();const names={max_velocity:'VELOCITY',max_accel:'ACCEL',square_corner_velocity:'SQUARE_CORNER_VELOCITY',minimum_cruise_ratio:'MINIMUM_CRUISE_RATIO'},params=[];for(const [key,{value,min,max}] of Object.entries(inputs)){if(value.disabled)continue;const n=Number(value.value);if(!value.value.trim()||!Number.isFinite(n)||n<min||n>max)throw Error('Check '+key);params.push(names[key]+'='+n);}await command('SET_VELOCITY_LIMIT '+params.join(' '));m.feedback.textContent='Session limits applied.';});}catch(error){m.feedback.textContent=error.message;}
    },
    async macros(){
      const m=modal('Advanced macros');m.insert(el('p','Macros may move the machine and bypass pendant jog clearance/keep-out checks. Review before running.'));const filter=el('input');filter.placeholder='Filter macros';filter.setAttribute('aria-label','Filter macros');filter.style.width='100%';m.insert(filter);const list=el('div',undefined,'macro-list');m.insert(list);
      try{const [objects,help]=await Promise.all([api('/printer/objects/list'),api('/printer/gcode/help')]);const names=objects.objects.filter(n=>n.startsWith('gcode_macro ')).map(n=>n.slice(12)).filter(n=>!n.startsWith('_')&&!['PAUSE_BASE','RESUME_BASE','CANCEL_PRINT_BASE','CNC_PAUSE_BASE_ORIGINAL','CNC_PAUSE_CAPTURE_XY','CNC_RESUME_ORDERED'].includes(n)).sort();const render=()=>{list.replaceChildren();for(const name of names.filter(n=>n.toLowerCase().includes(filter.value.toLowerCase()))){const b=el('button',name.replaceAll('_',' '));b.append(el('small',help[name]||''));b.addEventListener('click',()=>{const confirm=modal('Run '+name+'?');confirm.insert(el('p',help[name]||'Review this macro before running.'));confirm.add('Run macro',async()=>{await idle();await command(name);confirm.dialog.close();m.feedback.textContent='Sent '+name;});});list.append(b);}};filter.addEventListener('input',render);render();}catch(error){m.feedback.textContent=error.message;}
    },
    async console(){
      const m=modal('Console / commands'),log=el('pre','','console-output');log.setAttribute('aria-label','Console output');m.insert(log);const form=el('form',undefined,'console-entry'),input=el('input'),send=el('button','Send');input.placeholder='Send G-code…';input.setAttribute('aria-label','Send G-code');input.autocomplete='off';send.type='submit';form.append(input,send);m.insert(form);m.insert(el('p','Console commands bypass pendant jog guards. Open Home for endstop states.'));const diagnostic=$('.macrogroup_lowrider-endstops_panel');if(diagnostic){const refresh=diagnostic.querySelector('#lowrider-endstop-refresh');if(refresh)refresh.style.display='none';m.insert(diagnostic);}let timer;
      const update=async()=>{if(!m.dialog.open)return;try{const messages=(await api('/server/gcode_store?count=80')).gcode_store;const bottom=log.scrollTop+log.clientHeight>=log.scrollHeight-30;log.textContent=messages.map(e=>new Date(e.time*1000).toLocaleTimeString()+' '+e.message).join('\n');if(bottom)log.scrollTop=log.scrollHeight;}catch(error){m.feedback.textContent=error.message;}if(m.dialog.open)timer=setTimeout(update,1200);};
      form.addEventListener('submit',async event=>{event.preventDefault();const script=input.value.trim();if(!script||send.disabled)return;send.disabled=true;try{await command(script);input.value='';}catch(error){m.feedback.textContent=error.message;}finally{send.disabled=false;}});m.dialog.addEventListener('close',()=>{clearTimeout(timer);if(diagnostic)$('#pendant-auxiliary').append(diagnostic);});update();
    }
  };
  document.querySelectorAll('[data-pendant-dialog]').forEach(b=>b.addEventListener('click',()=>sections[b.dataset.pendantDialog]()));
  const topStop=$('#pendant-estop');if(topStop)topStop.addEventListener('click',emergencyStop);
  const fullscreen=$('#pendant-fullscreen');
  if(fullscreen){
    const fullscreenLabel=()=>{const on=!!document.fullscreenElement;fullscreen.textContent=on?'Exit full screen':'Full screen';fullscreen.setAttribute('aria-label',on?'Exit full screen':'Enter full screen');queueFit();};
    fullscreen.addEventListener('click',async()=>{
      try{
        if(document.fullscreenElement)await document.exitFullscreen();
        else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen({navigationUI:'hide'});
        else throw Error('This browser does not offer page full screen. Open the pendant in a browser that supports full screen, or use its full-screen menu option.');
      }catch(error){const m=modal('Full screen');m.insert(el('p',error.message||'The browser did not allow full screen. Try opening the pendant directly in your Android browser.'));}
      fullscreenLabel();
    });
    document.addEventListener('fullscreenchange',fullscreenLabel);fullscreenLabel();
  }
  new MutationObserver(()=>{arrangePendant();for(const dialog of document.querySelectorAll('dialog')){if(!dialog.querySelector('.pendant-stop'))dialog.prepend(stopButton());if(dialog.querySelector('h3')?.textContent==='Home axes')homeEndstops(dialog);}const panel=$('.toolhead-control-panel');if(panel&&!fitted){new ResizeObserver(queueFit).observe(panel);fitted=true;}queueFit();}).observe(document.documentElement,{childList:true,subtree:true});queueFit();
})();


