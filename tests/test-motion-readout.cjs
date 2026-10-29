const assert=require('assert/strict'),m=require('../src/cnc-run.js');
const s={webhooks:{state:'ready'},gcode_move:{speed:1200,speed_factor:1.5},motion_report:{live_velocity:28.5}};
assert.deepEqual(m.speedValues(s),{programmed:'20.0 mm/s',override:'150%',adjusted:'30.0 mm/s',live:'28.5 mm/s'});
s.webhooks.state='shutdown';assert(Object.values(m.speedValues(s)).every(v=>v==='—'));console.log('PASS distinct programmed, override-adjusted and planned live speeds; unavailable clears readings');
