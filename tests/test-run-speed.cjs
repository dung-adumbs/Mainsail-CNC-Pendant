const fs=require('fs'),vm=require('vm'),assert=require('assert');
const s=fs.readFileSync('src/cnc-pendant-core.js','utf8');const code=s.slice(s.indexOf('        function requestRunSpeed('),s.indexOf("        value.addEventListener('keydown'",s.indexOf('        function requestRunSpeed(')));
let sent=[],actions={},opened=false;const c={value:{value:'300'},controlStatus:{gcode_move:{speed_factor:1}},Number,homingNotice:()=>{},document:{createElement:()=>({})},applyRunSpeed:async n=>sent.push(n),cncDialog:()=>({dialog:{append(){},close(){}},add(label,fn){actions[label]=fn},open(){opened=true}})};
vm.createContext(c);vm.runInContext(code+';this.request=requestRunSpeed;',c);
c.request(300);assert(opened);assert.deepEqual(sent,[]);assert.equal(c.value.value,'100');actions.Cancel();assert.deepEqual(sent,[]);c.request(50);assert.deepEqual(sent,[50]);c.request(301);assert.deepEqual(sent,[50]);
(async()=>{await actions['Set 300%']();assert.deepEqual(sent,[50,300]);console.log('PASS: max Run speed sends nothing until confirmed; cancel and invalid inputs do not apply.');})();
