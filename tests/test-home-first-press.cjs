const fs=require('fs'),vm=require('vm'),assert=require('assert');const source=fs.readFileSync('src/cnc-pendant-core.js','utf8');
const motion=source.slice(source.indexOf('  function motionStillQueued('),source.indexOf('  function manualMotionReason('));
const helper=source.slice(source.indexOf('  function homeButtonColor('),source.indexOf("  document.addEventListener('click', event => {",source.indexOf('  function homeButtonColor(')));
const state={webhooks:{state:'ready'},print_stats:{state:'standby'},pause_resume:{is_paused:false},virtual_sdcard:{is_active:false},idle_timeout:{state:'Printing'},toolhead:{homed_axes:'',print_time:10,estimated_print_time:100}};
const scripts=[],messages=[],ctx={homingPending:false,controlStatus:{},AbortSignal,updateAvailability(){},homingNotice:message=>messages.push(message),fetch:async(path,options)=>{if(options?.method==='POST'){scripts.push(JSON.parse(options.body).script);return{ok:true,json:async()=>({result:'ok'})}}return{ok:true,json:async()=>({result:{status:state}})}}};vm.createContext(ctx);vm.runInContext(motion+helper,ctx);
(async()=>{
 await ctx.runHomeCommand('HOME_ALL');assert.deepEqual(scripts,['HOME_ALL']);assert(messages.includes('HOME ALL complete.'));assert(!ctx.homingPending);
 state.print_stats.state='printing';await ctx.runHomeCommand('HOME_ALL');assert.equal(scripts.length,1);
 state.print_stats.state='standby';state.pause_resume.is_paused=true;await ctx.runHomeCommand('HOME_ALL');assert.equal(scripts.length,1);
 state.pause_resume.is_paused=false;state.toolhead.print_time=110;await ctx.runHomeCommand('HOME_ALL');assert.equal(scripts.length,1);
 state.toolhead.print_time=10;state.toolhead.homed_axes='xyz';await ctx.runHomeCommand('HOME_ALL');assert.equal(scripts.length,1);assert(messages.at(-1).includes('Already homed'));
 assert.equal(ctx.homeButtonColor(state,false),'#2e7d32');state.toolhead.homed_axes='xy';assert.equal(ctx.homeButtonColor(state,false),'#1976d2');state.toolhead.homed_axes='';assert.equal(ctx.homeButtonColor(state,false),'#1976d2');assert.equal(ctx.homeButtonColor(state,true),'#b71c1c');
 ctx.homingPending=true;await ctx.runHomeCommand('HOME_ALL');assert.equal(scripts.length,1);
 console.log('PASS: first valid Home All request sends once despite stale idle label; active/paused/moving/already-homed/duplicate requests block; home colors track XYZ.');
})().catch(error=>{console.error(error);process.exitCode=1});
