/* Pure E-stop state policy. A settled, stationary tool-change pause uses confirmation. */
(() => {
  'use strict';
  const finite=Number.isFinite;
  function immediateReason(status,options={}){
    if(!status||status.webhooks?.state!=='ready')return 'Controller status is unavailable or not ready';
    const paused=status.print_stats?.state==='paused'||!!status.pause_resume?.is_paused;
    if(status.print_stats?.state==='printing'&&!paused)return 'A job is running';
    if(paused&&(!finite(options.pausedForMs)||options.pausedForMs<2000))return 'The pause is still settling';
    if(status.virtual_sdcard?.is_active)return 'File motion is still active';
    if(status.cnc_force_jog?.busy)return 'Forced motion is active';
    if(status.idle_timeout?.state==='Printing')return 'The controller reports motion';
    if(finite(status.motion_report?.live_velocity)&&Math.abs(status.motion_report.live_velocity)>.001)return 'Live motion is reported';
    const tool=status.toolhead;
    if(!finite(tool?.print_time)||!finite(tool?.estimated_print_time))return 'Motion queue status is unavailable';
    if(tool.print_time+.05>tool.estimated_print_time)return 'Motion remains queued';
    return '';
  }
  const api={immediateReason,holdMs:1000,pausedSettleMs:2000};
  if(typeof module!=='undefined'&&module.exports){module.exports=api;return;}
  window.CncEstopPolicy=api;
})();
