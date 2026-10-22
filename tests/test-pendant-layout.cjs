const fs=require('fs'),vm=require('vm'),assert=require('assert');
const source=fs.readFileSync('src/cnc-pendant-core.js','utf8');
const body=source.slice(source.indexOf('  function layoutPendantZ('),source.indexOf('  function layoutForcedZ('));
for(const [mode,forced,rows] of [['coarse',false,3],['fine',false,3],['coarse',true,3]]){
 const buttons=[-.1,-1,-10,-25,.1,1,10,25].map(step=>({dataset:{lowriderJogStep:step},style:{}}));
 const label={style:{}},pad={dataset:{}},bar={style:{},querySelector:()=>label,querySelectorAll:()=>buttons};
 vm.runInNewContext(body+';layoutPendantZ(bar)',{jogScale:mode,forcedAxis:()=>forced,document:{getElementById:()=>pad},bar});
 assert.equal(bar.style.gridRow,`6 / span ${rows}`);assert.equal(label.style.gridColumn,'2');
 for(const b of buttons)assert.equal(b.style.gridColumn,b.dataset.lowriderJogStep<0?'1':'3');
 if(!forced){assert.equal(buttons.find(b=>b.dataset.lowriderJogStep===10).style.gridRow,'1');assert.equal(buttons.find(b=>b.dataset.lowriderJogStep===.1).style.gridRow,'3');assert.equal(buttons.find(b=>b.dataset.lowriderJogStep===-10).style.gridRow,'3');}
 else assert.equal(buttons.find(b=>b.dataset.lowriderJogStep===25).style.gridRow,'3');
}
assert(source.includes('button[data-lowrider-disable-steppers]'));
console.log('PASS: Z quadrant mapping for coarse, fine and forced mode.');

