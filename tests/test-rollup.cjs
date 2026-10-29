const assert=require('assert/strict'),crypto=require('crypto');
const {compile}=require('../src/cnc-pendant-rollup.js');const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=n=>new TextEncoder().encode(`; CNC_POST_VERSION: Mainsail-CNC-Pendant 0.12
; Job: Part__Setup__T${n}__date
; CNC_FUSION_SETUP: Setup
; CNC_MACHINE_VENDOR: Vendor
; CNC_MACHINE_MODEL: Model
; CNC_MACHINE_DESCRIPTION: Machine
; CNC_STOCK_TOP_WORK_Z_MM: 0
; CNC_TRAVEL_PLANE_WORK_Z_MM: 5
; CNC_TRAVEL_OFFSET_MM: 5
; CNC_TRAVEL_CLEARANCE_MM: 5
; CNC_PENDANT_OPTIMIZER: V1
; Tool ${n}: cutter
; CNC_OPERATION: cut
; Operation 1 bounds mm: X 0..10 Y 0..10 Z -1..5
G90
G21
M220 S100
M400
RESPOND MSG="Tool: cutter. Check work zero."
PAUSE_BASE
G1 Z5 F180
G1 X10 Y10 F300
G1 Z5 F180
M400
RESPOND MSG="Job complete. Turn router OFF manually."
M117 Job complete - router OFF
`);
const sources=[1,2].map(n=>({path:n+'.gcode',bytes:source(n)})),project={id:'test',name:'Part',reviewed_order:true,updated:'date',stages:sources.map(s=>({path:s.path,sha256:hash(s.bytes)}))};
const out=compile(project,sources,hash),text=new TextDecoder().decode(out.bytes);assert.equal(out.moves,6);assert.equal(out.pauses,2);assert.equal(text.split('; CNC_PENDANT_OPTIMIZER: V1').length,2);assert.equal(text.split('Job complete. Turn router OFF manually.').length,2);assert.equal(out.sha256,hash(out.bytes));
assert.throws(()=>compile({...project,reviewed_order:false},sources,hash));assert.throws(()=>compile(project,[sources[1],sources[0]],hash));assert.throws(()=>compile(project,[{...sources[0],bytes:source(3)},sources[1]],hash));
const annotated=sources.map((s,i)=>({...s,bytes:new TextEncoder().encode('; CNC_BATCH_V1: '+JSON.stringify({schema:1,id:'fixture',document:'Part',setup:'Side A',count:2,stage:i+1})+'\n; CNC_FUSION_OPERATION_V1: {"name":"cut"}\n'+new TextDecoder().decode(s.bytes))}));
const annotatedProject={...project,stages:annotated.map(s=>({path:s.path,sha256:hash(s.bytes)}))};
const annotatedOut=compile(annotatedProject,annotated,hash);assert.equal(annotatedOut.moves,out.moves);assert.equal(annotatedOut.pauses,out.pauses);assert.equal((new TextDecoder().decode(annotatedOut.bytes).match(/^M220 S100$/gm)||[]).length,1);const reversed=[...annotated].reverse();assert.throws(()=>compile({...annotatedProject,stages:reversed.map(s=>({path:s.path,sha256:hash(s.bytes)}))},reversed,hash),/Fusion batch/);
console.log('PASS rollup: source order, checksums, pauses, one optimizer header/completion, rejection of stale/unreviewed sources');
