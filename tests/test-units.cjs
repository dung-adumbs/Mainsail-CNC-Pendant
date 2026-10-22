const fs=require('fs'),vm=require('vm'),assert=require('assert');const s=fs.readFileSync('src/cnc-pendant-core.js','utf8');
let unit='in';const c={document:{documentElement:{dataset:{get coordinateUnit(){return unit}}}}};vm.createContext(c);
vm.runInContext(s.slice(s.indexOf('  function coordinateFactor('),s.indexOf('  document.addEventListener(\'cnc-coordinate-units\'')),c);
vm.runInContext(s.slice(s.indexOf('  function jogSpec('),s.indexOf('  function syncJogReference(')),c);
for(const axis of ['X','Y','Z'])for(const [step,inches] of (axis==='Z'?[[.1,.001],[1,.01],[10,.1]]:[[1,.001],[10,.01],[100,.1]])){assert(Math.abs(c.jogSpec(axis,step,'fine').distance-inches*25.4)<1e-10);}
assert.equal(c.jogSpec('X',1,'coarse').distance,2.54);assert.equal(c.jogSpec('Z',1,'coarse').distance,25.4);assert(c.jogSpec('Z',25,'fine').hidden);assert.equal(c.jogSpec('X',100,'coarse').limit,'max');
assert.equal(c.coordinateText(25.4,0),'1.0000');assert.equal(c.machineToWork(25.4,{position:[50],gcode_position:[10]},0),-14.600000000000001);
unit='mm';assert.equal(c.jogSpec('X',1,'fine').distance,.1);assert.equal(c.jogSpec('Z',1,'coarse').distance,25);assert.equal(c.coordinateText(25.4,0),'25.40');
console.log('PASS: practical inch jogs, metric jogs, coordinate precision and offset conversion.');
