import asyncio,copy,importlib.util,pathlib,sys,types,unittest,time
from unittest.mock import AsyncMock
ROOT=pathlib.Path(__file__).parents[1]/'moonraker'
for name in ['healthfixture','healthfixture.components']:
    module=types.ModuleType(name);module.__path__=[str(ROOT)];sys.modules[name]=module
common=types.ModuleType('healthfixture.common');common.RequestType=types.SimpleNamespace(GET=1,POST=2);sys.modules[common.__name__]=common
spec=importlib.util.spec_from_file_location('healthfixture.components.cnc_health',ROOT/'cnc_health.py')
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)


def normal():
    return {'webhooks':{'state':'ready'},'tmc2209 stepper_x':{'drv_status':{}},'gcode_macro CNC_HEALTH_LIGHT':{'active':0},
            'mcu':{'last_stats':{'mcu_awake':.05}},'toolhead':{'print_time':101,'estimated_print_time':100}}


class Decisions(unittest.TestCase):
    def test_current_not_historical_throttle(self):
        for bits in [0,1<<16,1<<18,1<<19]:
            self.assertEqual(h.evaluate(normal(),{'temperature':50,'bits':bits})['warnings'],[])
        for bits in [1,4,8]:self.assertTrue(h.evaluate(normal(),{'temperature':50,'bits':bits})['warnings'])

    def test_cpu_only_info_driver_null_unknown(self):
        s=normal();r=h.evaluate(s,{'temperature':50,'bits':0,'cpu':100});self.assertEqual(r['warnings'],[])
        self.assertIn('1.0%',next(x['value'] for x in r['rows'] if x['label'].startswith('MCU')))
        s['tmc2209 stepper_x']['drv_status']=None;self.assertTrue(h.evaluate(s,{'temperature':50,'bits':0})['unknown'])

    def test_heat_and_hysteresis(self):
        s=normal();s['tmc2209 stepper_x']['drv_status']={'otpw':1}
        self.assertTrue(h.evaluate(s,{'temperature':50,'bits':0})['warnings'])
        s=normal();self.assertTrue(h.evaluate(s,{'temperature':75,'bits':0})['hot'])
        self.assertTrue(h.evaluate(s,{'temperature':74,'bits':0},hot=True)['hot'])
        self.assertFalse(h.evaluate(s,{'temperature':72.9,'bits':0},hot=True)['hot'])

    def test_ten_seconds_clear_and_stale(self):
        state=h.HealthState();warning={'ready':True,'warnings':['hot'],'hot':True}
        for t in range(10):self.assertFalse(state.update(warning,t,True)[1])
        self.assertTrue(state.update(warning,10,True)[1]);self.assertTrue(state.ack_required)
        self.assertFalse(state.update(warning,11,True)[1])
        state=h.HealthState();state.update(warning,0,True);state.update(warning,1,True)
        self.assertEqual(state.update(warning,8,True)[0],10)
        self.assertFalse(state.update({'ready':True,'warnings':[]},9,True)[1]);self.assertIsNone(state.since)

    def test_battery_timer_reminder_pause_and_acknowledge(self):
        state=h.BatteryState();state.arm('large',True,'job.nc',1,0)
        state.update(0,True,'job.nc',1,1)
        state.update(60,True,'job.nc',1,1)
        # Runtime deltas are deliberately capped so a stalled sampler cannot
        # invent battery use. Exercise normal one-second samples instead.
        state=h.BatteryState();state.arm('large',True,'job.nc',.1,0)
        for now in range(8):result=state.update(now,True,'job.nc',.1,.05)
        self.assertTrue(state.ack_required);self.assertFalse(result['pause'])
        result=state.update(11,True,'job.nc',.1,.05)
        self.assertTrue(result['pause']);self.assertFalse(state.update(12,True,'job.nc',.1,.05)['pause'])
        elapsed=state.battery_seconds;state.acknowledge(2,12)
        self.assertFalse(state.ack_required);self.assertEqual(state.battery_seconds,elapsed)

    def test_battery_change_preserves_job_time_and_resets_pack(self):
        state=h.BatteryState();state.arm('small',False,'job.nc',15,0)
        for now in range(5):state.update(now,True,'job.nc',15,3)
        job=state.job_seconds;self.assertGreater(job,0)
        state.arm('large',True,'job.nc',15,5,changed=True)
        self.assertEqual(state.battery_seconds,0);self.assertEqual(state.job_seconds,job)
        view=state.view(5,True,[{'id':'large','name':'Large battery'}])
        self.assertEqual(view['filename'],'job.nc');self.assertFalse(view['pause_attempted'])


class Service(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.c=c=h.CNCHealth.__new__(h.CNCHealth);c.enabled=True;c.lock=asyncio.Lock();c.updated=0
        c.state=h.HealthState();c.names={k:None for k in normal()};c.loaded=True;c.pi_at=time.monotonic();c.pi_cache={'temperature':80,'bits':0,'cpu':5};c.pause_error=None;c.lamp=False
        c.battery=h.BatteryState();c.battery_loaded=True;c.battery_saved=0
        c.battery_settings={'enabled':False,'reminder':15.,'grace':3.,'profiles':[{'id':'small','name':'Small battery'}]}
        self.s=normal();self.s.update(print_stats={'state':'printing'},pause_resume={'is_paused':False})
        c.api=types.SimpleNamespace(query_objects=AsyncMock(side_effect=lambda *a:copy.deepcopy(self.s)),pause_print=AsyncMock(),run_gcode=AsyncMock())
        async def get_item(namespace,key,default=None):
            if key=='pi_temp_limit':return 75
            return default
        c.db=types.SimpleNamespace(get_item=AsyncMock(side_effect=get_item),insert_item=AsyncMock())
        c.server=types.SimpleNamespace(error=lambda message,*a:ValueError(message))

    async def test_pause_and_lamp_no_resume(self):
        c=self.c;await c.refresh(force=True);c.api.pause_print.assert_not_called()
        c.api.run_gcode.assert_awaited_with('CNC_HEALTH_LIGHT ACTIVE=1')
        c.state.since=time.monotonic()-11;await c.refresh(force=True)
        c.api.pause_print.assert_awaited_once();self.assertTrue(c.state.ack_required)
        await c.refresh(force=True);c.api.pause_print.assert_awaited_once()
        self.assertTrue(await c.blocked())
        with self.assertRaises(ValueError):await c.acknowledge(None)
        c.pi_cache['temperature']=50;await c.refresh(force=True);self.assertIn('acknowledgment',await c.blocked())
        await c.acknowledge(None);self.assertIsNone(await c.blocked())
        self.assertFalse(any('RESUME' in str(call) for call in c.api.run_gcode.await_args_list))

    async def test_idle_warning_never_pauses(self):
        self.s['print_stats']['state']='standby';await self.c.refresh(force=True)
        self.c.state.since=time.monotonic()-11;await self.c.refresh(force=True)
        self.c.api.pause_print.assert_not_called()


if __name__=='__main__':unittest.main()
