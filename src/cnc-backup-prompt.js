/* Scheduled backup decisions only. Never dispatches machine commands. */
(() => {
  'use strict';
  const ui=window.PendantUI;if(!ui)return;
  const path=key=>'/server/database/item?namespace=cnc_maintenance&key='+key;
  const read=async key=>{const r=await fetch(path(key),{cache:'no-store',signal:AbortSignal.timeout(4000)});if(r.status===404)return null;const d=await r.json();if(!r.ok||d.error)throw Error('Backup status unavailable');return d.result.value;};
  const write=(key,value)=>ui.api('/server/database/item','POST',{namespace:'cnc_maintenance',key,value});
  const eligible=s=>s?.webhooks?.state==='ready'&&['standby','complete','cancelled','error'].includes(s?.print_stats?.state)&&s?.pause_resume?.is_paused===false&&s?.virtual_sdcard?.is_active===false&&['Idle','Ready'].includes(s?.idle_timeout?.state);
  let latest=null,lastActivity=0,lastCheck=0,busy=false,shown=null,dialog=null,answering=false;
  function activity(event){
    if(!event.isTrusted||event.target?.closest?.('[data-backup-prompt]'))return;
    const now=Date.now();if(now-lastActivity<30000)return;lastActivity=now;
    write('backup_activity',{at:now/1000}).catch(()=>{});
  }
  for(const name of ['pointerdown','keydown'])document.addEventListener(name,activity,{passive:true,capture:true});
  function close(){dialog?.close();dialog=null;}
  async function check(){
    if(!eligible(latest)||busy||Date.now()-lastCheck<5000)return;busy=true;lastCheck=Date.now();
    try{
      const p=await read('backup_prompt');
      if(!p||p.state!=='pending'||p.expires<=Date.now()/1000||!eligible(latest)){if(!answering)close();return;}
      if(dialog||shown===p.id||document.querySelector('dialog[open]:not([data-docked])'))return;
      shown=p.id;const m=ui.modal('Scheduled backup');dialog=m.dialog;dialog.dataset.backupPrompt='true';
      const cancel=dialog.querySelector('.dialog-actions button');cancel.hidden=true;
      m.insert(ui.el('p','You recently used the Pendant. Back up now, or defer until you finish?'));
      m.insert(ui.el('p','No response defers the backup. Running or paused jobs always take priority.'));
      const answer=async action=>{answering=true;try{const current=await read('backup_prompt');if(current?.id!==p.id||current?.state!=='pending'||current.expires<=Date.now()/1000)throw Error('This request has expired. The backup was deferred.');if(action==='now'&&!eligible(latest))throw Error('Machine is busy. The backup will be deferred.');await write('backup_choice',{id:p.id,action,at:Date.now()/1000});close();}finally{answering=false;}};
      m.add('Defer until finished',()=>answer('defer'));m.add('Back up now',()=>answer('now'));
      dialog.addEventListener('cancel',e=>{e.preventDefault();answer('defer').catch(()=>close());});
    }catch(_){if(!answering)close();}finally{busy=false;}
  }
  document.addEventListener('cnc-pendant-status',event=>{latest=event.detail;if(!eligible(latest))close();check();});
})();
