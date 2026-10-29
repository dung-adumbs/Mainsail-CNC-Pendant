const assert=require('assert/strict'),m=require('../src/cnc-run.js');
const encoder=new TextEncoder(),src=`; CNC_ROLLUP_VERSION: 1
; CNC_PROJECT_NAME: BONE
; CNC_POSTING_MEMO: Dry run
; CNC_PROJECT_STAGE: 1/2 Side A
; CNC_FUSION_OPERATION_V1: {"name":"Rough","tool":{"number":6,"description":"flat"},"rpm":16000}
G90
G21
M220 S100
PAUSE_BASE
; CNC_OPERATION: Rough
G1 X0 Y0 Z5 F600
G1 X100 Y0 Z5 F600
M400
; CNC_PROJECT_STAGE: 2/2 Side A
; CNC_FUSION_OPERATION_V1: {"name":"Finish","tool":{"number":9,"description":"ball"},"rpm":12000}
M220 S100
PAUSE_BASE
; CNC_OPERATION: Finish
G1 X100 Y100 Z5 F600
M400
`;
const bytes=encoder.encode(src),model=m.build(bytes);assert.equal(model.stages.length,2);assert.equal(model.ops[1].name,'Finish');assert.equal(model.stages[1].rpm,12000);assert.equal(model.identity.memo,'Dry run');
const slow=m.timing(model,{factor:1,velocity:100,accel:1000,corner:1}),fast=m.timing(model,{factor:3,velocity:100,accel:1000,corner:1});assert(fast.total<slow.total);assert(fast.total>slow.total/3);assert(m.timing(model,{factor:3,velocity:5,accel:1000}).total>=40);
let status={virtual_sdcard:{file_position:model.pauses[1].start},pause_resume:{is_paused:true},toolhead:{print_time:10,estimated_print_time:10}};let c=m.context(model,slow,status,0);assert(c.toolChange);assert.equal(c.stage.tool.number,9);assert.equal(c.op.name,'Finish');
status={...status,pause_resume:{is_paused:false},virtual_sdcard:{file_position:model.moves[1].end},toolhead:{print_time:15,estimated_print_time:10}};c=m.context(model,slow,status,0);assert.equal(c.buffer,5);assert(c.remaining>0);
const run=new TextDecoder().decode(m.runBytes(bytes,20));assert.equal((run.match(/^M220/gm)||[]).length,1);assert.match(run,/M220 S20/);assert.deepEqual(run.split('\n').filter(l=>/^G1 |^PAUSE_BASE/.test(l)),src.split('\n').filter(l=>/^G1 |^PAUSE_BASE/.test(l)));
for(const value of [0,301,NaN])assert.throws(()=>m.runBytes(bytes,value));assert.throws(()=>m.runBytes(encoder.encode(src.replace('M220 S100\nPAUSE_BASE\n; CNC_OPERATION: Finish','M220 S80\nPAUSE_BASE\n; CNC_OPERATION: Finish')),20));assert.throws(()=>m.runBytes(encoder.encode('G1 X5 F100'),20));
const dwell=m.build(encoder.encode(src+'G4 P2000\n'));assert(Math.abs(m.timing(dwell,{factor:1,velocity:100,accel:1000,corner:1}).total-slow.total-2)<.0001);
console.log('PASS stage/operation metadata, buffered read-ahead estimate, acceleration/override timing, pause tool identity and motion-preserving startup override');

assert.equal(m.runBytes(bytes,20).length,bytes.length);const crlf=encoder.encode(src.replaceAll('\n','\r\n'));assert.equal(m.runBytes(crlf,20).length,crlf.length);assert.match(new TextDecoder().decode(m.runBytes(crlf,20)),/^M220 S20 /m);
