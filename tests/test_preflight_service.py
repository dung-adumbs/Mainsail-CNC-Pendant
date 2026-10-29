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
 def get_str(self,key,default=None):return self.kw.get(key,default)
class ServiceTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);root=Path(self.temp.name);p=root/'test.gcode';p.write_text('G90\nG1 X10 Y20 Z5\nPAUSE_BASE\nG1 Z-2\nG1 X30\n')
  self.c=c=service.CNCPreflight.__new__(service.CNCPreflight);c.root=root;c.model=scan.scan_file(p);c.job={'id':'stage','filename':p.name};c.generation=1;c.action_lock=asyncio.Lock();c.bounds_cache={};c.initial_machine=[0,0,10];c.server=types.SimpleNamespace(lookup_component=lambda name:types.SimpleNamespace(get_item=AsyncMock(return_value=[])),error=lambda message,*args:ValueError(message));c.profile_path=root/'profile.json';c.profile_path.write_text(json.dumps({'macro_sha256':{'gcode_macro TEST':hashlib.sha256(b'ok').hexdigest()}}))
  self.s={'webhooks':{'state':'ready'},'toolhead':{'homed_axes':'xyz','print_time':10,'estimated_print_time':100,'axis_minimum':[0]*3,'axis_maximum':[100]*3},'gcode_move':{'position':[0,0,10],'gcode_position':[0,0,10]},'print_stats':{'state':'standby','filename':'test.gcode'},'pause_resume':{'is_paused':False},'virtual_sdcard':{'is_active':False},'configfile':{'config':{'gcode_macro TEST':{'gcode':'ok'}}},'gcode_macro _CLIENT_VARIABLE':{'user_resume_macro':'CNC_RESUME_ORDERED'}}
  c._snapshot=AsyncMock(side_effect=lambda *args,**kw:copy.deepcopy(self.s));c.api=types.SimpleNamespace(run_gcode=AsyncMock())
 async def test_stage_speed_copy_reuses_exact_geometry(self):
  source=self.c.root/'test.gcode';source.write_bytes(b'; CNC_ROLLUP_VERSION: 1\nG90\nM220 S100\nG1 X10 Y20 Z5\nPAUSE_BASE\nM220 S100\nG1 Z-2\n')
  self.c.model=scan.scan_file(source);original=self.c.model
  target=self.c.root/'cnc_runs'/'run.gcode';target.parent.mkdir();payload=source.read_bytes().replace(b'M220 S100',b'M220 S20 ',1);at=payload.rfind(b'M220 S100');payload=payload[:at]+b'; reset  '+payload[at+9:];target.write_bytes(payload)
  result=await self.c._stage(Request(filename='cnc_runs/run.gcode',reuse_stage_id='stage'))
  self.assertEqual(result['state'],'analyzed');self.assertEqual(self.c.model.offsets,original.offsets);self.assertEqual(self.c.model.coords,original.coords);self.assertEqual(self.c.model.sha256,hashlib.sha256(payload).hexdigest())
  full=scan.scan_file(target);self.assertEqual(self.c.model.sections,full.sections);self.assertEqual(self.c.model.coords,full.coords)
  target.write_bytes(payload.replace(b'X10',b'X90'));self.assertIsNone(scan.reuse_speed_only_analysis(source,target,original))
  target.write_bytes(payload);source.write_bytes(source.read_bytes().replace(b'Y20',b'Y90'));self.assertIsNone(scan.reuse_speed_only_analysis(source,target,original))
 async def test_keepout_overlap_blocks_start(self):
  blocks=[dict(name='Clamp',enabled=True,xmin=0,xmax=100,ymin=0,ymax=100,safeZ=100,margin=0)]
  self.c.server.lookup_component=lambda name:types.SimpleNamespace(get_item=AsyncMock(return_value=blocks))
  result=await self.c._check(self.s);self.assertFalse(result['approved']);self.assertIn('Clamp',result['keepout_violations'][0]['message'])
  with self.assertRaises(ValueError):await self.c._start(Request(stage_id='stage'))
  self.c.api.run_gcode.assert_not_called()
 async def test_keepout_read_failure_blocks(self):
  self.c.server.lookup_component=lambda name:types.SimpleNamespace(get_item=AsyncMock(side_effect=ValueError('unavailable')))
  result=await self.c._check(self.s);self.assertFalse(result['approved']);self.assertIn('keep-out',result['reason'])
 def paused(self,zoffset=10):
  self.s['pause_resume']['is_paused']=True;self.s['print_stats']['state']='paused';self.s['gcode_move']={'position':[10,20,20],'gcode_position':[10,20,20-zoffset]};self.s['gcode_macro PAUSE_BASE']={'valid':True,'machine_x':10,'machine_y':20,'work_z':5,'origin_x':0,'origin_y':0,'file_position':self.c.model.sections[1]['start']}
 async def test_start_success_is_bound_and_single_script(self):
  self.assertTrue((await self.c._check(self.s))['approved']);await self.c._start(Request(stage_id='stage'));script=self.c.api.run_gcode.call_args_list[0].args[0];self.assertIn('SDCARD_PRINT_FILE FILENAME="test.gcode"',script);self.assertIn('VARIABLE=machine_z VALUE=10.',script);self.assertEqual(self.c.api.run_gcode.call_count,2)
 async def test_resume_selected_override_changes_captured_factor_before_resume(self):
  self.paused();await self.c._resume(Request(stage_id='stage',run_percent='20'));await self.c.operation_task
  script=self.c.api.run_gcode.call_args_list[0].args[0];self.assertIn('MACRO=PAUSE_BASE VARIABLE=factor VALUE=0.200000000',script);self.assertTrue(script.endswith('RESUME'))
 async def test_invalid_resume_override_sends_no_commands(self):
  self.paused()
  for value in ['nan','0','301','oops']:
   with self.assertRaises(ValueError):await self.c._resume(Request(stage_id='stage',run_percent=value))
  self.c.api.run_gcode.assert_not_called()
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
 async def test_optimizer_preview_create_and_stale_source(self):
  program='; CNC_PENDANT_OPTIMIZER: V1\n; CNC_TRAVEL_CLEARANCE_MM: 5\nG90\nG21\n; CNC_MOVE: UNKNOWN\nG1 X0 Y0 Z10 F100\n; CNC_MOVE: TRAVEL_XY\nG1 X10 Y0 F100\n'
  source=self.c.root/'marked.gcode';source.write_text(program);self.s['toolhead']['max_velocity']=100;self.s['configfile']['config']['printer']={'max_z_velocity':10}
  request=Request(mode='preview',filename='marked.gcode',xy_feed='3000',z_feed='180');accepted=await self.c._optimize(request);self.assertEqual(accepted['state'],'working');await self.c.optimization_task
  preview=dict(self.c.optimization);self.assertEqual(preview['state'],'preview');self.assertEqual(preview['changed_moves'],1);self.assertFalse((self.c.root/'cnc_optimized').exists())
  source.write_text(program+'; edit\n');await self.c._optimize(Request(mode='create',filename='marked.gcode',xy_feed='3000',z_feed='180',preview_id=preview['id']));await self.c.optimization_task;self.assertEqual(self.c.optimization['state'],'error');self.assertIn('changed',self.c.optimization['message'])
  await self.c._optimize(request);await self.c.optimization_task;preview=dict(self.c.optimization)
  await self.c._optimize(Request(mode='create',filename='marked.gcode',xy_feed='3000',z_feed='180',preview_id=preview['id']));await self.c.optimization_task
  self.assertEqual(self.c.optimization['state'],'created');self.assertEqual(source.read_text(),program+'; edit\n');output=self.c.root/self.c.optimization['filename'];self.assertIn('F3000',output.read_text());self.assertFalse(scan.scan_file(output).issues);self.c.api.run_gcode.assert_not_called()
 async def test_optimizer_blocks_active_jobs_and_stale_preview(self):
  self.paused()
  with self.assertRaises(ValueError):await self.c._optimize(Request(mode='preview',filename='test.gcode',xy_feed='3000',z_feed='180'))
  self.s['pause_resume']['is_paused']=False;self.s['print_stats']['state']='standby'
  with self.assertRaises(ValueError):await self.c._optimize(Request(mode='create',filename='test.gcode',xy_feed='3000',z_feed='180',preview_id='invalid'))
 async def test_optimizer_accounts_for_run_override(self):
  source=self.c.root/'marked.gcode';source.write_text('; CNC_PENDANT_OPTIMIZER: V1\n; CNC_TRAVEL_CLEARANCE_MM: 5\nG90\nG21\nM220 S300\n; CNC_MOVE: UNKNOWN\nG1 X0 Y0 Z10 F100\n; CNC_MOVE: TRAVEL_XY\nG1 X10 F100\n');self.s['toolhead']['max_velocity']=100;self.s['configfile']['config']['printer']={'max_z_velocity':10}
  await self.c._optimize(Request(mode='preview',filename='marked.gcode',xy_feed='3000',z_feed='180'));await self.c.optimization_task;self.assertEqual(self.c.optimization['state'],'error');self.assertIn('velocity',self.c.optimization['message']);self.c.api.run_gcode.assert_not_called()
