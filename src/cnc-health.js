/* Read-only monitoring plus explicit Pause/Acknowledge. Never resumes. */
(() => {
  'use strict';
  const ui=window.PendantUI;if(!ui)return;
  let health={state:'unavailable',message:'Connecting to hardware monitor',rows:[]},dialog=null;
  function indicator(parent,id){if(!parent||document.getElementById(id))return;const b=ui.el('button','●','cnc-health-indicator');b.id=id;b.type='button';b.append(ui.el('small','Health'));b.addEventListener('click',show);parent.append(b);}
  function paint(){
    indicator(document.getElementById('lowrider-jog-pad'),'pendant-health');
    indicator(document.getElementById('pendant-running-job'),'pendant-job-health');
    for(const b of document.querySelectorAll('.cnc-health-indicator')){b.dataset.state=health.state;b.title='Machine health: '+health.message;b.setAttribute('aria-label','Machine health: '+health.state+'. '+health.message);}
    if(!dialog?.open)return;
    const summary=dialog.querySelector('[data-health-summary]');summary.textContent=health.message+(health.countdown!==null&&health.countdown!==undefined?' · Auto-pause in ~'+Math.ceil(health.countdown)+' s':'');summary.dataset.state=health.state;
    const list=dialog.querySelector('[data-health-rows]'),alerts=dialog.querySelector('[data-health-alerts]');list.replaceChildren();alerts?.replaceChildren();
    for(const row of health.rows||[]){const line=ui.el('div',undefined,'cnc-health-row');line.classList.toggle('cnc-health-warning',!!row.warning);line.append(ui.el('strong',row.label),ui.el('span',row.value));list.append(line);if(row.warning&&alerts)alerts.append(line.cloneNode(true));}
    for(const text of health.unknown||[]){list.append(ui.el('p',text,'cnc-health-unknown'));alerts?.append(ui.el('p',text,'cnc-health-unknown'));}
    const pause=dialog.querySelector('[data-health-pause]');pause.disabled=!health.running||health.stale;pause.hidden=!health.running;
    const ack=dialog.querySelector('[data-health-ack]'),check=dialog.querySelector('[data-health-confirm]');
    const clear=health.ready&&!health.stale&&!health.warnings?.length&&!health.unknown?.length;
    check.disabled=!health.ack_required||!clear;if(check.disabled)check.checked=false;
    ack.disabled=!health.ack_required||!clear||!check.checked;ack.hidden=!health.ack_required;check.parentElement.hidden=!health.ack_required;
  }
  function show(){
    if(dialog?.open)return;
    const m=ui.modal('Machine health');dialog=m.dialog;
    const summary=ui.el('p');summary.dataset.healthSummary='true';summary.className='cnc-health-summary';m.insert(summary);
    const alerts=ui.el('div');alerts.dataset.healthAlerts='true';m.insert(alerts);const list=ui.el('div');list.dataset.healthRows='true';list.className='cnc-health-readings';m.insert(list);
    const help=ui.el('p','Hardware warnings pause a running job after 10 seconds and flash the work light. CPU and queued seconds are informational. Pause is not an emergency stop.');m.insert(help);
    const label=ui.el('label'),check=ui.el('input');check.type='checkbox';check.dataset.healthConfirm='true';label.append(check,document.createTextNode(' The warning has cleared; I have checked the machine.'));m.insert(label);check.addEventListener('change',paint);
    const pause=m.add('Pause now',async()=>{await ui.api('/machine/cnc_health/pause','POST',{});m.feedback.textContent='Pause requested. Wait for buffered motion and the pause macro to finish.';});pause.dataset.healthPause='true';
    const ack=m.add('Acknowledge cleared warning',async()=>{await ui.api('/machine/cnc_health/acknowledge','POST',{});check.checked=false;m.feedback.textContent='Acknowledged. Reverify and explicitly Resume when ready.';await poll();});ack.dataset.healthAck='true';
    dialog.dataset.detailsActions='all';ui.reviewTabs(m,[list,help],'Attention');dialog.addEventListener('close',()=>{dialog=null;});paint();
  }
  let busy=false;
  async function poll(){if(busy)return;busy=true;try{health=await ui.api('/machine/cnc_health/status');if(!health.enabled)health={...health,state:'unavailable',message:'Hardware monitor not activated'};}catch(_){health={state:'unavailable',message:'Hardware status unavailable',rows:[],stale:true};}finally{busy=false;paint();}}
  setInterval(poll,1200);poll();
})();
