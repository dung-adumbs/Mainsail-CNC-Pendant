import asyncio,copy,hashlib,importlib.util,json,sys,tempfile,types,unittest
from pathlib import Path
from unittest.mock import AsyncMock
ROOT=Path(__file__).resolve().parents[1]/'moonraker'
for name in ['mockmoon','mockmoon.components']:
 module=types.ModuleType(name);module.__path__=[str(ROOT)];sys.modules[name]=module
common=types.ModuleType('mockmoon.common');common.RequestType=types.SimpleNamespace(GET=1,POST=2);sys.modules[common.__name__]=common
def load(name):
 spec=importlib.util.spec_from_file_location('mockmoon.components.'+name,ROOT/(name+'.py'));m=importlib.util.module_from_spec(spec);sys.modules[spec.name]=m;spec.loader.exec_module(m);return m
scan=load('cnc_gcode_scan');service=load('cnc_preflight')
class Request:
 def __init__(self,**kw):self.kw=kw
 def get_str(self,key):return self.kw[key]
class ServiceTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name);p=root/'test.gcode';p.write_text('G90\nG1 X10 Y20 Z5\nPAUSE_BASE\nG1 Z-2\nG1 X30\n')
  self.c=c=service.CNCPreflight.__new__(service.CNCPreflight);c.root=root;c.model=scan.scan_file(p);c.job={'id':'stage','filename':p.name};c.generation=1;c.action_lock=asyncio.Lock();c.bounds_cache={};c.initial_machine=[0,0,10];c.server=types.SimpleNamespace(error=lambda message,*args:ValueError(message));c.profile_path=root/'profile.json';c.profile_path.write_text(json.dumps({'macro_sha256':{'gcode_macro TEST':hashlib.sha256(b'ok').hexdigest()}}))
  self.s={'webhooks':{'state':'ready'},'toolhead':{'homed_axes':'xyz','print_time':10,'estimated_print_time':100,'axis_minimum':[0]*3,'axis_maximum':[100]*3},'gcode_move':{'position':[0,0,10],'gcode_position':[0,0,10]},'print_stats':{'state':'standby','filename':'test.gcode'},'pause_resume':{'is_paused':False},'virtual_sdcard':{'is_active':False},'configfile':{'config':{'gcode_macro TEST':{'gcode':'ok'}}},'gcode_macro _CLIENT_VARIABLE':{'user_resume_macro':'CNC_RESUME_ORDERED'}}
  c._snapshot=AsyncMock(side_effect=lambda *args,**kw:copy.deepcopy(self.s));c.api=types.SimpleNamespace(run_gcode=AsyncMock())
 def paused(self,zoffset=10):
  self.s['pause_resume']['is_paused']=True;self.s['print_stats']['state']='paused';self.s['gcode_move']={'position':[10,20,20],'gcode_position':[10,20,20-zoffset]};self.s['gcode_macro PAUSE_BASE']={'valid':True,'machine_x':10,'machine_y':20,'work_z':5,'origin_x':0,'origin_y':0,'file_position':self.c.model.sections[1]['start']}
 async def test_start_success_is_bound_and_single_script(self):
  self.assertTrue((await self.c._check(self.s))['approved']);await self.c._start(Request(stage_id='stage'));script=self.c.api.run_gcode.call_args_list[0].args[0];self.assertIn('SDCARD_PRINT_FILE FILENAME="test.gcode"',script);self.assertIn('VARIABLE=machine_z VALUE=10.',script);self.assertEqual(self.c.api.run_gcode.call_count,2)
 async def test_stale_selection_never_runs(self):
  with self.assertRaises(ValueError):await self.c._start(Request(stage_id='wrong'))
  self.c.api.run_gcode.assert_not_called()
 async def test_changed_hash_same_stat_blocks(self):
  import os
  p=self.c.root/'test.gcode';st=p.stat();p.write_text(p.read_text().replace('X30','X90'));os.utime(p,ns=(st.st_atime_ns,st.st_mtime_ns));self.assertFalse((await self.c._check(self.s,hash_check=True))['approved'])
 async def test_changed_macro_blocks(self):
  self.s['configfile']['config']['gcode_macro TEST']['gcode']='changed';self.assertFalse((await self.c._check(self.s))['approved'])
 async def test_new_z_zero_requires_fit(self):
  self.paused(10);self.assertTrue((await self.c._check(self.s,True))['approved']);self.paused(0);self.assertFalse((await self.c._check(self.s,True))['approved'])
 async def test_paused_xy_rezero_blocked(self):
  self.paused();self.s['gcode_move']['gcode_position'][0]=0;self.assertIn('X/Y work origin changed',(await self.c._check(self.s,True))['reason'])
 async def test_resume_lift_overflow_blocks(self):
  self.paused(95);self.assertTrue((await self.c._check(self.s,True))['return_violations'])
 async def test_concurrent_motion_after_hash_blocks(self):
  fresh=copy.deepcopy(self.s);fresh['gcode_move']['position'][0]=1;self.c._snapshot=AsyncMock(side_effect=[self.s,fresh])
  with self.assertRaises(ValueError):await self.c._start(Request(stage_id='stage'))
  self.c.api.run_gcode.assert_not_called()
 async def test_paths_reject_escape_and_injection(self):
  for name in ['../test.gcode','x".gcode','x\n.gcode','/etc/passwd','{filename}.gcode']:
   with self.subTest(name=name),self.assertRaises(ValueError):self.c._path(name)
 async def test_stage_replaced_during_bounds_cannot_approve(self):
  original=self.c.model.remaining_bounds
  def replace(*args):
   self.c.generation+=1;self.c.job={'id':'new-stage','filename':'other.gcode'};return original(*args)
  self.c.model.remaining_bounds=replace
  self.assertFalse((await self.c._check(self.s))['approved'])
  self.assertTrue(all(key[1]=='stage' for key in self.c.bounds_cache))
 async def test_motion_unhomed_or_running_blocks(self):
  for value in ['','xy']:
   self.s['toolhead']['homed_axes']=value;self.assertFalse((await self.c._check(self.s))['approved'])
  self.s['toolhead']['homed_axes']='xyz';self.s['virtual_sdcard']['is_active']=True;self.assertFalse((await self.c._check(self.s))['approved'])
 async def test_long_resume_acknowledges_and_rejects_duplicate(self):
  self.paused();release=asyncio.Event();started=asyncio.Event()
  async def commands(script):
   if script.endswith('RESUME'):started.set();await release.wait()
  self.c.api.run_gcode=AsyncMock(side_effect=commands)
  result=await asyncio.wait_for(self.c._resume(Request(stage_id='stage')),1)
  self.assertTrue(result['accepted']);await started.wait();self.assertEqual(self.c.operation['state'],'returning')
  with self.assertRaises(ValueError):await self.c._resume(Request(stage_id='stage'))
  with self.assertRaises(ValueError):await self.c._clear(Request())
  release.set();await self.c.operation_task;self.assertEqual(self.c.operation['state'],'complete');self.assertEqual(self.c.api.run_gcode.call_count,2)
 async def test_resume_reports_real_error_and_clears_approval(self):
  self.paused();self.c.api.run_gcode=AsyncMock(side_effect=[ValueError('Controller stopped'),None]);await self.c._resume(Request(stage_id='stage'));await self.c.operation_task;self.assertEqual(self.c.operation['state'],'failed');self.assertEqual(self.c.operation['message'],'Controller stopped');self.assertEqual(self.c.api.run_gcode.call_count,2)
 async def test_unload_clears_selection_and_invalidates_old_start(self):
  path=self.c.root/'test.gcode';original=path.read_bytes();result=await self.c._clear(Request());self.assertEqual(result['state'],'empty');self.assertEqual(path.read_bytes(),original)
  with self.assertRaises(ValueError):await self.c._start(Request(stage_id='stage'))
  self.c.api.run_gcode.assert_not_called()
 async def test_unload_rejects_paused_and_active_jobs(self):
  self.paused()
  with self.assertRaises(ValueError):await self.c._clear(Request())
  self.s['pause_resume']['is_paused']=False;self.s['print_stats']['state']='standby';self.s['virtual_sdcard']['is_active']=True
  with self.assertRaises(ValueError):await self.c._clear(Request())
if __name__=='__main__':unittest.main()