class ArchiveTests(unittest.IsolatedAsyncioTestCase):
 async def asyncSetUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);base=Path(self.temp.name);self.root=base/'gcodes';self.root.mkdir();self.folder=base/'cnc_archives'/'old';self.folder.mkdir(parents=True);self.source=self.folder/'sample.gcode';self.data=b'G90\nG1 X1\n';self.source.write_bytes(self.data);self.hash=hashlib.sha256(self.data).hexdigest()
  self.manifest={'files':[{'relative_path':'nested/sample.gcode','archive_path':str(self.source),'size':len(self.data),'sha256':self.hash}]};(self.folder/'manifest.json').write_text(json.dumps(self.manifest))
  self.c=service.CNCPreflight.__new__(service.CNCPreflight);self.c.root=self.root;self.c.action_lock=asyncio.Lock();self.c.job={};self.c.server=types.SimpleNamespace(error=lambda msg,*args:ValueError(msg));self.c._snapshot=AsyncMock(return_value={'webhooks':{'state':'ready'},'print_stats':{'state':'standby'}})
  self.request=Request(archive_id='old',filename='nested/sample.gcode',sha256=self.hash)
 async def test_restores_verified_copy_and_keeps_archive(self):
  result=await self.c._archive_restore(self.request);self.assertTrue(result['archive_retained']);self.assertEqual((self.root/'nested/sample.gcode').read_bytes(),self.data);self.assertEqual(self.source.read_bytes(),self.data)
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
 async def test_modified_archive_never_copied(self):
  self.source.write_bytes(self.data.replace(b'X1',b'X2'))
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
  self.assertFalse((self.root/'nested/sample.gcode').exists())
 async def test_active_job_blocks_restore(self):
  self.c._snapshot.return_value={'webhooks':{'state':'ready'},'print_stats':{'state':'printing'}}
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
  self.assertFalse((self.root/'nested').exists())
 async def test_path_escape_and_manifest_escape_block(self):
  for archive,filename in [('../old','nested/sample.gcode'),('old','../sample.gcode'),('old','/tmp/sample.gcode')]:
   with self.assertRaises(ValueError):await self.c._archive_restore(Request(archive_id=archive,filename=filename,sha256=self.hash))
  self.manifest['files'][0]['archive_path']=str(self.root/'test.gcode');(self.folder/'manifest.json').write_text(json.dumps(self.manifest))
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
 async def test_staged_target_blocks_restore(self):
  self.c.job={'filename':'nested/sample.gcode'}
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
 async def test_symlink_target_blocks_restore(self):
  try:(self.root/'nested').symlink_to(self.folder,target_is_directory=True)
  except OSError:self.skipTest('Symlinks unavailable')
  with self.assertRaises(ValueError):await self.c._archive_restore(self.request)
if __name__=='__main__':unittest.main()
