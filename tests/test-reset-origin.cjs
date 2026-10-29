const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('src/cnc-pendant-core.js','utf8');
(async()=>{
 let status,commands=[];const saved={};
 const settings={spoilboardX:8.2,spoilboardY:9.5,lastWorkOriginX:40,lastWorkOriginY:50};
 const ctx={window:{CncSettings:{get:key=>settings[key],set:async(key,value)=>{settings[key]=value;saved[key]=value}}},AbortSignal,fetch:async(path,opts)=>path.includes('objects/query')?{ok:true,json:async()=>({result:{status}})}:{ok:true,json:async()=>{commands.push(JSON.parse(opts.body).script);return{};}},manualMotionReason:s=>s.webhooks.state!=='ready'||s.virtual_sdcard.is_active||s.print_stats.state==='printing'||s.toolhead.print_time+.05>s.toolhead.estimated_print_time?'Not idle':'',isMachinePaused:s=>s.pause_resume.is_paused};
 vm.createContext(ctx);vm.runInContext(source.slice(source.indexOf('  async function runCncCommand('),source.indexOf('  function cncDialog(')),ctx);
 const good=()=>({webhooks:{state:'ready'},virtual_sdcard:{is_active:false},print_stats:{state:'complete'},pause_resume:{is_paused:false},toolhead:{homed_axes:'xyz',print_time:0,estimated_print_time:1},gcode_move:{position:[123,456,84],gcode_position:[100,400,80]}});
 status=good();await ctx.runCncCommand('RESET_WORK_ORIGIN',true);assert.equal(commands[0],'SET_GCODE_OFFSET X=0 Y=0 Z=0 MOVE=0\nG92 X123.000000000 Y456.000000000 Z84.000000000');assert(!/\bG[01]\b|MOVE=1/.test(commands[0]));
 await ctx.runCncCommand('RESET_XY_TO_MACHINE',true);assert.equal(commands[1],'SET_GCODE_OFFSET X=0 Y=0 MOVE=0\nG92 X123.000000000 Y456.000000000');
 await ctx.runCncCommand('RESET_XY_TO_SPOILBOARD',true);assert.equal(commands[2],'SET_GCODE_OFFSET X=0 Y=0 MOVE=0\nG92 X114.800000000 Y446.500000000');assert.equal(saved.lastWorkOriginX,8.2);assert.equal(saved.lastWorkOriginY,9.5);
 settings.lastWorkOriginX=40;settings.lastWorkOriginY=50;await ctx.runCncCommand('RESET_XY_TO_LAST',true);assert.equal(commands[3],'SET_GCODE_OFFSET X=0 Y=0 MOVE=0\nG92 X83.000000000 Y406.000000000');
 assert(commands.slice(1).every(s=>!/\bG[01]\b|MOVE=1|\bZ[-=0-9]/.test(s)));
 for(const change of [s=>s.pause_resume.is_paused=true,s=>s.toolhead.homed_axes='xy',s=>s.virtual_sdcard.is_active=true,s=>s.print_stats.state='printing',s=>s.toolhead.print_time=2,s=>s.gcode_move.position[2]=NaN]){status=good();change(status);commands=[];await assert.rejects(()=>ctx.runCncCommand('RESET_WORK_ORIGIN',true));assert.equal(commands.length,0);}
 console.log('PASS reset uses fresh coordinates, persists Pendant XY origins, restores machine/spoilboard/last modes, and sends no movement.');
})().catch(e=>{console.error(e);process.exit(1)});
