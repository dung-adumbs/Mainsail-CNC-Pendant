/* Time-based router-battery reminders. Timing and forced Pause live on the Pi. */
(() => {
  'use strict';
  const ui=window.PendantUI;if(!ui)return;
  let status={enabled:false},busy=false,reminderDialog=null;
  const minutesInput=value=>{const input=ui.el('input');input.type='number';input.inputMode='numeric';input.min='1';input.max='180';input.step='1';input.value=String(Math.round(value||15));input.setAttribute('aria-label','Next battery reminder minutes');return input;};
  async function read(){status=await ui.api('/machine/cnc_health/battery_status');return status;}
  function duration(seconds){seconds=Math.max(0,Math.round(seconds||0));return Math.floor(seconds/60)+'m '+String(seconds%60).padStart(2,'0')+'s';}
  async function control(m,mode){
    const value=await read();if(!value.enabled)return {enabled:false,ready:()=>true,onChange:()=>{},commit:async()=>{}};
    const box=ui.el('section',undefined,'cnc-battery-control');box.append(ui.el('strong',mode==='start'?'Router battery':'Router battery check'));
    const profile=ui.el('select');profile.setAttribute('aria-label','Router battery size');for(const item of value.profiles||[]){const option=ui.el('option',item.name);option.value=item.id;profile.append(option);}profile.value=value.profile||profile.options[0]?.value||'';
    const profileRow=ui.el('label','Battery','dialog-field');profileRow.append(profile);box.append(profileRow);
    const next=minutesInput(value.reminder_minutes);const nextRow=ui.el('label','Remind again (minutes)','dialog-field');nextRow.append(next);box.append(nextRow);
    const check=ui.el('input');check.type='checkbox';const label=ui.el('label');label.append(check,document.createTextNode(mode==='start'?' Battery level checked before starting.':' Battery level checked during this tool change/pause.'));box.append(label);
    let full=null;if(mode==='start'){full=ui.el('input');full.type='checkbox';const fullLabel=ui.el('label');fullLabel.append(full,document.createTextNode(' This battery was fully charged at job start.'));box.append(fullLabel);}
    box.append(ui.el('small',value.full_confirmed?'Pack runtime '+duration(value.battery_seconds)+'.':'Runtime is approximate; this pack was not confirmed full.'));m.insert(box);
    return {enabled:true,ready:()=>check.checked,onChange:fn=>check.addEventListener('change',()=>fn(check.checked)),commit:async filename=>{
      if(!check.checked)throw Error('Check and acknowledge the router battery level.');
      const n=Number(next.value);if(!Number.isFinite(n)||n<1||n>180)throw Error('Choose a battery reminder from 1 to 180 minutes.');
      const path=mode==='start'?'/machine/cnc_health/battery_start':'/machine/cnc_health/battery_acknowledge';
      await ui.api(path,'POST',{profile:profile.value,next_minutes:String(n),filename:filename||'',full:String(!!full?.checked)});await read();
    }};
  }
  function showReminder(){
    if(reminderDialog?.open||document.querySelector('dialog:modal'))return;
    const m=ui.modal(status.pause_attempted?'Router paused — check battery':'Check router battery');reminderDialog=m.dialog;m.dialog.classList.add('cnc-operational-dialog');m.dialog.querySelector('.dialog-actions button').textContent='Keep open';
    m.insert(ui.el('p',(status.profile_name||'Battery')+' · pack runtime '+duration(status.battery_seconds)+(status.full_confirmed?'':' · start charge unknown'),'cnc-attention-summary'));
    const countdown=ui.el('p');countdown.dataset.cncBatteryCountdown='true';m.insert(countdown);const next=minutesInput(status.reminder_minutes);const row=ui.el('label','Next reminder (minutes)','dialog-field');row.append(next);m.insert(row);
    const update=()=>{countdown.textContent=status.countdown!==null&&status.countdown!==undefined?'A controlled pause will be requested in '+Math.ceil(status.countdown)+' seconds unless acknowledged.':'The job is paused or awaiting acknowledgment.';};update();
    m.add('Battery checked',async()=>{await ui.api('/machine/cnc_health/battery_acknowledge','POST',{next_minutes:next.value});m.dialog.close();await poll();});
    m.add('Battery changed / full',async()=>{await ui.api('/machine/cnc_health/battery_change','POST',{profile:status.profile,next_minutes:next.value,filename:status.filename||''});m.dialog.close();await poll();});
    m.dialog.addEventListener('close',()=>{reminderDialog=null;});
  }
  async function poll(){if(busy)return;busy=true;try{await read();const countdown=document.querySelector('[data-cnc-battery-countdown]');if(countdown)countdown.textContent=status.countdown!==null&&status.countdown!==undefined?'A controlled pause will be requested in '+Math.ceil(status.countdown)+' seconds unless acknowledged.':'The job is paused or awaiting acknowledgment.';if(status.enabled&&status.ack_required)showReminder();}catch(_){}finally{busy=false;}}
  window.CncBattery={control,status:()=>status,refresh:read};setInterval(poll,1200);poll();
})();
