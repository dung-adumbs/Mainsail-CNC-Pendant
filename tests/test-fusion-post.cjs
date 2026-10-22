const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('post/Mainsail-CNC-Pendant.cps','utf8');
function context(){
 const output=[],rates={startSpeedFactor:100,travelFeed:3000,zTravelFeed:180,fastClearanceZ:5,maxSegment:10};
 const c={CAPABILITY_MILLING:1,MM:1,setCodePage(){},spatial:x=>x,createFormat:o=>({format:x=>Number(x).toFixed(o.decimals),areDifferent:(a,b)=>Math.abs(a-b)>.0005}),getProperty:k=>rates[k],writeWords:w=>output.push(w.join(' ')),writeln:s=>output.push(s),error:m=>{throw Error(m)},MOVEMENT_RAPID:0,movement:1};
 vm.createContext(c);vm.runInContext(source,c);return {c,output};
}
{
 const {c,output}=context();c.emittedPosition={X:0,Y:0,Z:10};c.onLinear(20,0,10,250);
 assert(output.filter(x=>x.startsWith('; CNC_MOVE:')).every(x=>x==='; CNC_MOVE: CUT'));
 assert(output.filter(x=>x.startsWith('G1')).every(x=>x.endsWith('F250.0')),'High cutting move must keep its feed');
}
{
 const {c,output}=context();c.emittedPosition={X:0,Y:0,Z:10};c.movement=0;c.onLinear(20,0,10,250);
 assert(output.includes('; CNC_MOVE: TRAVEL_XY'));assert(output.filter(x=>x.startsWith('G1')).every(x=>x.endsWith('F3000.0')));
}
{
 const {c,output}=context();c.emittedPosition={X:0,Y:0,Z:0};c.onRapid(10,20,10);
 const moves=output.filter(x=>x.startsWith('G1'));assert(moves[0].startsWith('G1 Z'));assert(moves.findIndex(x=>x.includes('X'))>0);
}
{
 const {c,output}=context();c.emittedPosition={X:0,Y:0,Z:10};c.onRapid(10,0,0);
 assert(output.indexOf('; CNC_MOVE: TRAVEL_XY')<output.indexOf('; CNC_MOVE: POSITION_Z'));
 for(let i=0;i<output.length;i++)if(output[i].startsWith('G1'))assert(output[i-1].startsWith('; CNC_MOVE:'));
}
assert(source.includes('CNC_PENDANT_OPTIMIZER: V1'));assert(source.includes('CNC_POST_VERSION:'));assert(source.includes('CNC_TRAVEL_CLEARANCE_MM:'));
{
 const {c,output}=context();c.emittedPosition={X:0,Y:0,Z:2};c.onRapid(5,0,2);
 assert(!output.includes('; CNC_MOVE: TRAVEL_XY'));assert(output.filter(x=>x.startsWith('G1')).every(x=>x.endsWith('F180.0')));
}
{
 const {c,output}=context(),range=(lo,hi)=>({getMinimum:()=>lo,getMaximum:()=>hi}),tool={number:1,description:'Test tool',diameter:3.175,clockwise:true};
 const section={type:1,isMultiAxis:()=>false,workPlane:{forward:{x:0,y:0,z:1}},workOffset:1,getTool:()=>tool,getForceToolChange:()=>false,getGlobalRange:()=>range(0,30),getGlobalZRange:()=>range(-1,10),getInitialPosition:()=>({x:0,y:0,z:5})};
 Object.assign(c,{unit:1,TYPE_MILLING:1,Vector:function(x,y,z){Object.assign(this,{x,y,z})},isSameDirection:()=>true,getNumberOfSections:()=>1,getSection:()=>section,currentSection:section,setRotation(){},getFramePosition:p=>p,getParameter:()=> 'Test operation',spindleSpeed:12000,tool,programName:'MARKER_TEST'});
 c.onOpen();c.onSection();c.onLinear(0,0,-1,100);c.onLinear(20,0,-1,250);c.onRapid(20,0,10);c.onRapid(30,20,10);c.onSectionEnd();c.onClose();
 assert(output.includes('; CNC_PENDANT_OPTIMIZER: V1'));assert(output.includes('PAUSE_BASE'));
 for(let i=0;i<output.length;i++)if(output[i].startsWith('G1')){assert(output[i-1].startsWith('; CNC_MOVE:'));assert(/ F[\d.]+$/.test(output[i]));}
 if(process.env.CNC_FIXTURE_OUTPUT)fs.writeFileSync(process.env.CNC_FIXTURE_OUTPUT,output.join('\n')+'\n');
}
console.log('PASS: CAM intent, explicit feeds, segmented markers, retract/XY/lower ordering.');

{const {c,output}=context();c.pauseHere('Fasteners',true);assert.equal(output[output.indexOf('PAUSE_BASE')-1],'; CNC_PAUSE: SAME_TOOL_RETURN');}

{
 const {c,output}=context();c.MOVEMENT_LINK_DIRECT=9;c.movement=9;c.emittedPosition={X:0,Y:0,Z:6};c.onLinear(20,0,6,1000);
 assert(output.includes('; CNC_MOVE: TRAVEL_XY'));assert(output.filter(x=>x.startsWith('G1')).every(x=>x.endsWith('F3000.0')));
}
{
 const {c,output}=context();c.MOVEMENT_LINK_DIRECT=9;c.movement=9;c.emittedPosition={X:0,Y:0,Z:2};c.onLinear(20,0,2,1000);
 assert(!output.includes('; CNC_MOVE: TRAVEL_XY'));assert(output.filter(x=>x.startsWith('G1')).every(x=>x.endsWith('F1000.0')));
}
