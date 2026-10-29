/* Responsive dashboard host. The standalone pendant and native panels stay available. */
(() => {
  let queued=false, panel=null, hiddenNative=null, timer=null, desktop=false;
  const style=document.createElement('style');style.textContent=`
    #cnc-dashboard-panel{background:#222;color:#eee;border-radius:6px;margin-bottom:24px;overflow:hidden;width:100%}
    #cnc-dashboard-panel .cnc-dashboard-heading{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;font:16px Arial,sans-serif}
    #cnc-dashboard-panel .cnc-dashboard-heading strong{flex:1}
    #cnc-dashboard-panel button,#cnc-dashboard-panel a{font:14px Arial,sans-serif;color:#b4d9fa;background:transparent;border:1px solid #666;border-radius:4px;padding:6px 9px;text-decoration:none;cursor:pointer}
    #cnc-dashboard-panel iframe{display:block;border:0;width:100%;height:860px;background:#171717}
    .cnc-native-dashboard-hidden{display:none!important}
    #cnc-dashboard-panel [hidden]{display:none!important}
    #cnc-dashboard-notice{padding:8px 12px;font-size:14px}
    @media(max-width:599px){#cnc-dashboard-panel{margin-bottom:12px}#cnc-dashboard-panel iframe{height:860px}}

    html.cnc-desktop-shell #cnc-dashboard-panel{margin-bottom:0}
    html.cnc-desktop-shell .topbar{width:var(--cnc-sidebar-width,220px)!important;left:0!important;right:auto!important;height:auto!important;z-index:7!important}
    html.cnc-desktop-shell .topbar>.v-toolbar__content{display:grid;grid-template-columns:repeat(3,1fr);height:auto!important;gap:4px;padding:6px}
    html.cnc-desktop-shell .topbar .v-app-bar__nav-icon,html.cnc-desktop-shell .topbar .upload-and-start-button,html.cnc-desktop-shell .topbar .spacer{display:none!important}
    html.cnc-desktop-shell .topbar .v-toolbar__content>a{grid-column:1;justify-self:center}
    html.cnc-desktop-shell .topbar .v-toolbar__title{grid-column:2/span 2;font-size:17px;padding:0!important;margin:0!important}
    html.cnc-desktop-shell .topbar .emergency-button{grid-column:1/-1;width:100%;min-height:36px;background:#a71919;color:white!important}
    html.cnc-desktop-shell .topbar .v-toolbar__content>.v-menu{display:none}
    html.cnc-desktop-shell .v-navigation-drawer{top:0!important;max-height:100vh!important;transform:translateX(0)!important}
    html.cnc-desktop-shell .v-navigation-drawer__content{padding-top:var(--cnc-sidebar-header-height,140px)}
    html.cnc-desktop-shell .v-main{padding-top:0!important;padding-left:var(--cnc-sidebar-width,220px)!important}
    html.cnc-desktop-shell #page-container{padding-top:8px!important;padding-bottom:0!important}
  `;document.head.append(style);
  function setShell(on){document.documentElement.classList.toggle('cnc-desktop-shell',on);if(on){const drawer=document.querySelector('.v-navigation-drawer'),header=document.querySelector('header.topbar');document.documentElement.style.setProperty('--cnc-sidebar-width',(parseFloat(drawer?.style.width)||220)+'px');if(header)document.documentElement.style.setProperty('--cnc-sidebar-header-height',(header.getBoundingClientRect().height+6)+'px');}}
  function showNative(){setShell(false);if(hiddenNative){hiddenNative.classList.remove('cnc-native-dashboard-hidden');hiddenNative=null;}}
  function fitHeight(){if(!desktop||!panel)return;const frame=panel.querySelector('iframe');if(frame)frame.style.height=Math.max(440,innerHeight-panel.getBoundingClientRect().top-12)+'px';}
  function destroy(){clearTimeout(timer);showNative();panel?.dispatchEvent(new Event("cnc-dashboard-destroy"));panel?.remove();panel=null;}
  function mount(){
    const dashboard=Array.from(document.querySelectorAll('a')).find(a=>a.getAttribute('href')==='/'&&/dashboard/i.test(a.textContent));
    if(dashboard&&!document.getElementById('cnc-pendant-navigation')){
      const link=dashboard.cloneNode(true);link.id='cnc-pendant-navigation';link.href='/cnc-pendant.html';link.classList.remove('v-list-item--active','v-list-item--exact-active');link.removeAttribute('aria-current');link.removeAttribute('aria-selected');(link.querySelector('.v-list-item__title')||link).textContent='CNC Pendant';link.setAttribute('aria-label','CNC Pendant');link.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();location.assign('/cnc-pendant.html');});dashboard.after(link);
    }
    if(dashboard&&!document.getElementById('cnc-standard-navigation')){const link=dashboard.cloneNode(true);link.id='cnc-standard-navigation';link.href='/?standard=1';link.classList.remove('v-list-item--active','v-list-item--exact-active');(link.querySelector('.v-list-item__title')||link).textContent='Standard dashboard';link.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();location.assign('/?standard=1');});document.getElementById('cnc-pendant-navigation')?.after(link);}
    if(location.pathname!=='/'||new URLSearchParams(location.search).get('standard')==='1'){if(panel)destroy();return;}
    const machine=document.querySelector('.machine-settings-panel'),column=machine?.closest('.col');
    if(!column)return;
    const wide=matchMedia('(min-width:1200px)').matches,row=column.parentElement;
    if(panel?.isConnected&&desktop===wide){if(desktop){if(panel.nextElementSibling!==row)row.before(panel);fitHeight();}else if(panel.parentElement!==column)column.prepend(panel);return;}
    if(panel)destroy();desktop=wide;
    panel=document.createElement('section');panel.id='cnc-dashboard-panel';panel.setAttribute('aria-label','CNC Pendant dashboard panel');
    const heading=document.createElement('div');heading.className='cnc-dashboard-heading';
    const title=document.createElement('strong');title.textContent='CNC Pendant';
    const link=document.createElement('a');link.href='/cnc-pendant.html';link.textContent='Open full pendant';
    const toggle=document.createElement('button');toggle.textContent=desktop?'Standard dashboard':'Standard job panel';toggle.type='button';toggle.setAttribute('aria-pressed','false');
    const notice=document.createElement('div');notice.id='cnc-dashboard-notice';notice.textContent='Loading pendant…';notice.setAttribute('role','status');
    const frame=document.createElement('iframe');frame.title='CNC Pendant';frame.src='/cnc-pendant.html?embedded=1'+(desktop?'&workspace=1':'');frame.allow='fullscreen';
    let standard=false,ready=false;
    const native=()=>desktop?row:document.querySelector('.status-panel');
    const apply=()=>{showNative();setShell(ready&&!standard&&desktop);if(ready&&!standard){const status=native();if(status){hiddenNative=status;status.classList.add('cnc-native-dashboard-hidden');}}toggle.setAttribute('aria-pressed',String(standard));toggle.textContent=desktop?(standard?'Hide standard dashboard':'Standard dashboard'):(standard?'Hide standard job panel':'Standard job panel');};
    toggle.addEventListener('click',()=>{standard=!standard;apply();});
    const receive=event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow||event.data?.type!=='cnc-pendant-ready')return;ready=true;notice.hidden=true;clearTimeout(timer);apply();fitHeight();};
    window.addEventListener('message',receive);
    frame.addEventListener('load',()=>{try{if(frame.contentDocument?.querySelector(desktop?'#cnc-workspace [data-docked=console]':'#pendant-live-state')){ready=true;notice.hidden=true;clearTimeout(timer);apply();fitHeight();}}catch(_){}});
    frame.addEventListener('error',()=>{ready=false;showNative();notice.hidden=false;notice.textContent='Pendant unavailable. Standard job panel remains available; use Open full pendant to retry.';});
    timer=setTimeout(()=>{if(!ready){showNative();notice.textContent='Pendant is taking longer to load. The standard job panel remains available.';}},15000);
    heading.append(title,link,toggle);panel.append(heading,notice,frame);if(desktop)row.before(panel);else column.prepend(panel);
    if(desktop){heading.hidden=true;fitHeight();}
    panel.addEventListener('cnc-dashboard-destroy',()=>window.removeEventListener('message',receive),{once:true});
  }
  function schedule(){if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;mount();});}
  new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('popstate',schedule);window.addEventListener('resize',schedule);mount();
})();
