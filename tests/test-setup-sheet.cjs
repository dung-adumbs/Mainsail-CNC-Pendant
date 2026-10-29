const assert=require('node:assert/strict');
const {metadata,groups,batchIssue}=require('../src/cnc-pendant-projects.js');
const {render,duration}=require('../src/cnc-setup-sheet.js');
const id='20261025-120000-123456__abcdef12';
function stage(n,count=4,batch=id){return metadata(['CNC_BATCH_V1: '+JSON.stringify({schema:1,id:batch,stage:n,count,document:'BONE',setup:'Pocket',created:'2026-10-25T12:00:00Z'}),'Tool 6: Flat','CNC_OPERATION: Cut','CNC_FUSION_OPERATION_V1: '+JSON.stringify({name:'Cut <script>alert(1)</script>',tool:{number:6,description:'Pending <tool>',geometry:{DC:3.175,LCF:15}},rpm:16000,feed_mm_min:800,seconds:61})],{path:'Inbox/'+n+'.gcode'});}
const files=[stage(4),stage(2),stage(1),stage(3)];
assert.deepEqual(groups(files)[0].files.map(f=>f.batch.stage),[1,2,3,4]);assert.equal(batchIssue(files),'');
assert.match(batchIssue(files.slice(0,3)),/3 of 4/);assert.match(batchIssue([...files,stage(1)]),/duplicate/);
assert.equal(groups([...files,stage(1,1,'20261025-120100-123456__abcdef13')]).length,2);
const html=render({name:'BONE <img onerror=x>',stages:files,reviewed_order:true});
assert.ok(!html.includes('<script>'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;script&gt;'));
assert.match(html,/4m 4s/);assert.match(html,/16000/);assert.match(html,/Fusion travel plane/);assert.match(html,/not job approval/);
assert.match(render({name:'old',stages:[{operations:['Old operation'],tools:['T1']}]}),/no supplied estimate/);
assert.equal(duration(59.8),'0h 1m 0s');
console.log('Passed batch ordering/isolation/completeness, printable metadata, missing estimates, escaping and rounding.');
