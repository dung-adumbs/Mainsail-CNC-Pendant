const assert=require('assert/strict'),run=require('../src/cnc-run.js'),encoder=new TextEncoder();
const source=`; CNC_OPERATION: Pocket
G1 X0 Y0 Z5 F60
; CNC_MOVE: TRAVEL_XY
G1 X10 Y0 F60
; CNC_MOVE: PLUNGE
G1 Z0 F60
; CNC_MOVE: CUT
G1 X20 F60
; CNC_MOVE: CUT
G1 X30 F60
; CNC_MOVE: CUT
G1 X40 F60
`;
const model=run.build(encoder.encode(source)),clock=run.timing(model,{factor:1,velocity:100}),status={virtual_sdcard:{file_position:model.size},pause_resume:{is_paused:false},toolhead:{print_time:15,estimated_print_time:10}};
const recovery=run.recoveryStart(model,clock,status);
assert.equal(recovery.context.buffer,5);assert.equal(recovery.overlap,7.5);assert.equal(recovery.boundary,'plunge');assert.equal(recovery.move.kind,'PLUNGE');assert(recovery.targetTime<recovery.context.doneTime);
const shortBuffer=run.recoveryStart(model,clock,{...status,toolhead:{print_time:10.1,estimated_print_time:10} });assert.equal(shortBuffer.overlap,5);
console.log('PASS recovery rewinds 150% of queued time with a minimum overlap and snaps backward to the active cut plunge');
