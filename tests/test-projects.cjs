const assert=require('node:assert/strict'),crypto=require('node:crypto');
const {metadata,groups,sha256}=require('../src/cnc-pendant-projects.js');
for(const size of [0,1,3,55,56,63,64,65,128,9999,1048576]){const bytes=crypto.randomBytes(size);assert.equal(sha256(bytes),crypto.createHash('sha256').update(bytes).digest('hex'));}
const file={path:'Inbox/a.gcode',size:100,modified:1};
const headers=['Job: P38_relief_v5__Setup_A__T1__20261023-181511-761844__abc','CNC_FUSION_SETUP: Setup A','CNC_OPERATION: Bore','Tool 1: Flat; diameter 3.175 mm','CNC_OPERATION: Cutout','Tool 1: Flat; diameter 3.175 mm'];
const a=metadata(headers,file);assert.equal(a.document,'P38 relief v5');assert.equal(a.date,'2026-10-23');assert.deepEqual(a.operations,['Bore','Cutout']);assert.equal(a.tools.length,1);
const b=metadata(headers.map(x=>x.replace('T1__','T2__')),{...file,path:'Inbox/b.gcode'});
assert.equal(groups([b,a]).length,1);assert.equal(groups([b,a])[0].files.length,2);
const otherDay={...a,date:'2026-10-24'};assert.equal(groups([a,otherDay]).length,2);
const unknown=metadata([],{path:'Inbox/unknown.gcode'});assert.equal(groups([a,unknown]).length,2);
const mixed=metadata([...headers,'Tool 2: Ball; diameter 3.175 mm'],file);assert.equal(mixed.tools.length,2);
console.log('Passed metadata grouping, unknown isolation, date separation, mixed-tool detection, and SHA-256 against Node crypto.');
