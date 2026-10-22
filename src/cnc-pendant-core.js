/* LowRider local Mainsail customization: light macros in Miscellaneous. */
(() => {
  'use strict';
  const id = 'lowrider-light-macros';
  const actions = [
    ['Off', 'LED_OFF'],
    ['On 70%', 'LED_ON'],
    ['On 100%', 'LED_ON\nSET_LED LED=work_lights WHITE=1.0 SYNC=0'],
    ['Breathe', 'LED_BREATHE'],
    ['Stop Breathe', 'LED_BREATHE_STOP'],
  ];
  let homingPending = false;
  let controlStatus = null;
  let jogSpeed = 50;
  let jogScale = 'coarse';
  let jogQueue = Promise.resolve();
  let lightAdjustmentQueue = Promise.resolve();
  let jogRequests=0;
  function queueJog(action) {
    jogRequests++;document.documentElement.dataset.jogRequests=String(jogRequests);updateMotionNotice(controlStatus);const toggle=document.getElementById('pendant-coordinate-units');if(toggle)toggle.disabled=true;
    const next = jogQueue.then(action).finally(()=>{jogRequests--;document.documentElement.dataset.jogRequests=String(jogRequests);updateMotionNotice(controlStatus);if(toggle)toggle.disabled=jogRequests>0;});
    jogQueue = next.catch(() => {});
    return next;
  }
  let allowBelowZ5 = false;
  let belowZ5Cap = window.CncSettings?.get("belowZ5Cap") || 30;
  let safeJogZ = Number(window.CncSettings?.get('safeJogZ') ?? 5);
  if(!Number.isFinite(safeJogZ)||safeJogZ<0||safeJogZ>109)safeJogZ=5;
  let lastWorkZ = null;
  let jogReference = null;
  let forcedSending=false,forcedWasEnabled=false;
  let forceMotors={Y:[true,true],Z:[true,true]},singleMotorConfirmed={Y:false,Z:false};
  function forcedEnabled(status=controlStatus){return !!status?.cnc_force_jog?.enabled;}
  function forcedAxis(axis,status=controlStatus){return forcedEnabled(status)&&!status?.toolhead?.homed_axes?.includes(axis.toLowerCase());}
  function forceSpec(axis,step){
    const n=Math.abs(step);
    if(n===(axis==='Z'?25:100))return axis==='X'?{hidden:true}:{motor:axis==='Y'?(step>0?0:1):(step<0?0:1)};
    if(n===.1)return {hidden:true};
    return {distance:Math.sign(step)*(n===10?1:.1)};
  }
  function forceSelection(axis){const selected=forceMotors[axis]||[true];return selected.every(Boolean)?'both':selected[0]?'primary':selected[1]?'secondary':null;}
  async function toggleForceMotor(axis,index){
    if(forcedSending||controlStatus?.cnc_force_jog?.busy)return;
    const next=forceMotors[axis].slice();next[index]=!next[index];
    if(next.filter(Boolean).length===1&&!singleMotorConfirmed[axis]){
      const modal=cncDialog('Move one gantry motor?');const note=document.createElement('p');note.textContent=`Moving only one ${axis} motor can tilt or rack the gantry. Use only for deliberate alignment. The excluded motor stays energized to hold. Physical min/max labels have not been verified; controls use ${axis} and ${axis}1.`;modal.dialog.append(note);
      modal.add('Enable individual motor control',()=>{singleMotorConfirmed[axis]=true;forceMotors[axis]=next;modal.dialog.close();refreshJogChoices();updateAvailability();},'#b71c1c');modal.add('Cancel',()=>modal.dialog.close());modal.open();return;
    }
    forceMotors[axis]=next;refreshJogChoices();updateAvailability();
  }
  async function setForcedMode(enabled){
    try{await runCncCommand(`CNC_FORCE_MODE ENABLE=${enabled?1:0}${enabled?' CONFIRM=1':''}`);await refreshForceStatus();}
    catch(error){homingNotice(error.message);}
  }
  function showForcedWarning(){
    const modal=cncDialog('Forced unhomed motion');const note=document.createElement('p');note.textContent='Position and travel limits are UNKNOWN on unhomed axes. Safe Z and keep-out clearance cannot be verified there. Forced buttons move only 0.1 or 1 mm at 1 mm/s, one move per press. Homed axes retain travel checks; unknown clearance is treated conservatively. Any homing, restart or motor disable exits this mode.';modal.dialog.append(note);
    modal.add('I understand — enable forced motion',()=>{modal.dialog.close();setForcedMode(true);},'#b71c1c');modal.add('Cancel',()=>modal.dialog.close());modal.open();
  }
  async function refreshForceStatus(){
    const response=await fetch('/printer/objects/query?webhooks&cnc_force_jog&toolhead&gcode_move&print_stats&pause_resume&virtual_sdcard&idle_timeout',{cache:'no-store'});const data=await response.json();if(!response.ok||!data.result?.status)throw Error('Forced-motion status unavailable');controlStatus={...controlStatus,...data.result.status};updateAndroidStatus(controlStatus);refreshJogChoices();updateAvailability();
  }
  async function sendForcedJog(axis,distance){
    if(forcedSending||controlStatus?.cnc_force_jog?.busy)return;
    forcedSending=true;updateAvailability();
    try{
      await refreshForceStatus();const status=controlStatus;
      if(!forcedAxis(axis,status))throw Error('Axis is homed or forced motion is off');
      const reason=manualMotionReason(status);if(reason)throw Error(reason);
      const selection=forceSelection(axis);if(!selection)throw Error('Select at least one motor to move');
      const response=await fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:`CNC_FORCE_JOG AXIS=${axis} DISTANCE=${distance} TOKEN=${status.cnc_force_jog.sequence} MOTORS=${selection} SINGLE_CONFIRM=${singleMotorConfirmed[axis]?1:0}`})});
      const data=await response.json();if(!response.ok||data.error)throw Error(data.error?.message||'Forced move failed');
    }catch(error){homingNotice(error.message);}finally{forcedSending=false;try{await refreshForceStatus();}catch(_){}updateAvailability();}
  }
  function forcedUnavailable(button,status){
    if(forcedSending||status?.cnc_force_jog?.busy)return 'Wait for the forced move to finish';
    const reason=manualMotionReason(status);if(reason)return reason;
    const axis=button.dataset.lowriderJogAxis,spec=forceSpec(axis,Number(button.dataset.lowriderJogStep));
    if(spec.hidden)return 'Not used in forced mode';
    if(spec.motor!==undefined)return '';
    return forceSelection(axis)?'':'Select at least one motor to move';
  }
  function renderForcedButton(button,axis,step){
    button.dataset.pendantForced='true';const spec=forceSpec(axis,step);button.style.display=spec.hidden?'none':'';button.classList.remove('lowrider-force-flash');delete button.dataset.lowriderRenderedLabel;
    if(spec.hidden)return;
    if(spec.motor!==undefined){const active=forceMotors[axis][spec.motor];button.textContent=`${axis}${spec.motor?'1':''} ${active?'Move':'Hold'}`;button.style.backgroundColor=active?'#fbc02d':'#b71c1c';button.style.color=active?'#111':'#fff';button.style.fontSize='9px';button.setAttribute('aria-label',`${axis}${spec.motor?'1':''}: ${active?'Move':'Hold energized'}`);}
    else{button.textContent=`${spec.distance>0?'+':'−'}${Math.abs(spec.distance)} ${axis}`;button.style.backgroundColor='#d50000';button.style.color='white';button.style.fontSize='12px';button.classList.add('lowrider-force-flash');button.setAttribute('aria-label',`Forced ${axis} ${spec.distance} millimeters at 1 millimeter per second`);}
  }
  function layoutPendantZ(bar){
    const forced=forcedAxis('Z'),fine=jogScale==='fine'&&!forced;
    bar.style.gridTemplateColumns='minmax(0,1fr) 18px minmax(0,1fr)';
    bar.style.gridTemplateRows='repeat(3,minmax(0,1fr))';
    bar.style.gridRow='6 / span 3';
    const label=bar.querySelector('div');label.style.gridColumn='2';label.style.gridRow='1 / -1';
    bar.querySelectorAll('button').forEach(b=>{const step=Number(b.dataset.lowriderJogStep),n=Math.abs(step);b.style.gridColumn=step<0?'1':'3';const row=forced?({1:1,10:2,25:3}[n]||1):({'0.1':1,1:2,10:3,25:4}[n]||1);b.style.gridRow=String(!forced&&step>0&&n!==25?4-row:row);});
    document.getElementById('lowrider-jog-pad').dataset.pendantFine='false';
  }
  function layoutForcedZ(){
    const bar=document.getElementById('lowrider-horizontal-z');if(!bar||!forcedAxis('Z'))return;if(bar.dataset.pendantQuadrant){layoutPendantZ(bar);return;}
    bar.style.gridTemplateColumns='repeat(7,minmax(0,1fr))';bar.querySelector('div').style.gridColumn='4';
    bar.querySelectorAll('button').forEach(b=>{const step=Number(b.dataset.lowriderJogStep),n=Math.abs(step);b.style.gridColumn=String(step<0?({25:1,10:2,1:3}[n]||1):({1:5,10:6,25:7}[n]||7));});
  }
  function updateForcedDisplay(status){
    const enabled=forcedEnabled(status);
    if(enabled&&!forcedWasEnabled){forceMotors={Y:[true,true],Z:[true,true]};singleMotorConfirmed={Y:false,Z:false};}
    forcedWasEnabled=enabled;
    const caption=document.getElementById('lowrider-jog-caption');if(caption){const text=enabled?'Homed jog %':'Jog speed %';if(caption.textContent!==text)caption.textContent=text;}
    const pad=document.getElementById('lowrider-jog-pad');if(pad)pad.classList.toggle('lowrider-forced-panel',enabled);
    const home=document.getElementById('lowrider-home-dialog');if(home){home.textContent=enabled?'Home / Forced':'Home';home.style.backgroundColor=homeButtonColor(status,enabled);home.dataset.allHomed=String(status?.toolhead?.homed_axes==='xyz');}
    let banner=document.getElementById('lowrider-forced-banner');
    if(pad&&!banner){banner=document.createElement('div');banner.id='lowrider-forced-banner';banner.style.cssText='display:none;background:#b71c1c;color:white;font-size:11px;font-weight:bold;text-align:center;padding:6px;margin:4px 0';pad.before(banner);}
    if(banner){banner.style.display=enabled?'block':'none';const missing='XYZ'.split('').filter(a=>!status?.toolhead?.homed_axes?.includes(a.toLowerCase())).join(', ');banner.textContent=`FORCED UNHOMED MOTION: ${missing} — position / limits unknown; 1 mm/s. Yellow motor: Move; red: Hold.`;}
  }

  const forceStyle=document.createElement('style');forceStyle.textContent='@keyframes cncForceFlash{50%{filter:brightness(.55)}}.lowrider-force-flash:not(:disabled){animation:cncForceFlash .7s infinite}.lowrider-forced-panel{outline:3px solid #ff1744;outline-offset:2px}';document.head.append(forceStyle);
  function jogSpec(axis, step, scale) {
    const sign = Math.sign(step), size = Math.abs(step);
    if(coordinateFactor()===25.4){
      if(axis==='Z'&&size===25)return {hidden:true};
      if(scale==='fine')return {distance:sign*(axis==='Z'?({'0.1':.001,1:.01,10:.1}[size]):({1:.001,10:.01,100:.1}[size]))*25.4};
      if(size===(axis==='Z'?10:100))return {limit:sign>0?'max':'min'};
      return {distance:sign*(size===(axis==='Z'?.1:1)?.1:1)*25.4};
    }
    if (scale === 'fine') return axis==='Z'&&size===25?{hidden:true}:{distance:axis === 'Z' ? step : step / 10};
    if (axis !== 'Z') return size === 100 ? {limit:sign > 0 ? 'max' : 'min'} : {distance:sign * (size === 1 ? 10 : 100)};
    if (size === 25) return {hidden:true};
    return size === 10 ? {limit:sign > 0 ? 'max' : 'min'} : {distance:sign * (size === 0.1 ? 10 : 25)};
  }
  function syncJogReference(status) {
    const gm = status.gcode_move;
    const key = JSON.stringify([status.toolhead.homed_axes,gm.position.slice(0,3).map((p,i)=>Number((p-gm.gcode_position[i]).toFixed(6)))]);
    if (jogReference !== null && key !== jogReference) allowBelowZ5 = false;
    const z=gm.gcode_position[2];
    if(lastWorkZ!==null && lastWorkZ<=safeJogZ && z>safeJogZ) allowBelowZ5=false;
    lastWorkZ=z;
    jogReference = key;
  }
  function plannedJog(axis, step, speed, scale, status) {
    const spec = jogSpec(axis,step,scale);
    if (spec.hidden) throw new Error('Step unavailable in Coarse mode');
    const i = 'XYZ'.indexOf(axis), gm = status.gcode_move;
    const target = spec.limit ? status.toolhead[spec.limit === 'max' ? 'axis_maximum' : 'axis_minimum'][i] - (gm.position[i]-gm.gcode_position[i]) : gm.gcode_position[i] + spec.distance;
    const distance = target - gm.gcode_position[i];
    return {distance,target,script:jogCommand(axis,target,status,speed)};
  }
  function jogCommand(axis,target,status,selected=jogSpeed) {
    const gm=status.gcode_move,z=gm.gcode_position[2],base=axis==='Z'?1500:12000;
    const command=(value,percent)=>`_CLIENT_LINEAR_MOVE ${axis}=${Number(value.toFixed(6))} F=${Number((base*percent/100/Math.max(.01,gm.speed_factor||1)).toFixed(3))} ABSOLUTE=1`;
    if(axis==='Z'&&z<safeJogZ&&target>safeJogZ){
      return command(safeJogZ,Math.min(selected,belowZ5Cap))+'\n'+command(target,selected);
    }
    return command(target,effectiveJogPercent(axis,target,status,selected));
  }
  function effectiveJogPercent(axis,target,status,selected=jogSpeed) {
    if(!status.toolhead.homed_axes.includes('z'))return forcedEnabled(status)?Math.min(selected,belowZ5Cap):selected;
    const z=status.gcode_move.gcode_position[2];
    return Math.min(z<safeJogZ || (axis==='Z' && target<safeJogZ) ? belowZ5Cap : 100,selected);
  }
  function needsClearanceConfirm(axis,move,status) {
    if(forcedEnabled(status)&&!status.toolhead.homed_axes.includes('z'))return false;
    return !(axis==='Z' && move.distance>0) && (axis==='Z'?move.target:status.gcode_move.gcode_position[2])<safeJogZ;
  }
  function clearanceReason(axis, move, status, allowed) {
    return status.toolhead.homed_axes.includes('z')||forcedEnabled(status) ? '' : 'Home Z before using guarded jogging';
  }
  function confirmClearance(axis,move,status) {
    return new Promise(resolve=>{
      const z=axis==='Z'?move.target:status.gcode_move.gcode_position[2];
      const modal=cncDialog(`Move tool to work ${axis} ${move.target.toFixed(2)} mm?`);
      const detail=document.createElement('p');detail.textContent=`Work Z will be ${z.toFixed(2)} mm, below the Z${safeJogZ} clearance. Check the tool and workpiece before moving. Jog speed is capped at ${effectiveJogPercent(axis,move.target,status)}%.`;modal.dialog.append(detail);
      let approved=false;modal.dialog.addEventListener('close',()=>resolve(approved),{once:true});
      modal.add('Move',()=>{approved=true;modal.dialog.close();},'#b71c1c');modal.add('Cancel',()=>modal.dialog.close());modal.open();
    });
  }
  function travelLimitReason(axis,move,status) {
    const i='XYZ'.indexOf(axis),gm=status.gcode_move;
    const machine=move.target+gm.position[i]-gm.gcode_position[i];
    if(machine<status.toolhead.axis_minimum[i]-0.000001||machine>status.toolhead.axis_maximum[i]+0.000001)return `${axis} move exceeds the configured travel range`;
    if(Math.abs(move.distance)<0.000001)return `${axis} is already at that limit`;
    return keepoutReason(axis,move,status);
  }
  let keepoutBlocks=[];
  async function loadKeepout() {
    const response=await fetch('/server/database/item?namespace=lowrider&key=keepout',{cache:'no-store',signal:AbortSignal.timeout(4000)});
    if(response.status===404){keepoutBlocks=[];return;}
    const data=await response.json();
    if(!response.ok||data.error||!Array.isArray(data.result?.value))throw Error('Cannot verify keep-out settings; jog cancelled');
    keepoutBlocks=data.result.value;
    if(keepoutBlocks.some(b=>b.enabled&&!validKeepout(b)))throw Error('Invalid enabled keep-out block; jog cancelled');
  }
  function validKeepout(b){return ['xmin','xmax','ymin','ymax','safeZ','margin'].every(k=>Number.isFinite(b[k]))&&b.xmin<b.xmax&&b.ymin<b.ymax&&b.margin>=0;}
  function keepoutReason(axis,move,status) {
    const start=status.gcode_move.position.slice(0,3),end=start.slice(),i='XYZ'.indexOf(axis);
    end[i]=move.target+start[i]-status.gcode_move.gcode_position[i];
    const unknown=forcedEnabled(status)?'xyz'.split('').filter(a=>!status.toolhead.homed_axes.includes(a)):[];
    if(unknown.includes('z'))start[2]=end[2]=-1e9;
    // Always permit a straight upward escape; never lower farther into a block.
    if(axis==='Z'&&end[2]>start[2])return '';
    for(const b of keepoutBlocks){
      if(!b.enabled)continue;
      if(!validKeepout(b))return 'Invalid keep-out settings';
      const low=[b.xmin-b.margin,b.ymin-b.margin,-Infinity],high=[b.xmax+b.margin,b.ymax+b.margin,b.safeZ];
      let enter=0,exit=1;
      for(let j=0;j<3;j++){
        if(j<2&&unknown.includes('xy'[j]))continue;
        const d=end[j]-start[j];
        if(Math.abs(d)<1e-9){if(start[j]<low[j]||start[j]>high[j]){enter=2;break;}}
        else{const a=(low[j]-start[j])/d,c=(high[j]-start[j])/d;enter=Math.max(enter,Math.min(a,c));exit=Math.min(exit,Math.max(a,c));}
      }
      if(enter<=exit)return `Keep-out: ${b.name||'protected area'}. Raise above machine Z ${b.safeZ.toFixed(2)} mm before crossing.`;
    }
    return '';
  }
  async function saveKeepouts(blocks){
    const response=await fetch('/server/database/item',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({namespace:'lowrider',key:'keepout',value:blocks})});
    const data=await response.json();if(!response.ok||data.error)throw Error(data.error?.message||'Cannot save keep-out settings');keepoutBlocks=blocks;updateAvailability();
  }
  function mountKeepoutPanel(toolhead){
    if(!toolhead||document.getElementById('lowrider-keepout-panel'))return;
    const panel=document.createElement('section');panel.id='lowrider-keepout-panel';panel.className='v-card v-sheet theme--dark';panel.style.cssText='padding:14px;margin:12px 0;background:#252525;color:white';
    const heading=document.createElement('h3');heading.textContent='Keep-out areas';heading.style.cssText='font-size:15px;margin:0 0 8px';panel.append(heading);
    const note=document.createElement('p');note.textContent='Dashboard jogging only. All dimensions are machine coordinates in mm, fixed to the table. Blocks do not protect program files, console commands or homing. Clearance expands X/Y for the cutter and clamps. Changes apply to new jog commands, not moves already queued.';note.style.cssText='font-size:12px;line-height:1.4';panel.append(note);
    const rows=document.createElement('div');panel.append(rows);
    const feedback=document.createElement('div');feedback.style.cssText='font-size:12px;padding-top:6px';panel.append(feedback);
    async function render(){
      await loadKeepout();rows.replaceChildren();
      for(let index=0;index<3;index++){
        const block=keepoutBlocks[index]||{name:`Block ${index+1}`,enabled:false};
        const row=document.createElement('div');row.style.cssText='display:flex;gap:8px;align-items:center;margin-top:8px';
        const edit=document.createElement('button');edit.type='button';edit.textContent=(block.name||`Block ${index+1}`)+' - Edit';edit.style.cssText='flex:1;min-height:40px;border:1px solid #777;border-radius:4px;background:#202020;color:white';
        const toggle=document.createElement('button');toggle.type='button';toggle.textContent=block.enabled?'ON':'OFF';toggle.style.cssText=`min-width:60px;min-height:40px;border:1px solid #777;border-radius:4px;color:white;background:${block.enabled?'#b71c1c':'#333'}`;
        edit.addEventListener('click',()=>editBlock(index));
        toggle.addEventListener('click',async()=>{
          try{await loadKeepout();const current=keepoutBlocks[index]||block;
            if(!current.enabled&&!validKeepout(current)){editBlock(index);return;}
            const apply=async()=>{toggle.disabled=true;try{await loadKeepout();const next=keepoutBlocks.slice();if(!next[index])throw Error('Set block boundaries first');next[index]={...next[index],enabled:!current.enabled};await saveKeepouts(next);await render();}catch(e){feedback.textContent=e.message;}finally{toggle.disabled=false;}};
            if(current.enabled){const modal=cncDialog('Turn off keep-out protection?');const text=document.createElement('p');text.textContent=`Are you sure? Jogging will be allowed through ${current.name}.`;modal.dialog.append(text);modal.add('Yes, turn off',()=>{modal.dialog.close();apply();},'#b71c1c');modal.add('Cancel',()=>modal.dialog.close());modal.open();}else await apply();
          }catch(e){feedback.textContent=e.message;}
        });row.append(edit,toggle);rows.append(row);const summary=document.createElement('div');summary.style.cssText='font-size:11px;color:#ccc;padding:4px 0 8px';summary.textContent=Number.isFinite(block.xmin)?`X ${block.xmin} to ${block.xmax}; Y ${block.ymin} to ${block.ymax}; Safe Z: ${Number.isFinite(block.safeZ)?block.safeZ+' mm':'set before enabling'}`:'Set boundaries to use this block';rows.append(summary);
      }
    }
    async function editBlock(index){
      try{await loadKeepout();}catch(e){feedback.textContent=e.message;return;}
      const b=keepoutBlocks[index]||{name:`Block ${index+1}`,enabled:false,margin:5};const modal=cncDialog('Keep-out block');const inputs={};
      const name=document.createElement('input');name.value=b.name||`Block ${index+1}`;name.setAttribute('aria-label','Block name');name.style.cssText='width:100%;background:#202020;color:white;border:1px solid #777;padding:8px';modal.dialog.append(name);
      const grid=document.createElement('div');grid.style.cssText='display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:12px';
      for(const [key,label] of [['xmin','X min'],['xmax','X max'],['safeZ','Safe Z height'],['margin','XY clearance'],['ymin','Y min'],['ymax','Y max']]){
        const wrap=document.createElement('label');wrap.textContent=label;wrap.style.cssText='font-size:12px;min-width:0';const slots={xmin:[1,2],xmax:[3,2],safeZ:[2,2],margin:[2,4],ymin:[2,3],ymax:[2,1]};wrap.style.gridColumn=slots[key][0];wrap.style.gridRow=slots[key][1];const input=document.createElement('input');input.type='number';input.step='any';input.value=Number.isFinite(b[key])?b[key]:'';input.style.cssText='display:block;width:100%;min-height:40px;box-sizing:border-box;background:#202020;color:white;border:1px solid #777;padding:6px';inputs[key]=input;wrap.append(input);grid.append(wrap);
      }modal.dialog.append(grid);
      const detail=document.createElement('p');detail.textContent='Machine coordinates, mm. Crossing requires Z above Safe Z. Clearance should cover cutter radius plus extra space. Homing and files bypass this protection.';detail.style.fontSize='12px';modal.dialog.append(detail);
      const error=document.createElement('div');error.style.color='#ffaaaa';modal.dialog.append(error);
      const apply=async(enabled)=>{const nextBlock={name:name.value.trim()||`Block ${index+1}`,enabled};for(const [key,input] of Object.entries(inputs)){if(!input.value.trim()){error.textContent='Fill in every boundary, safe height and clearance.';return;}nextBlock[key]=Number(input.value);}
        if(!validKeepout(nextBlock)){error.textContent='Use finite numbers, minimums below maximums, and non-negative clearance.';return;}
        if(b.enabled&&!enabled){error.textContent='To turn protection off, use its ON/OFF toggle and confirmation.';return;}
        try{await loadKeepout();const next=keepoutBlocks.slice();while(next.length<=index)next.push({name:`Block ${next.length+1}`,enabled:false});next[index]=nextBlock;await saveKeepouts(next);modal.dialog.close();await render();}catch(e){error.textContent=e.message;}
      };
      modal.add(b.enabled?'Save protected block':'Save and enable',()=>apply(true),'#b71c1c');if(!b.enabled)modal.add('Save with protection off',()=>apply(false));modal.add('Cancel',()=>modal.dialog.close());modal.open();
    }
    const center=document.querySelector('.macros-panel')?.parentElement; (center||toolhead.parentElement).append(panel);
    render().catch(e=>{feedback.textContent=e.message;});
  }

  function jogMove(axis, step, speed, scale) {
    const distance = step / (axis !== 'Z' && scale === 'fine' ? 10 : 1);
    const feed = Number(((axis === 'Z' ? 1500 : 12000) * speed / 100).toFixed(3));
    return { distance, script: `_CLIENT_LINEAR_MOVE ${axis}=${distance} F=${feed}` };
  }
  function runSpeedPreset(percent){return percent<=60?50:100;}
  function refreshRunSpeedPreset(percent){
    const button=document.querySelector('[data-lowrider-run-action="half"]');if(!button)return;
    const target=runSpeedPreset(percent),label=target+'%';if(button.textContent!==label)button.textContent=label;
    button.setAttribute('aria-label',target+' percent run speed');button.title='Set Run speed to '+target+'%';
  }
  function jogBelowSafe(axis,move,status,safe){
    if(!status?.gcode_move||!status?.toolhead)return false;
    const gm=status.gcode_move,current=gm.gcode_position[2];
    if(axis!=='Z')return status.toolhead.homed_axes?.includes('z')&&current<safe;
    const target=move.limit?status.toolhead[move.limit==='min'?'axis_minimum':'axis_maximum'][2]-(gm.position[2]-current):current+move.distance;
    return target<current&&target<safe;
  }
  function refreshJogChoices() {
    const below=!!controlStatus?.toolhead?.homed_axes?.includes('z')&&controlStatus?.gcode_move?.gcode_position?.[2]<safeJogZ;
    document.querySelectorAll('[data-lowrider-position],[data-machine-position]').forEach(input=>{input.dataset.belowSafe=String(below);});
    document.querySelectorAll('[data-lowrider-jog-axis]').forEach(button => {
      const axis = button.dataset.lowriderJogAxis;
      if(forcedAxis(axis)){renderForcedButton(button,axis,Number(button.dataset.lowriderJogStep));return;}
      delete button.dataset.pendantForced;button.classList.remove('lowrider-force-flash');button.style.backgroundColor='#252525';button.style.color='#eee';button.style.fontSize='13px';
      const move = jogSpec(axis, Number(button.dataset.lowriderJogStep), jogScale);
      button.style.display = move.hidden ? 'none' : '';
      button.dataset.belowSafe=String(jogBelowSafe(axis,move,controlStatus,safeJogZ));
      const text = move.limit ? move.limit === 'max' ? 'Max' : 'Min' : `${move.distance > 0 ? '+' : '−'}${Number((Math.abs(move.distance || 0)/coordinateFactor()).toFixed(4))}`;
      if(button.dataset.lowriderRenderedLabel!==text){const main=document.createElement('span');main.textContent=text;const sub=document.createElement('sub');sub.textContent=axis;sub.style.cssText='font-size:8px;line-height:0;position:relative;bottom:-.25em;margin-left:2px';button.replaceChildren(main,sub);button.dataset.lowriderRenderedLabel=text;}
      button.title = move.limit ? `${axis} to configured ${move.limit} travel limit` : `${axis} ${Number((move.distance/coordinateFactor()).toFixed(4))} ${document.documentElement.dataset.coordinateUnit||'mm'}`;
      button.setAttribute('aria-label', `Jog ${axis} ${move.limit || Number((move.distance/coordinateFactor()).toFixed(4))} ${move.limit ? 'travel limit' : document.documentElement.dataset.coordinateUnit||'mm'}`);
    });
    document.querySelectorAll('[data-lowrider-jog-choice]').forEach(button => {
      const selected = button.dataset.lowriderJogChoice==='scale'||jogScale===button.dataset.lowriderJogChoice;if(button.dataset.lowriderJogChoice==='scale'){const text=jogScale==='coarse'?'Coarse':'Fine';if(button.dataset.pendantCenter){const unit=document.documentElement.dataset.coordinateUnit||'mm';if(button.dataset.mode!==text+unit){button.replaceChildren(Object.assign(document.createElement('span'),{textContent:'X / Y'}),Object.assign(document.createElement('small'),{textContent:text+' · '+unit}));button.dataset.mode=text+unit;}button.setAttribute('aria-label','X/Y jog increments: '+text);}else button.textContent=text;}button.title=`Switch to ${jogScale==='coarse'?'fine':'coarse'} steps (currently ${jogScale})`;
      button.style.backgroundColor = selected ? '#2e7d32' : '#202020';
      button.setAttribute('aria-pressed', String(selected));
    });
    const zBar=document.getElementById('lowrider-horizontal-z');
    if(zBar?.dataset.pendantQuadrant)layoutPendantZ(zBar);else if(zBar){zBar.style.gridTemplateColumns=`repeat(${jogScale==='coarse'?7:9},minmax(0,1fr))`;zBar.querySelector('div').style.gridColumn=jogScale==='coarse'?'4':'5';zBar.querySelectorAll('button').forEach(button=>{const step=Number(button.dataset.lowriderJogStep),n=Math.abs(step);button.style.gridColumn=String(jogScale==='coarse'?(step<0?{'.1':3,'0.1':3,'1':2,'10':1}[n]:{'0.1':5,'1':6,'10':7}[n])||1:(step<0?[25,10,1,.1].indexOf(n)+1:[.1,1,10,25].indexOf(n)+6));});}
    layoutForcedZ();
    const rate = document.getElementById('lowrider-jog-rate');
    if(rate&&document.activeElement!==rate){const effective=controlStatus?.gcode_move?effectiveJogPercent('X',0,controlStatus):jogSpeed;const text=effective<jogSpeed?`${effective}% (${jogSpeed}%)`:`${jogSpeed}%`;if(rate.value!==text)rate.value=text;}
    const rates = document.getElementById('lowrider-jog-rates');
    if(rates){
      const active=controlStatus?.gcode_move?effectiveJogPercent('X',0,controlStatus):jogSpeed;
      const number=n=>Number(n.toFixed(2)).toString();
      const text=forcedEnabled()?'XYZ'.split('').every(a=>forcedAxis(a))?'Forced jog: 1 mm/s':'XYZ'.split('').map(a=>`${a} ${forcedAxis(a)?'1':number((a==='Z'?25:200)*active/100)}`).join(' / ')+' mm/s':`XY ${number(200*active/100)} / Z ${number(25*active/100)} mm/s`;
      if(rates.textContent!==text)rates.textContent=text;
      rates.style.display='block';rates.title='Commanded jog speeds after the safe-height cap; acceleration may reduce speed during short moves.';
    }
    document.querySelectorAll('[data-lowrider-rate-action]').forEach(button => {
      const lower = ['minus','min'].includes(button.dataset.lowriderRateAction);
      button.disabled = button.dataset.lowriderRateAction==='half' ? jogSpeed===50 : lower ? jogSpeed <= 10 : jogSpeed >= 100;
    });
    const guard = document.getElementById('lowrider-z5-allow');
    if (guard) {
      guard.textContent = allowBelowZ5 ? 'Below safe Z\nAllowed' : 'Below safe Z\nLocked';
      guard.title = `Unlock dashboard jogging below work Z${safeJogZ} mm. Relocks above that height, on homing, or when work zeros change. Upward escape remains available.`;
      guard.style.backgroundColor = allowBelowZ5 ? '#b71c1c' : '#2e7d32';
      guard.setAttribute('aria-pressed',String(allowBelowZ5));
    }
  }
  function mountJogPad(toolhead, homes) {
    if (!toolhead.querySelector('#lowrider-xy-cross') || toolhead.querySelector('#lowrider-jog-pad')) return;
    const previous = toolhead.querySelector('#lowrider-xy-cross');
    previous.style.display='none';const container=previous.closest('.container');if(container){container.style.paddingTop='0';container.style.paddingBottom='0';}
    const zHome = homes.find(button => button.textContent.trim() === 'Z');
    const zRow = zHome?.closest('.row--dense');
    if (zRow) zRow.style.display = 'none';
    const pad = document.createElement('div');
    pad.id = 'lowrider-jog-pad';
    pad.setAttribute('role', 'group'); pad.setAttribute('aria-label', 'CNC jog controls');
    pad.style.cssText = 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:0px repeat(7,32px) 0px;gap:3px;margin:0';
    const label = (text, column) => {
      const item = document.createElement('div'); item.textContent = text;item.id='pendant-old-xy-label';
      item.style.cssText = `grid-column:${column};grid-row:5;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px`;
      pad.append(item);
    };
    label('X / Y', 4);
    const zBar=document.createElement('div');zBar.id='lowrider-horizontal-z';zBar.setAttribute('role','group');zBar.setAttribute('aria-label','Z jogging');zBar.style.cssText='display:grid;grid-template-columns:repeat(9,minmax(0,1fr));gap:3px;margin:4px 0';
    const zLabel=document.createElement('div');zLabel.textContent='Z';zLabel.style.cssText='grid-column:5;grid-row:1;display:flex;align-items:center;justify-content:center;font-weight:bold';zBar.append(zLabel);
    function addJog(axis, step, column, row) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'lowrider-jog-button';
      button.dataset.lowriderJogAxis = axis; button.dataset.lowriderJogStep = String(step);
      button.style.cssText = `grid-column:${column};grid-row:${row};min-width:0;font-size:13px;background:#252525;color:#eee;border:1px solid #444;border-radius:3px`;
      button.addEventListener('click', () => {
        if(forcedAxis(axis)){const spec=forceSpec(axis,step);if(spec.motor!==undefined)toggleForceMotor(axis,spec.motor);else if(!spec.hidden)sendForcedJog(axis,spec.distance);return;}
        if(forcedSending||controlStatus?.cnc_force_jog?.busy)return;
        return queueJog(async () => {
        if (homingPending) return;
        try {
          await loadKeepout();
          const response = await fetch('/printer/objects/query?webhooks&print_stats&pause_resume&virtual_sdcard&idle_timeout&toolhead&gcode_move&cnc_force_jog', {cache:'no-store',signal:AbortSignal.timeout(5000)});
          const status = (await response.json()).result?.status;
          if (!response.ok || status?.webhooks?.state !== 'ready') throw new Error('Klipper is not ready');
          const unavailable=manualMotionReason(status,true);if(unavailable)throw new Error(unavailable);
          if (!status.toolhead.homed_axes.includes(axis.toLowerCase())) throw new Error(`Home ${axis} before jogging`);
          syncJogReference(status);
          let move = plannedJog(axis,step,jogSpeed,jogScale,status);
          const limit=travelLimitReason(axis,move,status);if(limit)throw new Error(limit);
          const blocked = clearanceReason(axis,move,status,allowBelowZ5);
          if (blocked) throw new Error(blocked);
          if(needsClearanceConfirm(axis,move,status)&&!allowBelowZ5){
            if(!await confirmClearance(axis,move,status))return;
            return await sendDirectJog(axis,move.target,true);
          }
          const sent = await fetch('/printer/gcode/script', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:move.script})});
          const result = await sent.json();
          if (!sent.ok || result.error) throw new Error(result.error?.message || 'Jog command failed');
        } catch (error) { homingNotice(`Jog: ${error.message}`); }
        finally {  refreshJogChoices(); updateAvailability(); }
      });});
      if(axis==='Z'){const n=Math.abs(step),sign=Math.sign(step);const col=sign<0?[25,10,1,.1].indexOf(n)+1:[.1,1,10,25].indexOf(n)+6;button.style.gridColumn=String(col);button.style.gridRow='1';button.style.minHeight='32px';zBar.append(button);}else pad.append(button);
    }
    [100,10,1].forEach((step,i) => { addJog('X',-step,i+1,5); addJog('Y',step,4,i+2); });
    [1,10,100].forEach((step,i) => { addJog('X',step,i+5,5); addJog('Y',-step,4,i+6); });
    [25,10,1,0.1].forEach((step,i) => addJog('Z',step,9,i+1));
    [0.1,1,10,25].forEach((step,i) => addJog('Z',-step,9,i+6));
    const rateBox = document.createElement('div');
    rateBox.setAttribute('role', 'group'); rateBox.setAttribute('aria-label', 'Jog speed adjustment');
    rateBox.title='Active jog percentage; selected percentage in parentheses when capped. Tap to edit the selected value.';
    rateBox.style.cssText = 'grid-column:1/span 3;grid-row:2/span 3;align-self:center;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;padding:0 3px';
    const caption = document.createElement('div');caption.id='lowrider-jog-caption'; caption.textContent = 'Jog speed %';
    caption.style.cssText = 'grid-column:1/-1;text-align:center;font-size:11px;opacity:.8';
    const value = document.createElement('input'); value.id='lowrider-jog-rate';value.type='text';value.inputMode='decimal';value.setAttribute('aria-label','Jog speed percent: active, selected in parentheses');value.addEventListener('focus',()=>{value.value=String(jogSpeed);value.select();});
    value.title='Jog percentage, 10 to 100';value.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();value.blur();}});value.addEventListener('blur',()=>{const rate=Number(value.value.replace(/%/g,'').trim());if(Number.isFinite(rate)&&rate>=10&&rate<=100){jogSpeed=rate;saveShared('jogSpeed',rate);}else homingNotice('Enter a jog percentage from 10 to 100.');refreshJogChoices();});
    value.style.cssText = 'grid-column:2/span 2;grid-row:2;width:100%;min-width:0;text-align:center;font-size:12px;font-weight:bold;background:#202020;color:inherit;border:1px solid #777;border-radius:3px';
    const rates = document.createElement('div'); rates.id = 'lowrider-jog-rates';
    rates.style.cssText = 'grid-column:1/-1;grid-row:4;text-align:center;font-size:9px;opacity:.8;white-space:nowrap';
    rateBox.append(caption,value,rates);
    for (const [action,label,column,row] of [['minus','▼','1','2'],['plus','▲','4','2'],['min','Min','1','3'],['half','50%','2 / span 2','3'],['max','Max','4','3']]) {
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.lowriderRateAction = action; button.textContent = label;
      button.setAttribute('aria-label', `${action === 'minus' ? 'Decrease' : action === 'plus' ? 'Increase' : action === 'min' ? 'Minimum' : action==='half'?'50 percent':'Maximum'} jog speed`);
      if(action==='minus'||action==='plus')button.title=`${action==='minus'?'Decrease':'Increase'} jog speed by 1 percentage point`;
      button.style.cssText = `grid-column:${column};grid-row:${row};background:#202020;color:#fff;border:1px solid #777;border-radius:3px;min-height:25px;font-size:12px`;
      button.addEventListener('click', () => {
        jogSpeed = action === 'half' ? 50 : action === 'min' ? 10 : action === 'max' ? 100 : Math.max(10,Math.min(100,jogSpeed+(action === 'plus' ? 1 : -1)));
        saveShared('jogSpeed',jogSpeed);refreshJogChoices();
      });
      rateBox.append(button);
    }
    pad.append(rateBox);
    const stepBox = document.createElement('div');
    stepBox.style.cssText = 'grid-column:1/span 3;grid-row:6/span 3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px';
    pad.append(stepBox);
    for (const [name,column,row] of [['coarse',1,7]]) {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.lowriderJogChoice = 'scale';button.id='lowrider-scale-toggle';
      button.textContent = name[0].toUpperCase()+name.slice(1);
      button.style.cssText = 'width:90%;max-width:100px;min-height:28px;color:#fff;border:1px solid #777;border-radius:4px;font-size:12px;font-weight:600';
      button.title = name === 'fine' ? 'X/Y steps divided by 10' : 'Full X/Y step distances';
      button.addEventListener('click', () => {
        jogScale = jogScale==='coarse'?'fine':'coarse';saveShared('jogScale',jogScale);
        refreshJogChoices(); updateAvailability();
      });
      stepBox.append(button);
    }
    const guard = document.createElement('button');
    guard.type = 'button'; guard.id = 'lowrider-z5-allow';
    guard.title = 'Unlock dashboard jogging below work Z5. Relocks above work Z5, on homing, or when work zeros change. Upward escape remains available.';
    guard.style.cssText = 'width:100%;min-height:28px;color:#fff;border:1px solid #777;border-radius:4px;font-size:9px;font-weight:bold';
    guard.addEventListener('click', () => {
      if (!controlStatus || !controlStatus.toolhead.homed_axes.includes('z') || manualMotionReason(controlStatus)) {
        homingNotice('Home Z and pause or stop the job before unlocking below-safe-height jogging.');return;
      }
      allowBelowZ5 = !allowBelowZ5;refreshJogChoices();updateAvailability();
    });
    guard.style.minHeight="32px";stepBox.append(guard);
    previous.before(pad,zBar);
    refreshJogChoices(); updateAvailability();
  }
  document.addEventListener('click', event => {
    const blocked = event.target.closest?.('button[data-lowrider-unavailable]');
    if (blocked) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  function isMachinePaused(status) {return !!status?.pause_resume?.is_paused;}
  function motionStillQueued(status) {
    if(status?.idle_timeout?.state!=='Printing')return false;
    const tool=status.toolhead;
    // Idle status deliberately lags actual completion; compare MCU motion time.
    if(!Number.isFinite(tool?.print_time)||!Number.isFinite(tool?.estimated_print_time))return true;
    return tool.print_time+0.05>tool.estimated_print_time;
  }
  function manualMotionReason(status, allowQueuedJog=false) {
    if(globalThis.window?.CncPreflight?.isReturning?.())return 'Wait for the Resume return to finish';
    if(window.CncSettings&&!window.CncSettings.ready)return 'Loading shared machine settings';if(status?.webhooks?.state!=='ready')return 'Klipper is not ready';
    if(homingPending||(!allowQueuedJog&&motionStillQueued(status)))return 'Wait for motion or the pause lift to finish';
    if(status.virtual_sdcard?.is_active)return 'Pause the running file before jogging or setting tool zero';
    if(status.print_stats?.state==='printing'&&!isMachinePaused(status))return 'Pause the job before jogging or setting tool zero';
    if(status.print_stats?.state==='paused'&&!isMachinePaused(status))return 'Wait for pause to finish';
    return '';
  }
  function controlUnavailable(button, status) {
    if (!status || status.webhooks?.state !== 'ready') return 'Klipper is not ready';
    if(button.dataset?.lowriderJogAxis&&(forcedSending||status.cnc_force_jog?.busy))return 'Wait for forced motion to finish';
    if(button.dataset?.lowriderJogAxis&&forcedAxis(button.dataset.lowriderJogAxis,status))return forcedUnavailable(button,status);
    if(button.dataset?.lowriderJogAxis){const reason=manualMotionReason(status,true);if(reason)return reason;}
    else if (homingPending || ['printing', 'paused'].includes(status.print_stats?.state) || status.pause_resume?.is_paused || motionStillQueued(status)) {
      return 'Unavailable while moving, running, or paused';
    }
    const name = button.textContent.trim().replace(/\s+/g, ' ');
    if (button.dataset?.lowriderJogAxis) {
      const axis = button.dataset.lowriderJogAxis;
      if (!status.toolhead.homed_axes.includes(axis.toLowerCase())) return 'Home this axis before jogging';
      if (status.gcode_move) {
        const spec = jogSpec(axis,Number(button.dataset.lowriderJogStep),jogScale);
        if (spec.hidden) return 'Not used in Coarse mode';
        const move=plannedJog(axis,Number(button.dataset.lowriderJogStep),jogSpeed,jogScale,status);
        const limit=travelLimitReason(axis,move,status);if(limit)return limit;
        const reason = clearanceReason(axis,move,status,allowBelowZ5);
        if (reason) return reason;
      }
    }
    const homeCommand = button.dataset?.lowriderHomeCommand || button.dataset?.lowriderQuickHome || (name.startsWith('HOME ') ? name.replace(/ /g,'_') : '');
    if (homeCommand) {
      const axes = homeCommand === 'HOME_ALL' ? 'xyz' : homeCommand.slice(5).toLowerCase();
      if ([...axes].every(axis => status.toolhead.homed_axes.includes(axis))) return 'Already homed';
    }
    if (button.hasAttribute('data-lowrider-disable-steppers')) {
      if (!Object.values(status.stepper_enable?.steppers || {}).some(Boolean)) return 'Steppers are already disabled';
    }
    if (name.startsWith('ZERO ')) {
      const axes = name === 'ZERO ALL' ? 'xyz' : name.slice(5).toLowerCase();
      if ([...axes].some(axis => !status.toolhead.homed_axes.includes(axis))) return 'Home this axis before setting work zero';
    }
    return '';
  }
  function updateAvailability() {
    document.querySelectorAll('.macrogroup_lowrider-zero_panel .v-card__text button, .macrogroup_lowrider-homing_panel .v-card__text button, button[data-lowrider-shake], button[data-lowrider-jog-axis], button[data-lowrider-disable-steppers]').forEach(button => {
      const reason = controlUnavailable(button, controlStatus);
      button.disabled = !!reason;
      if (reason) {
        button.setAttribute('data-lowrider-unavailable', 'true');
        button.setAttribute('aria-disabled', 'true');
        button.title = reason;
      } else {
        button.removeAttribute('data-lowrider-unavailable');
        button.removeAttribute('aria-disabled');
        button.removeAttribute('title');
      }
    });
  }
  function homingNotice(message, diagnostic = false) {
    const panel = document.querySelector(diagnostic ? '.macrogroup_lowrider-endstops_panel' : '.toolhead-control-panel');
    if (!panel) return;
    let notice = panel.querySelector('.lowrider-command-status');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'lowrider-command-status';
      notice.setAttribute('role', 'status');
      notice.style.cssText = 'padding:8px 16px;font-size:13px';
      panel.append(notice);
    }
    if(!notice.querySelector('.cnc-current-message')){
      notice.replaceChildren();const current=document.createElement('div');current.className='cnc-current-message';
      const details=document.createElement('details'),summary=document.createElement('summary'),history=document.createElement('div');
      summary.textContent='Message history';history.className='cnc-message-history';history.setAttribute('aria-label','Command message history');details.append(summary,history);details.hidden=true;notice.append(current,details);
    }
    archiveCommandMessage(notice);const current=notice.querySelector('.cnc-current-message');current.textContent=message;current.hidden=!message;
  }
  function archiveCommandMessage(notice){
    const current=notice.querySelector('.cnc-current-message'),history=notice.querySelector('.cnc-message-history');if(!current?.textContent||!history)return;
    const bottom=history.scrollTop+history.clientHeight>=history.scrollHeight-20;
    const entry=document.createElement('div');entry.textContent=new Date().toLocaleTimeString()+' · '+current.textContent;history.append(entry);while(history.children.length>100)history.firstChild.remove();history.parentElement.hidden=false;
    current.textContent='';current.hidden=true;if(bottom)history.scrollTop=history.scrollHeight;
  }
  document.addEventListener('cnc-command-start',()=>document.querySelectorAll('.lowrider-command-status').forEach(archiveCommandMessage));
  function homeButtonColor(status,forced){return forced?'#b71c1c':status?.toolhead?.homed_axes==='xyz'?'#2e7d32':'#1976d2';}
  async function freshHomeStatus(){
    const response=await fetch('/printer/objects/query?print_stats&pause_resume&idle_timeout&webhooks&toolhead&gcode_move&virtual_sdcard',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const status=(await response.json()).result?.status;
    if(!response.ok||status?.webhooks?.state!=='ready')throw Error('Klipper is not ready.');
    controlStatus={...controlStatus,...status};updateAvailability();return status;
  }
  async function runHomeCommand(command,shake=false){
    const notify=message=>homingNotice(message,!!shake),action=command.replace(/_/g,' ');
    if(homingPending){notify('A homing or shake test is already in progress.');return;}
    homingPending=true;updateAvailability();notify('Checking machine...');
    try{
      const state=await freshHomeStatus();
      if(['printing','paused'].includes(state.print_stats.state)||state.pause_resume?.is_paused||state.virtual_sdcard?.is_active||motionStillQueued(state))throw Error('Homing and shake tests are blocked while moving, running, or paused.');
      if(!shake){const axes=command==='HOME_ALL'?'xyz':command.slice(5).toLowerCase();if([...axes].every(axis=>state.toolhead.homed_axes.includes(axis)))throw Error('Already homed. Disable steppers first if you intend to re-home.');}
      const pending=fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:command})});
      notify(`${action} in progress...`);
      const response=await pending;
      const result=await response.json();if(!response.ok||result.error)throw Error(result.error?.message||'Homing command failed.');
      notify(`${action} complete.`);
    }catch(error){notify(`Command not completed: ${error.message}`);}
    finally{homingPending=false;updateAvailability();}
  }
  document.addEventListener('click', event => {
    const button = event.target.closest?.('.macrogroup_lowrider-homing_panel button, button[data-lowrider-shake], button[data-lowrider-disable-steppers]');
    const shake = button?.dataset?.lowriderShake;
    const disable = button?.hasAttribute('data-lowrider-disable-steppers');
    if (disable) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (homingPending) { homingNotice('A motion command is already in progress.'); return; }
      homingPending = true;
      (async () => {
        try {
          const response = await fetch('/printer/objects/query?print_stats&pause_resume&idle_timeout&webhooks', {cache:'no-store',signal:AbortSignal.timeout(5000)});
          const state = (await response.json()).result?.status;
          if (!response.ok || state?.webhooks?.state !== 'ready') throw new Error('Klipper is not ready.');
          if (['printing','paused'].includes(state.print_stats.state) || state.pause_resume?.is_paused || state.idle_timeout.state === 'Printing') {
            throw new Error('Disable Steppers is blocked while the machine is active or a job is paused.');
          }
          const sent = await fetch('/printer/gcode/script', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:'M84'})});
          const result = await sent.json();
          if (!sent.ok || result.error) throw new Error(result.error?.message || 'Disable command failed');
          homingNotice('Steppers disabled. Home again and recheck work zeros before cutting.');
        } catch (error) { homingNotice(error.message); }
        finally { homingPending = false;  }
      })();
      return;
    }
    const command = shake ? `STEPPER_BUZZ STEPPER=${shake}` : button?.dataset?.lowriderHomeCommand || button?.textContent.trim().replace(/\s+/g, '_');
    if (!shake && !['HOME_ALL', 'HOME_X', 'HOME_Y', 'HOME_Z', 'HOME_ZX'].includes(command)) return;
    const action = shake ? button.textContent.trim() : command.replace(/_/g, ' ');
    const notify = message => homingNotice(message, !!shake);
    event.preventDefault();
    event.stopImmediatePropagation();
    if (homingPending) { notify('A homing or shake test is already in progress.'); return; }
    if (document.getElementById('lowrider-home-confirm')) return;
    const dialog = document.createElement('dialog');
    dialog.id = 'lowrider-home-confirm';
    dialog.setAttribute('aria-labelledby', 'lowrider-home-title');
    dialog.style.cssText = 'position:fixed;inset:0;margin:auto;font-family:Arial,sans-serif;background:#252525;color:#fff;border:1px solid #777;border-radius:8px;padding:24px;width:420px;max-width:90vw;box-shadow:0 12px 60px #000';
    const title = document.createElement('h3');
    title.id = 'lowrider-home-title';
    title.textContent = `Confirm ${action}`;
    const text = document.createElement('p');
    text.style.cssText = 'margin-top:12px;line-height:1.5;white-space:pre-line';
    text.textContent = shake
      ? 'This test moves the selected motor 1 mm forward and back, ten times. Keep clear of the endstops. Paired motors move individually. Re-home and recheck work zeros afterward.\n\nContinue?'
      : 'Homing moves Z to its endstops first, then the requested axes. Work-zero offsets on the homed axes can be lost or reset. Recheck and set your work zeros before continuing a cut.\n\nContinue?';
    const feedback = document.createElement('p');
    feedback.setAttribute('role', 'status');
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:flex;justify-content:flex-end;gap:12px;margin-top:20px';
    const no = document.createElement('button');
    no.type = 'button'; no.textContent = 'No';
    const yes = document.createElement('button');
    yes.type = 'button'; yes.textContent = 'Yes';
    for (const choice of [no, yes]) {
      choice.style.cssText = 'background:transparent;color:#fff;border:1px solid #aaa;border-radius:4px;padding:8px 24px;font:inherit;cursor:pointer';
    }
    no.addEventListener('click', () => dialog.close());
    yes.addEventListener('click', async () => {
      yes.disabled=true;dialog.close();await runHomeCommand(command,shake);
    });
    dialog.addEventListener('close', () => { dialog.remove(); button.focus(); });
    buttons.append(no, yes);
    dialog.append(title, text, feedback, buttons);
    if(command==='HOME_ALL'||command==='HOME_Z'){yes.click();return;}
    document.body.append(dialog);
    dialog.showModal();
    no.focus();
  }, true);
  function workRanges(status) {
    const tool = status.toolhead;
    const move = status.gcode_move;
    return ['X', 'Y', 'Z'].map((axis, index) => {
      if (!tool.homed_axes.includes(axis.toLowerCase())) return `${axis}: home axis first`;
      const offset = move.position[index] - move.gcode_position[index];
      const format = value => (Math.abs(value) < 0.0005 ? 0 : value).toFixed(2);
      return `${axis}: ${format(tool.axis_minimum[index] - offset)} to ${format(tool.axis_maximum[index] - offset)}`;
    });
  }
  async function refreshRanges() {
    const display = document.getElementById('lowrider-work-travel-values');
    if (display) {
      try {
        const response = await fetch('/printer/objects/query?toolhead&gcode_move&webhooks', {
          signal: AbortSignal.timeout(5000), cache: 'no-store',
        });
        const data = await response.json();
        if (!response.ok || data.result?.status?.webhooks?.state !== 'ready') throw new Error('Not ready');
        const value = workRanges(data.result.status).join('\n');
        if (display.textContent !== value) display.textContent = value;
        workRanges(data.result.status).forEach((line,i)=>{const element=document.getElementById('lowrider-range-'+i);const text=line.replace(/^[XYZ]: /,'');if(element&&element.textContent!==text)element.textContent=text;});
      } catch (_) {
        if (display.textContent !== 'Range unavailable — reconnect to Klipper') {
          display.textContent = 'Range unavailable — reconnect to Klipper';
        }
      }
    }
    setTimeout(refreshRanges, 2000);
  }
  const endstopNames = [['X', 'stepper_x'], ['Y', 'stepper_y'], ['Y1', 'y1'], ['Z', 'stepper_z'], ['Z1', 'z1']];


  async function refreshEndstops() {
    try {
    if (document.getElementById('lowrider-endstops')) {
      let states = {};
      try {
        const statusResponse = await fetch('/printer/objects/query?toolhead&idle_timeout&webhooks&print_stats&stepper_enable&gcode_move&pause_resume&led%20work_lights&gcode_macro%20LED_BREATHE&gcode_macro%20_LED_IDLE_STATE&gcode_macro%20PAUSE_BASE&virtual_sdcard&cnc_force_jog&motion_report', {cache:'no-store',signal:AbortSignal.timeout(5000)});
        const status = (await statusResponse.json()).result?.status;
        controlStatus = status;document.dispatchEvent(new CustomEvent('cnc-pendant-status',{detail:status}));updateAndroidStatus(status);
        document.querySelectorAll('input[data-lowrider-position]').forEach(input=>{input.disabled=forcedSending||!!status?.cnc_force_jog?.busy||!!manualMotionReason(status,true)||!status.toolhead?.homed_axes?.includes(input.dataset.lowriderPosition.toLowerCase());if(document.activeElement!==input&&!input.dataset.sending)input.value=input.previousElementSibling.value;});
        document.querySelectorAll('[data-machine-position]').forEach(input=>{const axis=input.dataset.machinePosition,i='XYZ'.indexOf(axis);input.disabled=forcedSending||!!status?.cnc_force_jog?.busy||!!manualMotionReason(status,true)||!status?.toolhead?.homed_axes?.includes(axis.toLowerCase());if(document.activeElement!==input&&!input.dataset.sending&&status?.gcode_move)input.value=coordinateText(status.gcode_move.position[i],i);});
        const feedValue=document.getElementById('lowrider-feed-value');
        if(feedValue&&status?.gcode_move&&document.activeElement!==feedValue&&feedValue.dataset.saving!=='true'){const value=String(Math.round(status.gcode_move.speed_factor*100));if(feedValue.value!==value)feedValue.value=value;}
        updateMotionNotice(status);if(status?.gcode_move)refreshRunSpeedPreset(status.gcode_move.speed_factor*100);
        if (status?.gcode_move) { syncJogReference(status); refreshJogChoices(); }
        updateAvailability();
        if (!statusResponse.ok || status?.webhooks?.state !== 'ready') throw new Error('Unavailable');
        // Physical endstops are queried only on Home-dialog entry by pendant.js.
        return;
      } catch (_) { controlStatus = null;updateMotionNotice(null); document.dispatchEvent(new CustomEvent('cnc-pendant-status',{detail:null})); updateAndroidStatus(null); updateAvailability(); }
      for (const [axis, key] of endstopNames) {
        const tile = document.getElementById(`lowrider-endstop-${axis}`);
        if (!tile) continue;
        const state = states[key];
        const triggered = state === 'TRIGGERED';
        const open = typeof state === 'string' && state.toLowerCase() === 'open';
        const stateLabel = `${axis}: ${triggered ? 'triggered' : open ? 'open' : 'unavailable'}`;
        if (tile.getAttribute('aria-label') !== stateLabel) {
          tile.textContent = axis;
          tile.setAttribute('aria-label', stateLabel);
          tile.title = stateLabel;
          tile.style.backgroundColor = triggered ? '#b71c1c' : open ? '#2e7d32' : '#555';
        }
      }
    }
    } finally { setTimeout(refreshEndstops, 500); }
  }
  async function runCncCommand(script, idleOnly=false) {
    if(script.trim()==='RESUME'){if(!window.CncPreflight)throw Error('Verification controls are loading.');return window.CncPreflight.resume();}
    const response=await fetch('/printer/objects/query?webhooks&print_stats&pause_resume&virtual_sdcard&idle_timeout&toolhead',{cache:'no-store',signal:AbortSignal.timeout(5000)});
    const status=(await response.json()).result?.status;
    if(!response.ok||status?.webhooks.state!=='ready')throw Error('Klipper is not ready');
    if(idleOnly){const reason=manualMotionReason(status);if(reason)throw Error(reason);if(isMachinePaused(status)&&script!=='ZERO_Z')throw Error('Only tool Z zero may change while paused; keep the job XY origin unchanged.');}
    if(script.startsWith('ZERO_')){const axes=script==='ZERO_ALL'?'xyz':script.slice(5).toLowerCase();if([...axes].some(axis=>!status.toolhead.homed_axes.includes(axis)))throw Error('Home the selected axes before setting work zero');}
    const sent=await fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script})});
    const result=await sent.json();if(!sent.ok||result.error)throw Error(result.error?.message||'Command failed');
    if(script==='ZERO_Z'&&isMachinePaused(status)){if(window.CncPreflight)await window.CncPreflight.afterZero();}
    return status;
  }
  function cncDialog(titleText) {
    const dialog=document.createElement('dialog');dialog.style.cssText='position:fixed;inset:0;margin:auto;width:380px;max-width:92vw;max-height:88dvh;overflow-y:auto;box-sizing:border-box;overscroll-behavior:contain;touch-action:pan-y;background:#252525;color:white;border:1px solid #777;border-radius:8px;padding:20px;font-family:Arial,sans-serif';
    const title=document.createElement('h3');title.textContent=titleText;dialog.append(title);
    dialog.addEventListener('close',()=>dialog.remove());
    const add=(label,fn,color='#202020')=>{const button=document.createElement('button');button.type='button';button.textContent=label;button.style.cssText=`display:block;width:100%;min-height:44px;margin-top:10px;background:${color};color:white;border:1px solid #777;border-radius:4px;font-size:14px`;button.addEventListener('click',fn);dialog.append(button);return button;};
    return {dialog,add,open(){document.body.append(dialog);dialog.showModal();dialog.querySelector('button:last-child')?.focus({preventScroll:true});}};
  }
  function workLightIsOn(status){return Number(status?.['gcode_macro _LED_IDLE_STATE']?.steady??status?.['led work_lights']?.color_data?.[0]?.[3]??0)>0||!!status?.['gcode_macro LED_BREATHE']?.enabled||!!status?.['gcode_macro _LED_IDLE_STATE']?.automatic;}
  function updateAndroidStatus(status) {
    updateForcedDisplay(status);
    const ready=status?.webhooks?.state==='ready';
    const paused=!!status?.pause_resume?.is_paused||status?.print_stats?.state==='paused';
    const running=status?.print_stats?.state==='printing';
    const home=document.getElementById('lowrider-home-dialog');if(home){home.disabled=!ready||running||paused||homingPending||motionStillQueued(status);home.setAttribute('aria-disabled',String(home.disabled));home.toggleAttribute('data-lowrider-unavailable',home.disabled);home.title=home.disabled?'Homing is unavailable while busy or disconnected':'Open homing controls';}
    const pause=document.getElementById('lowrider-pause-resume');
    if(pause){pause.hidden=true;pause.disabled=!ready||(!paused&&!running)||(paused&&(!window.CncPreflight||!window.CncPreflight.canResume()));const text=paused?'Resume':'Pause';if(pause.textContent!==text)pause.textContent=text;pause.style.backgroundColor=paused?'#b26a00':'#1976d2';}
    const label=document.getElementById('lowrider-job-state');if(label){const text=paused?'Paused':running?'Running':'Idle';if(label.textContent!==text)label.textContent=text;}
    const light=document.getElementById('lowrider-grid-light');
    if(light){light.disabled=!ready;const warning=!!status?.['gcode_macro _LED_IDLE_STATE']?.automatic;const on=(status?.['gcode_macro _LED_IDLE_STATE']?.steady??status?.['led work_lights']?.color_data?.[0]?.[3]??0)>0||!!status?.['gcode_macro LED_BREATHE']?.enabled;light.style.backgroundColor=warning?'#b26a00':on?'#202020':'#2e7d32';const breathing=!!status?.['gcode_macro LED_BREATHE']?.enabled;const brightness=Number(status?.['led work_lights']?.color_data?.[0]?.[3]??status?.['gcode_macro _LED_IDLE_STATE']?.steady??0);const percent=Math.round(Math.max(0,Math.min(1,brightness))*100);const text='Light: '+(!ready?'—':warning?'Idle warning':breathing?'Breathe':percent===0?'Off':percent===100?'Max':percent+'%');if(light.textContent!==text)light.textContent=text;light.setAttribute('aria-label',text);light.setAttribute('aria-pressed',String(on));light.title=warning?'Snooze idle warning for fifteen minutes':on?'Brightness, breathing, or turn off':'Turn work light on at 70%';}
    const lightToggle=document.getElementById('lowrider-light-toggle');if(lightToggle){const on=workLightIsOn(status);const text=on?'Off':'On';if(lightToggle.textContent!==text)lightToggle.textContent=text;lightToggle.disabled=!ready;lightToggle.title=on?'Turn work light off':'Turn work light on at 70%';lightToggle.setAttribute('aria-label',lightToggle.title);lightToggle.style.backgroundColor=on?'#202020':'#2e7d32';}
    document.querySelectorAll('[data-lowrider-job-action]').forEach(button=>{const action=button.dataset.lowriderJobAction;button.disabled=!ready||(action==='pause'?(!running||paused):action==='resume'?!paused:(!running&&!paused));});
    updateIdleWarningDisplay(status);updatePauseDisplay(status);
    const zero=document.getElementById('lowrider-grid-zero');if(zero)zero.disabled=!!manualMotionReason(status)||!status?.toolhead?.homed_axes;
  }
  function mountAndroidControls(toolhead,zeroPanel) {
    const pad=document.getElementById('lowrider-jog-pad');if(!pad||!toolhead)return;
    if(zeroPanel)zeroPanel.style.setProperty('display','none','important');
    const homingPanel=document.querySelector('.macrogroup_lowrider-homing_panel');
    if(homingPanel){
      homingPanel.querySelectorAll('[data-lowrider-home-command]').forEach(b=>b.closest('.v-item-group')?.style.setProperty('display','none','important'));
      const homeGrid=homingPanel.querySelector('.col.text-center');
      if(homeGrid&&!document.getElementById('lowrider-home-dialog')){
        const launch=document.createElement('button');launch.id='lowrider-home-dialog';launch.type='button';launch.textContent='Home…';launch.style.cssText='grid-column:1/-1;order:0;min-height:36px;border:1px solid #777;border-radius:4px;background:#1976d2;color:white;font-size:13px';homeGrid.prepend(launch);
        launch.addEventListener('click',async()=>{try{await freshHomeStatus();}catch(error){homingNotice(error.message);return;}const modal=cncDialog('Home axes');const note=document.createElement('p');note.textContent='Homing can reset work zeros. Recheck them before cutting.';modal.dialog.append(note);for(const command of ['HOME_ALL','HOME_X','HOME_Y','HOME_Z']){const original=homingPanel.querySelector(`[data-lowrider-home-command="${command}"]`);if(!original)continue;const b=modal.add(command==='HOME_ALL'?'Home All':command.slice(5),()=>{modal.dialog.close();if(command==='HOME_ALL'||command==='HOME_Z')runHomeCommand(command);else original.click();},command==='HOME_ALL'?'#1976d2':'#202020');const reason=controlUnavailable(original,controlStatus);b.disabled=!!reason;b.title=reason;}const force=modal.add(forcedEnabled()?'Turn off Forced unhomed motion':'Forced unhomed motion',()=>{modal.dialog.close();if(forcedEnabled())setForcedMode(false);else showForcedWarning();},'#b71c1c');force.disabled=!controlStatus?.cnc_force_jog||(!forcedEnabled()&&controlStatus?.toolhead?.homed_axes==='xyz');modal.add('Cancel',()=>modal.dialog.close());modal.open();});
      }
      const launch=document.getElementById('lowrider-home-dialog');
      if(launch&&!document.getElementById('lowrider-quick-homes')){
        const row=document.createElement('div');row.id='lowrider-quick-homes';row.style.cssText='grid-column:1/-1;order:0;display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:3px';
        launch.before(row);row.append(launch);launch.textContent='Home';launch.style.gridColumn='auto';launch.style.minWidth='0';launch.style.padding='2px';
        for(const [command,label] of [['HOME_Z','Z'],['HOME_ALL','All']]){
          const quick=document.createElement('button');quick.type='button';quick.textContent=label;quick.dataset.lowriderQuickHome=command;quick.setAttribute('aria-label',command==='HOME_Z'?'Home Z':'Home all axes');quick.style.cssText='min-width:0;min-height:36px;padding:2px;border:1px solid #777;border-radius:4px;background:#1976d2;color:white;font-size:13px';
          quick.addEventListener('click',()=>{const original=homingPanel.querySelector(`[data-lowrider-home-command="${command}"]`);if(original&&!controlUnavailable(original,controlStatus))original.click();});row.append(quick);
        }
      }
    }
    const homingHeading=toolhead.querySelector('.lowrider-homing-heading');if(homingHeading)homingHeading.style.display='none';
    const zBar=document.getElementById('lowrider-horizontal-z'),factor=document.getElementById('lowrider-feed-factor'),endstops=document.getElementById('lowrider-endstops');
    if(!document.getElementById('pendant-jog-zone')&&zBar&&factor&&factor.previousElementSibling!==zBar)zBar.after(factor);
    const timeoutRow=document.getElementById('lowrider-stepper-timeout-row');
    if(!document.getElementById('pendant-jog-zone')&&factor&&timeoutRow&&timeoutRow.previousElementSibling!==factor)factor.after(timeoutRow);
    const endstopAnchor=timeoutRow||factor;if(!document.getElementById('pendant-jog-zone')&&endstopAnchor&&endstops&&endstops.previousElementSibling!==endstopAnchor)endstopAnchor.after(endstops);
    if(!document.getElementById('lowrider-active-controls')){
      const box=document.createElement('div');box.id='lowrider-active-controls';box.style.cssText='grid-column:5/span 3;grid-row:6/span 3;display:flex;flex-direction:column;justify-content:center;gap:4px';
      const create=(id,text)=>{const b=document.createElement('button');b.id=id;b.type='button';b.textContent=text;b.className='lowrider-active-button';b.style.cssText='min-height:28px;color:white;background:#202020;border:1px solid #777;border-radius:4px;font-size:12px';box.append(b);return b;};
      const zero=create('lowrider-grid-zero','Zero…');zero.style.backgroundColor='#1976d2';
      zero.addEventListener('click',()=>{
        const modal=cncDialog('Set this position as work zero?');const explanation=document.createElement('p');explanation.textContent=`Current work position: ${['X','Y','Z'].map((a,i)=>a+' '+(controlStatus?.gcode_move?.gcode_position[i]??0).toFixed(2)).join(' / ')} mm. Choose which coordinates to set to zero; this does not move the tool.`;explanation.style.cssText='font-size:13px;line-height:1.4;margin-top:10px';modal.dialog.append(explanation);
        for(const [label,script,axes] of [['Set Tool Z Zero','ZERO_Z','z'],['Zero All','ZERO_ALL','xyz'],['Zero XY','ZERO_XY','xy'],['Zero X','ZERO_X','x'],['Zero Y','ZERO_Y','y']]){
          const choice=modal.add(label,async()=>{modal.dialog.close();try{await runCncCommand(script,true);allowBelowZ5=false;refreshJogChoices();}catch(error){homingNotice(error.message);}},script==='ZERO_Z'?'#1976d2':'#202020');
          if(script==='ZERO_Z'){choice.style.minHeight='56px';choice.style.fontSize='16px';choice.style.fontWeight='bold';}choice.disabled=[...axes].some(axis=>!controlStatus?.toolhead.homed_axes.includes(axis))||(isMachinePaused(controlStatus)&&script!=='ZERO_Z');if(isMachinePaused(controlStatus)&&script!=='ZERO_Z')choice.title='Keep the job XY origin unchanged while paused';
        }
        modal.add('Cancel',()=>modal.dialog.close());modal.open();
      });
      const pause=create('lowrider-pause-resume','Pause');
      pause.addEventListener('click',async()=>{pause.disabled=true;try{const res=await fetch('/printer/objects/query?print_stats&pause_resume',{cache:'no-store'});const state=(await res.json()).result?.status;const paused=state?.pause_resume?.is_paused||state?.print_stats?.state==='paused';if(!paused&&state?.print_stats?.state!=='printing')throw Error('No active job');await runCncCommand(paused?'RESUME':'PAUSE');}catch(error){homingNotice(error.message);}finally{updateAndroidStatus(controlStatus);}});
      const light=create('lowrider-grid-light','💡 Light');light.setAttribute('aria-label','Toggle work light 70 percent or off');
      light.addEventListener('click',async()=>{
        try {
          const response=await fetch('/printer/objects/query?led%20work_lights&gcode_macro%20LED_BREATHE&gcode_macro%20_LED_IDLE_STATE',{cache:'no-store'});const state=(await response.json()).result?.status;
          if(!response.ok||!state)throw Error('Light state unavailable');
          const idle=state['gcode_macro _LED_IDLE_STATE'];
          if(idle?.automatic){await runCncCommand('LED_IDLE_SNOOZE');return;}
          const on=(idle?.steady??state['led work_lights']?.color_data?.[0]?.[3]??0)>0||state['gcode_macro LED_BREATHE']?.enabled;
          if(on){await runCncCommand('LED_IDLE_ACTIVITY');showLightSettings(state);}
          else await runCncCommand('LED_ON');
        }catch(error){homingNotice(error.message);}
      });
      const lightRow=document.createElement('div');lightRow.style.cssText='display:grid;grid-template-columns:28px minmax(0,1fr) 28px 32px;gap:3px';
      light.before(lightRow);lightRow.append(light);light.style.minWidth='0';light.style.padding='2px';light.style.fontSize='11px';
      for(const [action,glyph] of [['down','▼'],['up','▲'],['off','Off']]){
        const arrow=document.createElement('button');arrow.type='button';arrow.textContent=glyph;
        arrow.setAttribute('aria-label',action==='off'?'Turn work light off':action==='down'?'Dim work light by 10 percent':'Brighten work light by 10 percent');
        if(action==='off')arrow.id='lowrider-light-toggle';
        arrow.title=arrow.getAttribute('aria-label');
        arrow.style.cssText='min-width:0;min-height:32px;padding:0;background:#202020;color:white;border:1px solid #777;border-radius:4px;font-size:12px';
        if(action==='down')lightRow.prepend(arrow);else lightRow.append(arrow);
        arrow.addEventListener('click',()=>{
          lightAdjustmentQueue=lightAdjustmentQueue.then(async()=>{
            const response=await fetch('/printer/objects/query?webhooks&led%20work_lights&gcode_macro%20_LED_IDLE_STATE&gcode_macro%20LED_BREATHE',{cache:'no-store'});
            const status=(await response.json()).result?.status;
            if(!response.ok||status?.webhooks?.state!=='ready')throw Error('Light state unavailable');
            if(action==='off'){await runCncCommand(workLightIsOn(status)?'LED_OFF':'LED_ON');return;}
            const brightness=Number(status['gcode_macro _LED_IDLE_STATE']?.steady??status['led work_lights']?.color_data?.[0]?.[3]??0);
            const percent=Math.max(0,Math.min(100,Math.round(brightness*100)+(action==='down'?-10:10)));
            await runCncCommand(`LED_SET_BRIGHTNESS PERCENT=${percent}`);
          }).catch(error=>homingNotice(error.message));
        });
      }
      const state=document.createElement('div');state.id='lowrider-job-state';state.style.display='none';box.append(state);pad.append(box);
    }
    if(endstops&&!document.getElementById('lowrider-z5-cap')){
      const row=document.createElement('label');row.style.cssText='display:flex;align-items:center;justify-content:center;width:max-content;max-width:100%;margin:0 auto;gap:8px;font-size:12px;padding:8px 0';row.append(document.createTextNode('Below Z5 jog cap'));
      const input=document.createElement('input');input.id='lowrider-z5-cap';input.type='number';input.min='1';input.max='100';input.value=String(belowZ5Cap);input.setAttribute('aria-label','Below safe Z jog cap percent');input.style.cssText='width:58px;background:#202020;color:white;border:1px solid #777;border-radius:3px;padding:5px;text-align:center';
      input.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();input.blur();}});input.addEventListener('blur',()=>{const n=Number(input.value);if(Number.isFinite(n)&&n>=1&&n<=100){belowZ5Cap=n;saveShared('belowZ5Cap',n);}else homingNotice('Enter a cap from 1 to 100%.');input.value=String(belowZ5Cap);refreshJogChoices();});row.append(input,document.createTextNode('%'));endstops.after(row);
    }
    const guard=document.getElementById('lowrider-z5-allow'),capInput=document.getElementById('lowrider-z5-cap');
    if(guard&&capInput&&!document.getElementById('lowrider-z5-controls')){
      const group=document.createElement('div');group.id='lowrider-z5-controls';group.setAttribute('role','group');group.setAttribute('aria-label','Safe Z height, permission and jog speed cap');
      group.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:32px 32px;gap:3px;width:100%;min-width:0';guard.before(group);
      guard.style.cssText+=';grid-column:1;grid-row:1/span 2;width:100%;min-width:0;min-height:67px;font-size:10px;padding:2px;white-space:pre-line;line-height:1.5';
      const safeLabel=document.createElement('label');safeLabel.style.cssText='grid-column:2;grid-row:2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;min-width:0;font-size:9px;line-height:10px';safeLabel.title='Safe jog height in work Z millimeters';
      const safeInput=document.createElement('input');safeInput.id='lowrider-safe-jog-z';safeInput.type='number';safeInput.min='0';safeInput.max='109';safeInput.step='0.1';safeInput.value=String(safeJogZ);safeInput.setAttribute('aria-label','Safe jog work Z height in millimeters');safeInput.style.cssText='width:40px;min-width:0;height:22px;min-height:22px;box-sizing:border-box;background:#202020;color:white;border:1px solid #777;border-radius:3px;padding:1px;text-align:center;font-size:11px';
      safeInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();safeInput.blur();}});safeInput.addEventListener('blur',()=>{const value=Number(safeInput.value);if(safeInput.value.trim()&&Number.isFinite(value)&&value>=0&&value<=109){safeJogZ=value;saveShared('safeJogZ',value);allowBelowZ5=false;lastWorkZ=null;refreshJogChoices();updateAvailability();}else homingNotice('Enter a safe work Z height from 0 to 109 mm.');safeInput.value=String(safeJogZ);});
      const safeCaption=document.createElement('span');safeCaption.textContent='Safe Z';const safeValue=document.createElement('span');safeValue.style.cssText='display:flex;align-items:center;gap:2px';safeValue.append(safeInput,document.createTextNode('mm'));safeLabel.append(safeCaption,safeValue);
      const capLabel=capInput.parentElement;if(capLabel.firstChild?.nodeType===3)capLabel.firstChild.remove();
      capLabel.style.cssText='grid-column:2;grid-row:1;display:flex;align-items:center;justify-content:center;gap:2px;min-width:0;font-size:10px;margin:0;padding:0';capLabel.title='Maximum jog speed below safe work Z, percent';
      capInput.style.cssText='width:40px;min-width:0;min-height:30px;box-sizing:border-box;background:#202020;color:white;border:1px solid #777;border-radius:3px;padding:2px;text-align:center;font-size:12px';
      group.append(safeLabel,guard,capLabel);
    }
    if(endstops&&!document.getElementById('lowrider-idle-countdown')){const line=document.createElement('div');line.id='lowrider-idle-countdown';line.style.cssText='font-size:11px;text-align:center;padding:3px 0;color:#ddd';endstops.after(line);}
    const capRow=endstops;
    if(capRow&&!document.getElementById('lowrider-stepper-timeout')){
      const row=document.createElement('div');row.id='lowrider-stepper-timeout-row';row.style.cssText='text-align:center;padding:4px 0';const button=document.createElement('button');button.id='lowrider-stepper-timeout';button.type='button';button.textContent='Auto Stepper Disable…';button.style.cssText='background:#202020;color:white;border:1px solid #777;border-radius:4px;padding:6px 12px;font-size:12px';button.addEventListener('click',showStepperTimeout);row.append(button);capRow.before(row);
    }
    if(capRow&&!document.getElementById('lowrider-pause-position')){const line=document.createElement('div');line.id='lowrider-pause-position';line.style.cssText='font-size:11px;line-height:1.5;padding:4px 0;white-space:pre-line;text-align:center';document.getElementById('lowrider-idle-countdown').after(line);}
    mountDirectPositions(toolhead);mountMachinePositions();
    if(controlStatus)updateAndroidStatus(controlStatus);
  }
  function updateIdleWarningDisplay(status) {
    const state=status?.['gcode_macro _LED_IDLE_STATE'];const active=!!state?.automatic;
    document.querySelectorAll('[data-lowrider-disable-steppers]').forEach(b=>b.classList.toggle('lowrider-idle-warning',active));
    const line=document.getElementById('lowrider-idle-countdown');
    if(line){const now=status?.toolhead?.estimated_print_time||0;const left=Math.max(0,Math.ceil((state?.snooze_until||0)-now));const enabled=(state?.disable_after??1800)>0;const remaining=Math.max(0,Math.ceil((state?.disable_after??1800)-(now-(state?.warning_since??now))));const time=n=>`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;const paused=isMachinePaused(status)||status?.print_stats?.state==='paused';const text=active?(!enabled?'Idle warning; automatic shutdown disabled':paused?'Idle warning; auto-disable held while paused':`Auto-disable in ${time(remaining)} / tap light to snooze`):left>0?`Idle warning snoozed ${time(left)}`:'';if(line.textContent!==text)line.textContent=text;}
    const button=document.getElementById('lowrider-stepper-timeout');if(button){const reminder=(state?.timeout??1800)/60;const grace=state?.shutdown_minutes??30;const text=(state?.disable_after??1800)>0?`Auto Stepper Disable: ${reminder} + ${grace} min…`:`Auto Stepper Disable: Off (${reminder} min reminder)…`;if(button.textContent!==text)button.textContent=text;button.disabled=status?.webhooks?.state!=='ready';}

  }
  function showStepperTimeout() {
    const state=controlStatus?.['gcode_macro _LED_IDLE_STATE'];const modal=cncDialog('Auto Stepper Disable');
    const explanation=document.createElement('p');explanation.textContent='Two stages: an idle reminder, then a grace period before disabling the steppers. Running and paused jobs never automatically disable. Both settings are saved on the controller across reboots.';explanation.style.cssText='font-size:13px;line-height:1.4';modal.dialog.append(explanation);
    function minutesField(title,aria,value){const label=document.createElement('label');label.textContent=title;label.style.cssText='display:flex;justify-content:space-between;gap:10px;align-items:center;margin:14px 0';const input=document.createElement('input');input.type='number';input.min='1';input.max='1440';input.step='1';input.value=String(value);input.setAttribute('aria-label',aria);input.style.cssText='width:75px;padding:6px;background:#202020;color:white;border:1px solid #777';label.append(input);modal.dialog.append(label);return input;}
    const reminder=minutesField('Idle reminder (minutes)','Idle reminder minutes',(state?.timeout??1800)/60);
    const grace=minutesField('Disable grace period (minutes)','Stepper disable grace minutes',state?.shutdown_minutes??30);
    const offLabel=document.createElement('label');offLabel.style.cssText='display:flex;gap:10px;align-items:center;font-size:13px;margin:14px 0';const off=document.createElement('input');off.type='checkbox';off.checked=(state?.disable_after??1800)<=0;off.setAttribute('aria-label','Never automatically disable steppers');offLabel.append(off,document.createTextNode('Never automatically disable steppers'));modal.dialog.append(offLabel);
    const total=document.createElement('p');total.style.cssText='font-size:12px;line-height:1.4';modal.dialog.append(total);
    const update=()=>{grace.disabled=off.checked;total.textContent=off.checked?`Reminder after ${reminder.value} idle minutes; automatic stepper disable is off.`:`Reminder after ${reminder.value} idle minutes, then ${grace.value} minutes grace: about ${Number(reminder.value)+Number(grace.value)} idle minutes total.`;};reminder.addEventListener('input',update);grace.addEventListener('input',update);off.addEventListener('change',update);update();
    modal.add('Apply',async()=>{for(const input of [reminder,grace]){const value=Number(input.value);if(!input.value.trim()||!Number.isFinite(value)||value<1||value>1440){input.setCustomValidity('Enter 1 to 1440 minutes');input.reportValidity();return;}input.setCustomValidity('');}modal.dialog.close();try{await runCncCommand(`SET_STEPPER_TIMEOUT WARNING_MINUTES=${Number(reminder.value)} MINUTES=${Number(grace.value)} ENABLE=${off.checked?0:1}`);}catch(error){homingNotice(error.message);}});modal.add('Cancel',()=>modal.dialog.close());modal.open();
  }

  let pauseDisplayKey=null,pauseLineText='',pauseLookupPending=false,pauseLookupAttempted=false;
  function updatePauseDisplay(status) {
    const display=document.getElementById('lowrider-pause-position');if(!display)return;
    const saved=status?.['gcode_macro PAUSE_BASE'];
    if(!isMachinePaused(status)||!saved?.valid){if(display.textContent)display.textContent='';pauseDisplayKey=null;return;}
    const file=status.print_stats?.filename||'',position=Number(saved.file_position??-1);const key=JSON.stringify([file,position]);
    if(key!==pauseDisplayKey){pauseDisplayKey=key;pauseLookupAttempted=false;pauseLineText=position>=0?`File cursor byte ${position} (buffered)`:'Manual pause / no file cursor';}
    const text=`Paused: ${pauseLineText}\nSaved return: machine X${Number(saved.machine_x).toFixed(2)} Y${Number(saved.machine_y).toFixed(2)} / work Z${Number(saved.work_z).toFixed(2)}`;
    if(display.textContent!==text)display.textContent=text;
    display.title=file?`${file}. File cursor is the queued G-code location, not an exact physical tool-stop line.`:'Saved pause return point';
    if(file&&position>=0&&!pauseLookupPending&&!pauseLookupAttempted){
      pauseLookupPending=true;pauseLookupAttempted=true;
      lookupPauseLine(file,position).then(line=>{if(pauseDisplayKey===key)pauseLineText=`file cursor near line ${line} / byte ${position} (buffered)`;}).catch(()=>{}).finally(()=>{pauseLookupPending=false;});
    }
  }
  async function lookupPauseLine(file,position) {
    if(position===0)return 1;
    const url='/server/files/gcodes/'+file.split('/').map(encodeURIComponent).join('/');
    const response=await fetch(url,{headers:{Range:`bytes=0-${position-1}`},cache:'no-store',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('File cursor unavailable');
    const reader=response.body.getReader();let seen=0,line=1;
    try{while(seen<position){const {value,done}=await reader.read();if(done)break;const length=Math.min(value.length,position-seen);for(let i=0;i<length;i++)if(value[i]===10)line++;seen+=length;}}finally{await reader.cancel();}
    if(seen<position)throw Error('File cursor exceeds file size');return line;
  }
  function showLightSettings(state) {
    const modal=cncDialog('Work light');const label=document.createElement('label');label.textContent='Brightness %';label.style.cssText='display:flex;align-items:center;gap:12px;margin-top:16px';
    const value=document.createElement('input');value.type='number';value.min='1';value.max='100';value.value=String(Math.round((state['gcode_macro _LED_IDLE_STATE']?.steady||.7)*100));value.setAttribute('aria-label','Work light brightness percent');value.style.cssText='width:85px;background:#202020;color:white;padding:8px;border:1px solid #777;border-radius:4px';label.append(value);modal.dialog.append(label);
    modal.add('Apply brightness',async()=>{const n=Number(value.value);if(!value.value.trim()||!Number.isFinite(n)||n<1||n>100){value.setCustomValidity('Enter 1 to 100 percent');value.reportValidity();return;}modal.dialog.close();try{await runCncCommand(`LED_SET_BRIGHTNESS PERCENT=${n}`);}catch(error){homingNotice(error.message);}});
    const breathing=!!state['gcode_macro LED_BREATHE']?.enabled;
    modal.add(breathing?'Stop breathe':'Breathe',async()=>{modal.dialog.close();try{await runCncCommand(breathing?'LED_BREATHE_STOP':'LED_BREATHE');}catch(error){homingNotice(error.message);}});
    modal.add('Turn off',()=>{modal.dialog.close();const confirm=cncDialog('Turn work light off?');confirm.add('Confirm',async()=>{confirm.dialog.close();try{await runCncCommand('LED_OFF');}catch(error){homingNotice(error.message);}});confirm.add('Cancel',()=>confirm.dialog.close());confirm.open();});
    modal.add('Cancel',()=>modal.dialog.close());modal.open();
  }
  let lastIdleActivity=0;
  function recordIdleActivity(event) {
    if(!event.target.closest?.('.toolhead-control-panel,.console-panel,dialog')||event.target.closest?.('#lowrider-grid-light'))return;
    if(Date.now()-lastIdleActivity<1500||controlStatus?.webhooks?.state!=='ready')return;
    lastIdleActivity=Date.now();
    fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:'LED_IDLE_ACTIVITY'})}).catch(()=>{});
  }
  document.addEventListener('pointerdown',recordIdleActivity,true);
  document.addEventListener('keydown',recordIdleActivity,true);
  const warningStyle=document.createElement('style');warningStyle.textContent='@keyframes lowriderStepperWarning{0%,100%{filter:brightness(1)}50%{filter:brightness(.35)}}.lowrider-idle-warning{animation:lowriderStepperWarning .8s infinite}';document.head.append(warningStyle);
  function saveShared(key,value){window.CncSettings?.set(key,value).catch(()=>homingNotice('Could not save shared settings. Check the Pi connection.'));}
  document.addEventListener('cnc-shared-setting',event=>{
    const {key,value}=event.detail;
    if(key==='jogSpeed')jogSpeed=value;if(key==='jogScale')jogScale=value;
    if(key==='safeJogZ'){safeJogZ=value;allowBelowZ5=false;lastWorkZ=null;const input=document.getElementById('lowrider-safe-jog-z');if(input&&document.activeElement!==input)input.value=value;}
    if(key==='belowZ5Cap'){belowZ5Cap=value;const input=document.getElementById('lowrider-z5-cap');if(input&&document.activeElement!==input)input.value=value;}
    refreshJogChoices();updateAvailability();
  });
  let lastMotionClock=null;
  function updateMotionNotice(status){
    const clock=status?.toolhead?.estimated_print_time;if(Number.isFinite(clock)){if(lastMotionClock!==null&&clock<lastMotionClock-1){allowBelowZ5=false;jogReference=null;}lastMotionClock=clock;}else allowBelowZ5=false;
    const moving=!!status&&(jogRequests>0||motionStillQueued(status)),pad=document.getElementById('lowrider-jog-pad'),box=document.getElementById('pendant-motion-notice');
    if(pad)pad.classList.toggle('pendant-motion-pending',moving);if(box)box.hidden=!moving;
  }
  function coordinateFactor(){return document.documentElement.dataset.coordinateUnit==='in'?25.4:document.documentElement.dataset.coordinateUnit==='cm'?10:1;}
  function coordinateText(mm,index){return (mm/coordinateFactor()).toFixed(coordinateFactor()===25.4?4:index===2?3:2);}
  function machineToWork(target,gm,index){return target-(gm.position[index]-gm.gcode_position[index]);}
  document.addEventListener('cnc-coordinate-units',()=>{
    document.querySelectorAll('[data-lowrider-position]').forEach(input=>{if(!input.dataset.sending)input.value=input.previousElementSibling.value;});
    document.querySelectorAll('[data-machine-position]').forEach(input=>{const i='XYZ'.indexOf(input.dataset.machinePosition);if(!input.dataset.sending&&controlStatus?.gcode_move)input.value=coordinateText(controlStatus.gcode_move.position[i],i);});refreshJogChoices();updateAvailability();
  });
  function mountMachinePositions(){
    document.querySelectorAll('.position-box').forEach((row,i)=>{
      if(row.querySelector('[data-machine-position]'))return;
      const display=row.querySelector('.machine-coordinate');if(!display)return;
      const input=document.createElement('input');input.type='text';input.inputMode='decimal';input.enterKeyHint='go';input.autocomplete='off';input.spellcheck=false;input.dataset.machinePosition='XYZ'[i];input.setAttribute('aria-label','XYZ'[i]+' machine position');input.title='Machine coordinate in the selected units. Press Enter to move; leaving cancels the edit.';input.className='machine-position-entry';display.after(input);display.hidden=true;
      const current=()=>coordinateText(controlStatus?.gcode_move?.position[i]??0,i);input.value=current();
      input.addEventListener('focus',()=>input.select());
      for(const name of ['pointerdown','mousedown','click','touchstart'])input.addEventListener(name,event=>event.stopPropagation());
      input.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();input.value=current();input.blur();}if(event.key==='Enter'&&!event.isComposing){event.preventDefault();if(input.dataset.sending)return;input.dataset.commit='true';input.blur();}});
      input.addEventListener('blur',async()=>{const commit=input.dataset.commit==='true';delete input.dataset.commit;if(!commit){input.value=current();return;}const n=Number(input.value)*coordinateFactor();if(!input.value.trim()||!Number.isFinite(n)){input.value=current();return;}input.dataset.sending='true';try{await queueJog(()=>sendDirectJog('XYZ'[i],n,false,true));}catch(error){homingNotice(error.message);}finally{delete input.dataset.sending;input.value=current();}});
    });
  }
  async function sendDirectJog(axis,target,confirmed=false,machine=false) {
    await loadKeepout();
    const response=await fetch('/printer/objects/query?webhooks&print_stats&pause_resume&toolhead&gcode_move&idle_timeout&virtual_sdcard&cnc_force_jog&motion_report',{cache:'no-store'});
    const status=(await response.json()).result?.status;
    if(!response.ok||status?.webhooks?.state!=='ready')throw Error('Klipper is not ready');
    const unavailable=manualMotionReason(status,true);if(unavailable)throw Error(unavailable);
    if(!status.toolhead.homed_axes.includes(axis.toLowerCase())||!status.toolhead.homed_axes.includes('z'))throw Error('Home the axis and Z before moving');
    syncJogReference(status);
    const i='XYZ'.indexOf(axis),requested=target;if(machine)target=machineToWork(target,status.gcode_move,i);const move={target,distance:target-status.gcode_move.gcode_position[i]};
    const limit=travelLimitReason(axis,move,status);if(limit)throw Error(limit);
    if(needsClearanceConfirm(axis,move,status)&&!allowBelowZ5&&!confirmed){if(!await confirmClearance(axis,move,status))return;return sendDirectJog(axis,requested,true,machine);}
    const sent=await fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:jogCommand(axis,target,status)})});
    const result=await sent.json();if(!sent.ok||result.error)throw Error(result.error?.message||'Move failed');
  }
  function mountDirectPositions(toolhead) {
    Array.from(toolhead.querySelectorAll('input[data-native-axis]:not([data-lowrider-position])')).slice(0,3).forEach((original,i)=>{
      if(original.nextElementSibling?.hasAttribute('data-lowrider-position'))return;
      const input=original.cloneNode(false);input.removeAttribute('id');input.dataset.lowriderPosition='XYZ'[i];input.setAttribute('aria-label','XYZ'[i]+' position');input.value=original.value;original.style.display='none';original.after(input);
      input.id=(original.id||('lowrider-position-'+i))+'-cnc';input.type='text';input.inputMode='decimal';input.autocomplete='off';input.spellcheck=false;
      input.style.cssText='min-height:40px;touch-action:manipulation;position:relative;z-index:1';
      const slot=original.parentElement;const label=slot.querySelector('label');if(label)label.htmlFor=input.id;
      for(const name of ['pointerdown','mousedown','click','touchstart'])input.addEventListener(name,event=>event.stopPropagation());
      input.addEventListener('focus',()=>{input.dataset.editing='true';input.select();});
      input.addEventListener('blur',()=>{delete input.dataset.editing;});
      const wrapper=original.closest('.v-input');
      if(wrapper){
        wrapper.style.touchAction='manipulation';
        const focusVisible=event=>{if(event.target===input)return;event.preventDefault();event.stopImmediatePropagation();if(!input.disabled)input.focus({preventScroll:true});};
        wrapper.addEventListener('pointerdown',focusVisible,true);wrapper.addEventListener('mousedown',focusVisible,true);wrapper.addEventListener('click',focusVisible,true);
      }
      input.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();input.value=original.value;input.blur();}});
      input.enterKeyHint='go';input.title='Work coordinate in the selected units. Press Enter to move; leaving cancels the edit.';
      input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();e.stopImmediatePropagation();if(input.dataset.sending)return;input.dataset.commit='true';input.blur();}});
      input.addEventListener('blur',async()=>{
        const commit=input.dataset.commit==='true';delete input.dataset.commit;
        if(!commit){input.value=original.value;return;}
        if(input.value===original.value)return;
        const n=Number(input.value)*coordinateFactor();if(!input.value.trim()||!Number.isFinite(n)){input.value=original.value;return;}
        input.dataset.sending='true';
        try{await queueJog(()=>sendDirectJog('XYZ'[i],n));}catch(error){homingNotice(error.message);}finally{delete input.dataset.sending;input.value=original.value;}
      });
    });
  }
  function mount() {
    if (!document.getElementById('lowrider-zero-style')) {
      const style = document.createElement('style');
      style.id = 'lowrider-zero-style';
      style.textContent = `.macrogroup_lowrider-zero_panel .v-card__text button.v-btn {
        background:transparent!important;color:inherit!important;
        border:1px solid currentColor!important;box-shadow:none!important;
        min-height:30px;font-size:12px;
      }
      .macrogroup_lowrider-zero_panel .v-card__text .col.text-center {
        display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;
      }
      .macrogroup_lowrider-zero_panel .v-card__text .v-item-group {
        margin:0!important;min-width:0;
      }
      .macrogroup_lowrider-zero_panel .v-card__text .v-item-group.lowrider-zero-z {
        grid-column:1 / -1;justify-self:center;min-width:80px;
      }
      .macrogroup_lowrider-zero_panel .v-card__text button.v-btn {min-width:0;padding:0 6px;}
      .macrogroup_lowrider-zero_panel .v-card__text button.lowrider-common-button {
        background:var(--v-primary-base,#2196f3)!important;color:#fff!important;
        border-color:var(--v-primary-base,#2196f3)!important;
      }
      .macrogroup_lowrider-zero_panel button.lowrider-disable-steppers {
        grid-column:span 2; margin:0!important;
      }
      .macrogroup_lowrider-zero_panel .v-card__text button[data-lowrider-disable-steppers]:not(:disabled) {
        grid-column:span 2;margin:0!important;width:auto!important;
        background:#c62828!important;color:#fff!important;
        border-color:#c62828!important;
      }
      .macrogroup_lowrider-endstops_panel .v-card__text button.v-btn,
      .lowrider-console-button {
        background:#202020!important;color:#fff!important;border:1px solid #aaa!important;
        border-radius:4px;box-shadow:none!important;padding:6px 10px;font-size:12px;
        font-weight:600;text-transform:uppercase;min-height:30px;
      }
      #app button:disabled, #app button.v-btn--disabled,
      #app button[data-lowrider-unavailable],
      #lowrider-home-confirm button:disabled {
        background:#333!important;color:#888!important;border-color:#555!important;
        box-shadow:none!important;opacity:1!important;cursor:not-allowed!important;
      }
      #app button:disabled .v-btn__content, #app button.v-btn--disabled .v-btn__content {
        color:#888!important;opacity:1!important;
      }
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel .v-card__text {padding:0!important;}
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel .row {margin:0!important;}
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel .col {
        padding:0!important;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;
      }
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel .v-item-group {margin:0!important;min-width:0;}
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel button {
        min-width:0!important;padding:0 2px!important;font-size:9px!important;height:25px!important;
        background:#202020!important;color:#fff!important;border:1px solid #777!important;border-radius:3px;
      }
      #lowrider-jog-pad button[data-lowrider-home-all]:not(:disabled) {
        background:var(--v-primary-base,#2196f3)!important;border-color:var(--v-primary-base,#2196f3)!important;
      }
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel button[data-lowrider-disable-steppers] {
        grid-column:1/-1; margin:0!important;order:5;
      }
      #lowrider-jog-pad .macrogroup_lowrider-homing_panel button[data-lowrider-disable-steppers]:not(:disabled) {
        background:#c62828!important;border-color:#c62828!important;
      }
      #app #lowrider-jog-pad .macrogroup_lowrider-homing_panel button:disabled {
        background:#333!important;color:#888!important;border-color:#555!important;
      }
      `;
      style.textContent += `@media(max-width:600px),(pointer:coarse){#lowrider-jog-pad{grid-template-rows:0px repeat(7,44px) 0px!important;gap:4px!important;}#lowrider-jog-pad button,#lowrider-horizontal-z button,#lowrider-feed-factor button{min-height:40px!important;}#lowrider-jog-pad .macrogroup_lowrider-homing_panel button{height:32px!important;min-height:32px!important;}#lowrider-horizontal-z{overflow-x:auto;} .macrogroup_lowrider-zero_panel .v-card__text button{min-height:40px!important;}}`;
      document.head.append(style);
    }
    const consolePanel = document.querySelector('.macrogroup_lowrider-endstops_panel');
    const consoleContent = consolePanel?.querySelector('.v-card__text');
    if (consoleContent && !document.getElementById('lowrider-endstops')) {
      const checkButton = Array.from(consoleContent.querySelectorAll('button')).find(button => button.textContent.trim().replace(/\s+/g, ' ') === 'CHECK ENDSTOPS');
      const checkRow = checkButton?.closest('.row');
      if (checkRow) checkRow.style.display = 'none';
      const endstops = document.createElement('div');
      endstops.id = 'lowrider-endstops';
      const heading = document.createElement('div');
      heading.textContent = 'Endstops';
      heading.style.cssText = 'font-size:12px;opacity:.8;margin:4px 0 10px';
      const grid = document.createElement('div');
      grid.style.cssText = 'display:flex;flex-wrap:nowrap;gap:8px;margin-bottom:8px';
      for (const [axis] of endstopNames) {
        const tile = document.createElement('div');
        tile.id = `lowrider-endstop-${axis}`;
        tile.setAttribute('role', 'status');
        tile.textContent = axis;
        tile.setAttribute('aria-label', `${axis}: reading`);
        tile.title = `${axis}: reading`;
        tile.style.cssText = 'background:#555;color:#fff;border-radius:4px;padding:5px 0;font-size:12px;font-weight:600;flex:1 1 0;min-width:0;text-align:center';
        grid.append(tile);
      }
      const refresh = document.createElement('button');
      refresh.type = 'button'; refresh.className = 'lowrider-console-button';
      refresh.textContent = 'Refresh Endstops';
      refresh.title = 'Read the physical endstop switches and update the colored indicators';
      refresh.style.cssText = 'margin-bottom:12px';
      refresh.addEventListener('click', () => {  });
      refresh.style.cssText = 'margin-bottom:12px';
      refresh.id = 'lowrider-endstop-refresh';
      endstops.append(heading, grid);
      consoleContent.append(refresh);
      consoleContent.prepend(endstops);
    }
    if (consoleContent && !consolePanel.querySelector('#lowrider-diagnostic-buttons')) {
      const diagnostics = document.createElement('div');
      diagnostics.id = 'lowrider-diagnostic-buttons';
      diagnostics.style.cssText = 'display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:8px';
      for (const axis of ['X', 'Y', 'Y1', 'Z', 'Z1']) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'lowrider-console-button';
        button.textContent = `Shake ${axis}`;
        button.dataset.lowriderShake = `stepper_${axis.toLowerCase()}`;
        diagnostics.append(button);
      }
      for (const [label, script] of [
        ['Get Position', 'GET_POSITION'],
        ['Driver Status', ['x', 'y', 'y1', 'z', 'z1'].map(axis => `DUMP_TMC STEPPER=stepper_${axis}`).join('\n')],
      ]) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'lowrider-console-button';
        button.textContent = label;
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            const response = await fetch('/printer/gcode/script', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script})});
            const result = await response.json();
            if (!response.ok || result.error) throw new Error(result.error?.message || 'Command failed');
            homingNotice(`${label}: results are in Console.`, true);
          } catch (error) { homingNotice(error.message, true); }
          finally { button.disabled = false; }
        });
        diagnostics.append(button);
      }
      consoleContent.append(diagnostics);
    }
    const zero = document.querySelector('.macrogroup_lowrider-zero_panel');
    const toolhead = document.querySelector('.toolhead-control-panel');
    const status = document.querySelector('.status-panel');
    if (toolhead) {
      Array.from(toolhead.querySelectorAll('input[data-native-axis]:not([data-lowrider-position])')).slice(0,3).forEach((input,i)=>{
        const col=input.closest('.col-4,.col-12');
        if(col&&!document.getElementById('lowrider-range-'+i)){
          const range=document.createElement('div');range.id='lowrider-range-'+i;
          range.style.cssText='font-size:10px;text-align:center;line-height:1.5;margin-top:4px;font-variant-numeric:tabular-nums';
          range.textContent='Reading range…';col.append(range);
        }
      });
      const oldRange=document.getElementById('lowrider-work-travel');if(oldRange)oldRange.style.display='none';
      const pad=document.getElementById('lowrider-jog-pad');
      if(pad&&!document.getElementById('lowrider-feed-factor')){
        const bar=document.createElement('div');bar.id='lowrider-feed-factor';
        bar.style.cssText='display:flex;align-items:center;justify-content:center;width:max-content;max-width:100%;gap:8px;padding:8px 0;margin:4px auto';
        const caption=document.createElement('span');caption.textContent='Run speed %';bar.append(caption);
        const value=document.createElement('input');value.id='lowrider-feed-value';value.type='number';value.min='1';value.step='1';value.inputMode='decimal';value.setAttribute('aria-label','Run speed percent');
        value.style.cssText='width:65px;min-width:0;text-align:center;border:1px solid #777;border-radius:4px;color:inherit;background:#202020;padding:6px;font:inherit';
        value.max='300';
        async function applyRunSpeed(percent){
          const response=await fetch('/printer/objects/query?webhooks',{cache:'no-store'});const state=(await response.json()).result?.status;
          if(!response.ok||state?.webhooks?.state!=='ready')throw Error('Klipper is not ready');
          value.dataset.saving='true';
          try{const sent=await fetch('/printer/gcode/script',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({script:`M220 S${percent}`})});const result=await sent.json();if(!sent.ok||result.error)throw Error(result.error?.message||'Run speed failed');value.value=String(percent);refreshRunSpeedPreset(percent);}
          finally{value.dataset.saving='false';}
        }
        function requestRunSpeed(percent){
          if(!Number.isFinite(percent)||percent<1||percent>300){homingNotice('Enter a run speed from 1% to 300%.');value.value=String(Math.round((controlStatus?.gcode_move?.speed_factor||1)*100));return;}
          if(percent===300){
            value.value=String(Math.round((controlStatus?.gcode_move?.speed_factor||1)*100));
            const modal=cncDialog('Set maximum Run speed?');const note=document.createElement('p');note.textContent='Set Run speed to 300%? This requests three times the programmed feed rate, subject to machine limits. Check the cutter, material and workholding before increasing it.';modal.dialog.append(note);
            modal.add('Set 300%',async()=>{modal.dialog.close();try{await applyRunSpeed(percent);}catch(error){homingNotice(error.message);}},'#b26a00');modal.add('Cancel',()=>modal.dialog.close());modal.open();
          }else applyRunSpeed(percent).catch(error=>homingNotice(error.message));
        }
        value.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();value.blur();}});
        value.addEventListener('blur',()=>requestRunSpeed(value.value.trim()?Number(value.value):NaN));
        const buttons={};
        for(const [action,label] of [['minus','▼'],['plus','▲'],['min','Min'],['half','50%'],['max','Max']]){
          const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.lowriderRunAction=action;
          button.setAttribute('aria-label',`${action==='minus'?'Decrease':action==='plus'?'Increase':action==='min'?'Minimum':action==='half'?'50 percent':'Maximum'} run speed`);
          button.title=action==='max'?'300% — confirmation required':action==='min'?'1%':action==='half'?'50%':`${action==='minus'?'Decrease':'Increase'} by 10 percentage points`;
          button.addEventListener('click',async()=>{
            button.disabled=true;
            try{const response=await fetch('/printer/objects/query?gcode_move&webhooks',{cache:'no-store'});const state=(await response.json()).result?.status;if(!response.ok||state?.webhooks?.state!=='ready')throw Error('Klipper is not ready');const current=Math.round(state.gcode_move.speed_factor*100);requestRunSpeed(action==='min'?1:action==='half'?runSpeedPreset(current):action==='max'?300:Math.max(1,Math.min(300,current+(action==='minus'?-10:10))));}
            catch(error){homingNotice(error.message);}finally{button.disabled=false;}
          });buttons[action]=button;
        }
        bar.append(buttons.minus,value,buttons.plus,buttons.min,buttons.half,buttons.max);
        const endstops=document.getElementById('lowrider-endstops');(endstops||document.getElementById('lowrider-horizontal-z')||pad).after(bar);
      }
      const title = toolhead.querySelector('.panel-toolbar .subheading');
      if (title && title.textContent !== 'Spindle Location') title.textContent = 'Spindle Location';
      toolhead.querySelectorAll('button.btnHomeAxis').forEach(button => {
        button.style.display = 'none';
        if (!button.nextElementSibling?.classList.contains('lowrider-axis-label')) {
          const label = document.createElement('span');
          label.className = 'lowrider-axis-label';
          label.textContent = button.textContent.trim();
          label.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;min-width:36px;font-weight:bold;vertical-align:middle';
          button.after(label);
        }
      });
      toolhead.querySelectorAll('button').forEach(button => {
        if(['ALL','XY'].includes(button.textContent.trim())){button.style.display='none';if(button.textContent.trim()==='ALL'){const row=button.closest('.row.no-gutters');if(row)row.style.display='none';}}
      });
      const homes = Array.from(toolhead.querySelectorAll('button.btnHomeAxis'));
      const xHome = homes.find(button => button.textContent.trim() === 'X');
      const yHome = homes.find(button => button.textContent.trim() === 'Y');
      if (xHome && yHome && !toolhead.querySelector('#lowrider-xy-cross')) {
        const xGroup = xHome.parentElement;
        const yGroup = yHome.parentElement;
        const xRow = xGroup.closest('.row--dense');
        const yRow = yGroup.closest('.row--dense');
        if (xRow && yRow && xRow.parentElement === yRow.parentElement) {
          const cross = document.createElement('div');
          cross.id = 'lowrider-xy-cross';
          cross.setAttribute('role', 'group');
          cross.setAttribute('aria-label', 'X and Y directional jogging');
          cross.style.cssText = 'display:grid;grid-template-columns:repeat(7,minmax(0,1fr));grid-template-rows:repeat(7,30px);gap:3px;margin:8px 0 14px';
          xRow.before(cross);
          cross.append(xRow, yRow);
          for (const group of [xGroup, yGroup]) {
            group.style.display = 'contents';
            group.parentElement.style.display = 'contents';
            group.closest('.row--dense').style.display = 'contents';
          }
          for (const [group, axis] of [[xGroup, 'X'], [yGroup, 'Y']]) {
            const negative = [], positive = [];
            group.querySelectorAll('button:not(.btnHomeAxis)').forEach(button => {
              const text = button.textContent.trim();
              if (/^[−–-]/.test(text)) negative.push(button);
              if (/^\+/.test(text)) positive.push(button);
              button.style.cssText += ';min-width:0;width:100%;max-width:none;padding:0;flex:none;border-radius:3px';
              button.setAttribute('aria-label', `Jog ${axis} ${text} mm`);
              button.title = `${axis} ${text} mm`;
            });
            negative.forEach((button, i) => {
              button.style.gridColumn = axis === 'X' ? String(i + 1) : '4';
              button.style.gridRow = axis === 'X' ? '4' : String(7 - i);
            });
            positive.forEach((button, i) => {
              button.style.gridColumn = axis === 'X' ? String(5 + i) : '4';
              button.style.gridRow = axis === 'X' ? '4' : String(3 - i);
            });
            const label = group.querySelector('.lowrider-axis-label');
            if (label && axis === 'X') {
              label.textContent = 'X / Y';
              label.style.cssText = 'grid-column:4;grid-row:4;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:12px';
            } else if (label) label.style.display = 'none';
          }
        }
      }
      mountJogPad(toolhead, homes);
    }
    if (zero) {
      zero.querySelectorAll('.v-item-group').forEach(wrapper => {
        if (wrapper.querySelector('button')?.textContent.trim().replace(/\s+/g, ' ') === 'ZERO Z') {
          wrapper.classList.add('lowrider-zero-z');
        }
      });
      const zeroContent = zero.querySelector('.v-card__text');
      const endstopDisplay = document.getElementById('lowrider-endstops');
      const travel = document.getElementById('lowrider-work-travel');
      const jogPad = document.getElementById('lowrider-jog-pad');
      if (!document.getElementById('pendant-jog-zone') && jogPad && endstopDisplay && endstopDisplay.previousElementSibling?.id !== (document.getElementById('lowrider-stepper-timeout-row')?'lowrider-stepper-timeout-row':document.getElementById('lowrider-feed-factor')?'lowrider-feed-factor':'lowrider-horizontal-z')) {
        endstopDisplay.style.cssText = 'margin:8px 0;min-width:0';
        const grid = endstopDisplay.children[1];
        grid.style.gap = '3px';
        grid.querySelectorAll('[role="status"]').forEach(tile => {tile.style.fontSize='10px';tile.style.padding='5px 0';});
        const zBar=document.getElementById('lowrider-stepper-timeout-row')||document.getElementById('lowrider-feed-factor')||document.getElementById('lowrider-horizontal-z');if(zBar)zBar.after(endstopDisplay);
      }
      const homing = document.querySelector('.macrogroup_lowrider-homing_panel');
      if (toolhead && homing) {
        const allButton = Array.from(toolhead.querySelectorAll('button')).find(button => button.textContent.trim() === 'ALL');
        const nativeDisable = allButton?.parentElement.querySelector('button:last-child');
        const homeGrid = homing.querySelector('.col.text-center');
        if (nativeDisable && nativeDisable !== allButton && homeGrid && !nativeDisable.classList.contains('lowrider-disable-steppers')) {
          nativeDisable.classList.add('lowrider-disable-steppers', 'lowrider-common-button');
          nativeDisable.setAttribute('data-lowrider-disable-steppers', 'true');
          nativeDisable.setAttribute('aria-label', 'Disable Steppers');
          const content = nativeDisable.querySelector('.v-btn__content') || nativeDisable;
          content.append(document.createTextNode(' Disable Steppers'));
          homeGrid.append(nativeDisable);
        }
      }
      zero.querySelectorAll('button').forEach(button => {
        if (['HOME ALL', 'ZERO Z'].includes(button.textContent.trim().replace(/\s+/g, ' '))) {
          button.classList.add('lowrider-common-button');
        }
      });
      if (!document.getElementById('pendant-jog-zone') && jogPad && homing && homing.parentElement !== jogPad) {
        homing.style.cssText = 'grid-column:5/span 3;grid-row:1/span 4;align-self:center;margin:0!important;box-shadow:none;border-radius:0;background:transparent';
        const toolbar = homing.querySelector('.panel-toolbar');
        if (toolbar) toolbar.style.display = 'none';
        jogPad.append(homing);
      }
      homing?.querySelectorAll('button').forEach(button => {
        const nativeName = button.textContent.trim().replace(/\s+/g,'_').toUpperCase();
        const command = button.dataset.lowriderHomeCommand || (['HOME_ALL','HOME_X','HOME_Y','HOME_Z','HOME_ZX'].includes(nativeName) ? nativeName : '');
        if (!command) return;
        button.dataset.lowriderHomeCommand = command;
        const wrapper = button.closest('.v-item-group');
        if (command === 'HOME_ZX') {wrapper?.style.setProperty('display','none','important');return;}
        if (command === 'HOME_ALL') {
          button.setAttribute('data-lowrider-home-all','true');
          if (wrapper) {wrapper.style.gridColumn='1 / -1';wrapper.style.order='4';}
        } else if (wrapper) wrapper.style.order=String('XYZ'.indexOf(command.slice(5))+1);
        const content = button.querySelector('.v-btn__content') || button;
        const label = command === 'HOME_ALL' ? 'Home All' : command.slice(5);
        if (content.textContent.trim() !== label) content.textContent=label;
        button.setAttribute('aria-label',`Home ${command.slice(5).toLowerCase()}`);
      });
      const homingContent = homing?.querySelector('.v-card__text');
      if (homingContent && !homing.querySelector('.lowrider-homing-heading')) {
        const heading=document.createElement('div');heading.className='lowrider-homing-heading';heading.textContent='';heading.style.display='none';
        heading.style.cssText='font-size:11px;opacity:.8;margin-bottom:5px';homingContent.prepend(heading);
      }
      if (zeroContent && !zero.querySelector('#lowrider-work-travel')) {
        const range = document.createElement('div');
        range.id = 'lowrider-work-travel';
        range.style.cssText = 'margin-top:12px;padding-top:12px;border-top:1px solid rgba(128,128,128,.3)';
        const heading = document.createElement('div');
        heading.textContent = 'Work travel range · mm';
        heading.style.cssText = 'font-size:12px;opacity:.8;margin-bottom:6px';
        const values = document.createElement('div');
        values.id = 'lowrider-work-travel-values';
        values.textContent = 'Reading current work zero…';
        values.style.cssText = 'white-space:pre-line;font-variant-numeric:tabular-nums;line-height:1.7';
        range.append(heading, values);
        zeroContent.append(range);
      }
    }
    if (zero && toolhead && status) {
      const column = toolhead.parentElement;
      column.style.display = 'flex';
      column.style.flexDirection = 'column';
      Array.from(column.children).forEach(child => {
        child.style.order = child === toolhead ? '1' : child.contains(status) ? '2' : '3';
      });
      const toolContent = Array.from(toolhead.children).find(child => child.tagName === 'DIV');
      if (toolContent && zero.parentElement !== toolContent) {
        zero.style.cssText = 'margin:0!important;border-top:1px solid rgba(128,128,128,.3);border-radius:0;box-shadow:none';
        toolContent.append(zero);
      }
    }
    document.querySelectorAll('.macros-panel button, .macrogroup_lowrider-general_panel button').forEach(button => {
      const name = button.textContent.trim().replace(/\s+/g, ' ').toUpperCase();
      if(['CNC PAUSE CAPTURE XY','CNC RESUME ORDERED','CONTINUE CUT','END JOB','START JOB','M0','PAUSE JOB'].includes(name)&&!button.dataset.lowriderJobAction){button.style.display='none';}
      if (['LED ON', 'LED OFF', 'LED BREATHE', 'LED BREATHE STOP'].includes(name)) {
        button.style.display = 'none';
      }
    });
    const macroPanel=document.querySelector('.macrogroup_lowrider-general_panel,.macros-panel');
    if(macroPanel&&!document.getElementById('lowrider-job-controls')){
      const controls=document.createElement('div');controls.id='lowrider-job-controls';controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px;padding:12px';
      for(const [action,label] of [['pause','Pause Job'],['resume','Resume Job'],['abort','Abort Job']]){
        const button=document.createElement('button');button.type='button';button.textContent=label;button.dataset.lowriderJobAction=action;button.style.cssText=`min-height:40px;padding:6px 12px;color:white;border:1px solid #777;border-radius:4px;background:${action==='abort'?'#b71c1c':'#1976d2'}`;
        button.addEventListener('click',async()=>{
          if(action==='abort'){
            const modal=cncDialog('Abort the current job?');const note=document.createElement('p');note.textContent='This cancels the file and cannot resume it. Already queued moves may finish. Turn the router off manually. Use Emergency Stop for an immediate fault stop.';modal.dialog.append(note);
            modal.add('Abort Job',async()=>{modal.dialog.close();button.disabled=true;try{const res=await fetch('/printer/print/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const data=await res.json();if(!res.ok||data.error)throw Error(data.error?.message||'Cancel failed');homingNotice('Job cancelled. Turn router off manually.');}catch(e){homingNotice(e.message);}finally{updateAndroidStatus(controlStatus);}},'#b71c1c');modal.add('Cancel',()=>modal.dialog.close());modal.open();return;
          }
          button.disabled=true;try{const response=await fetch('/printer/objects/query?print_stats&pause_resume',{cache:'no-store'});const current=(await response.json()).result?.status;if(action==='resume'&&!current?.pause_resume?.is_paused)throw Error('No paused job');if(action==='pause'&&current?.print_stats?.state!=='printing')throw Error('No running job');await runCncCommand(action==='pause'?'PAUSE':'RESUME');}catch(e){homingNotice(e.message);}finally{updateAndroidStatus(controlStatus);}
        });controls.append(button);
      }(macroPanel.querySelector('.v-card__text')||macroPanel).append(controls);
    }
    mountAndroidControls(toolhead,zero);
    mountKeepoutPanel(toolhead);
    updateAvailability();
    const panel=document.querySelector('.miscellaneous-panel');if(panel)panel.style.setProperty('display','none','important');
  }
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; mount(); });
  }).observe(document.documentElement, { childList: true, subtree: true });
  mount();
  refreshEndstops();
})();
