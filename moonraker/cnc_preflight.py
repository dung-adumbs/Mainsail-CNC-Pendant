"""Moonraker-owned CNC staging and preflight gate. GPL-3.0-or-later."""
from __future__ import annotations
import asyncio, datetime, hashlib, json, math, pathlib, uuid, logging
from ..common import RequestType
from .cnc_gcode_scan import scan_file, metadata_from_header, fingerprints, evaluate_bounds
from .cnc_travel_optimize import inspect_header, optimize_bytes, MAX_BYTES

class CNCPreflight:
    def __init__(self,config):
        self.server=config.get_server();self.api=self.server.lookup_component('klippy_apis');self.files=self.server.lookup_component('file_manager')
        self.root=pathlib.Path(self.files.get_directory('gcodes')).resolve()
        self.directory=pathlib.Path(config.get('cache_path','~/printer_data/cnc_preflight')).expanduser();self.directory.mkdir(parents=True,exist_ok=True)
        self.profile_path=pathlib.Path(config.get('profile_path','~/printer_data/config/cnc_preflight_profile.json')).expanduser()
        self.job={'state':'empty','message':'Select and stage a file.'};self.model=None;self.generation=0;self.scan_lock=asyncio.Lock();self.action_lock=asyncio.Lock();self.bounds_cache={};self.initial_machine=None;self.operation={'state':'idle'};self.operation_task=None
        self.optimization={'state':'idle'};self.optimization_task=None
        for name,method in [('inspect',RequestType.GET),('stage',RequestType.POST),('status',RequestType.GET),('verify',RequestType.POST),('start',RequestType.POST),('resume',RequestType.POST),('clear',RequestType.POST),('optimize',RequestType.POST),('optimization',RequestType.GET)]:
            self.server.register_endpoint('/machine/cnc_preflight/'+name,method,getattr(self,'_'+name))
    def _path(self,filename):
        if not filename or any(c in filename for c in '\r\n\x00\"\'\\{}') or len(filename)>512:raise self.server.error('Invalid filename',400)
        path=(self.root/filename).resolve()
        if not path.is_relative_to(self.root) or not path.is_file() or path.suffix.lower() not in ['.gcode','.gc','.gco','.nc','.ngc','.tap']:raise self.server.error('Choose a local G-code file',400)
        if any(word in filename.lower() for word in ['quarantine','old-machine-origin']):raise self.server.error('Archived files cannot be staged',400)
        return path
    async def _snapshot(self,config=False):
        objects={name:None for name in ['webhooks','toolhead','gcode_move','print_stats','pause_resume','virtual_sdcard','idle_timeout','gcode_macro PAUSE_BASE','gcode_macro _CNC_PREFLIGHT_STATE','gcode_macro _CLIENT_VARIABLE']}
        if config:objects['configfile']=['config']
        return await self.api.query_objects(objects)
    def _idle_reason(self,s,paused=False):
        if s.get('webhooks',{}).get('state')!='ready':return 'Controller is not Ready.'
        tool=s.get('toolhead',{});clock=tool.get('estimated_print_time');planned=tool.get('print_time')
        if tool.get('homed_axes')!='xyz':return 'Home all axes, then establish work/tool zeros.'
        if not isinstance(clock,(int,float)) or not isinstance(planned,(int,float)) or planned+.05>clock:return 'Wait for motion or pause lift to finish.'
        is_paused=s.get('pause_resume',{}).get('is_paused',False)
        if paused:
            if not is_paused:return 'There is no paused job.'
            if s.get('virtual_sdcard',{}).get('is_active'):return 'Wait for the file to finish pausing.'
        elif is_paused or s.get('print_stats',{}).get('state') in ['printing','paused'] or s.get('virtual_sdcard',{}).get('is_active'):return 'Stop the current job before starting a new file.'
        return ''
    def _profile_reason(self,s):
        try:profile=json.loads(self.profile_path.read_text())
        except (OSError,ValueError):return 'Controller macro profile is missing; verification cannot approve motion.'
        config={key.lower():value for key,value in s.get('configfile',{}).get('config',{}).items()}
        for name,expected in profile.get('macro_sha256',{}).items():
            body=config.get(name.lower(),{}).get('gcode','');actual=hashlib.sha256(body.encode()).hexdigest()
            if actual!=expected:return 'Controller macro changed: '+name+'. Review and update the verification profile.'
        if not profile.get('macro_sha256'):return 'Empty controller macro profile.'
        covered={name.lower() for name in profile['macro_sha256']}
        if self.model:
            for name in self.model.runtime_macros:
                if 'gcode_macro '+name.lower() not in covered:return 'Reviewed runtime macro is missing from the controller profile: '+name
        client=s.get('gcode_macro _CLIENT_VARIABLE',{})
        if client.get('user_resume_macro')!='CNC_RESUME_ORDERED':return 'Ordered resume hook is not configured.'
        if self.model and self.model.uses_arcs and 'gcode_arcs' not in config:return 'This file uses arcs, but Klipper gcode_arcs is not configured.'
        if self.model and self.model.loops and 'sdcard_loop' not in config:return 'This file uses loops, but sdcard_loop is not configured.'
        return ''
    async def _inspect(self,request):
        filename=request.get_str('filename');path=self._path(filename);stat=path.stat();box=await asyncio.to_thread(metadata_from_header,path);s=await self._snapshot()
        with path.open('rb') as source:header=source.read(16384).decode('utf-8',errors='replace')
        comments=[line.lstrip('; ').strip() for line in header.splitlines()[:70] if line.strip().startswith(';')]
        return {'filename':filename,'size':stat.st_size,'modified':datetime.datetime.fromtimestamp(stat.st_mtime,datetime.timezone.utc).isoformat(),'metadata':box,'preliminary':self._preliminary(s,box),'header_comments':comments,'optimizer':inspect_header(header)}
    def _optimization_idle(self,s):
        if s.get('webhooks',{}).get('state')!='ready' or s.get('pause_resume',{}).get('is_paused') or s.get('virtual_sdcard',{}).get('is_active') or s.get('print_stats',{}).get('state') in ['printing','paused'] or getattr(self,'operation',{}).get('state')=='returning':
            raise self.server.error('Travel preparation is available only with no running or paused job.',409)
    async def _optimization(self,request):return dict(getattr(self,'optimization',{'state':'idle'}))
    async def _optimize(self,request):
        async with self.action_lock:
            if getattr(self,'optimization',{}).get('state')=='working':raise self.server.error('Travel preparation is already working.',409)
            s=await self._snapshot(config=True);self._optimization_idle(s)
            mode=request.get_str('mode');filename=request.get_str('filename');path=self._path(filename)
            try:xy=float(request.get_str('xy_feed'));z=float(request.get_str('z_feed'))
            except (TypeError,ValueError):raise self.server.error('Enter travel rates in mm/min.',400)
            if not math.isfinite(xy) or not math.isfinite(z) or not 1<=xy<=30000 or not 1<=z<=3000:raise self.server.error('Invalid travel rates.',400)
            if mode not in ['preview','create']:raise self.server.error('Choose preview or create.',400)
            prior=getattr(self,'optimization',{})
            if mode=='create' and (prior.get('state')!='preview' or prior.get('id')!=request.get_str('preview_id') or prior.get('source')!=filename or prior.get('xy_feed')!=xy or prior.get('z_feed')!=z):raise self.server.error('Preview these exact settings first.',409)
            expected=prior.get('source_sha256') if mode=='create' else None
            identity=uuid.uuid4().hex
            self.optimization={'id':identity,'state':'working','source':filename,'mode':mode,'xy_feed':xy,'z_feed':z}
            self.optimization_task=asyncio.create_task(self._prepare_travel(path,s,identity,xy,z,expected))
            return dict(self.optimization)
    async def _prepare_travel(self,path,s,identity,xy,z,expected):
        try:
            def prepare():
                if path.stat().st_size>MAX_BYTES:raise ValueError('File exceeds the 64 MiB optimization limit.')
                with path.open('rb') as source:data=source.read(MAX_BYTES+1)
                if expected and hashlib.sha256(data).hexdigest()!=expected:raise ValueError('Source changed since preview. Preview it again.')
                # Account for both current and explicitly programmed run overrides.
                import re
                factors=[1.,s.get('gcode_move',{}).get('speed_factor',1.)]
                factors += [float(v)/100 for v in re.findall(rb'^\s*M220\s+S([\d.]+)\s*(?:;.*)?$',data,re.M|re.I)]
                factor=max(factors);tool=s.get('toolhead',{});printer=s.get('configfile',{}).get('config',{}).get('printer',{})
                maximum=float(tool.get('max_velocity',printer.get('max_velocity',0)));zmaximum=float(printer.get('max_z_velocity',maximum))
                if maximum<=0 or zmaximum<=0:raise ValueError('Machine velocity limits are unavailable.')
                if xy*factor>maximum*60+.001 or z*factor>zmaximum*60+.001:raise ValueError('Travel rate exceeds machine velocity limits after run-speed override. Lower the travel rates or override and preview again.')
                return optimize_bytes(data,xy,z)
            payload,report=await asyncio.to_thread(prepare)
            if expected:
                self._optimization_idle(await self._snapshot())
                folder=self.root/'cnc_optimized';folder.mkdir(exist_ok=True)
                if folder.is_symlink() or folder.resolve().parent!=self.root:raise ValueError('Unsafe output directory.')
                name=path.stem[:80]+'-travel-'+identity[:10]+'.gcode';target=folder/name
                # Never overwrite source or a previous optimized file.
                with target.open('xb') as output:output.write(payload)
                filename=target.relative_to(self.root).as_posix()
                self.optimization={**self.optimization,**report,'state':'created','filename':filename,'message':'Copy created. Stage & verify it before Start.'}
            else:self.optimization={**self.optimization,**report,'state':'preview','message':'Preview only; no file written.'}
        except Exception as error:self.optimization={**self.optimization,'state':'error','message':str(error)}
    async def _stage(self,request):
        async with self.action_lock:
            if getattr(self,'operation',{}).get('state')=='returning':raise self.server.error('Resume return is already in progress',409)
            filename=request.get_str('filename');path=self._path(filename);s=await self._snapshot()
            if s.get('virtual_sdcard',{}).get('is_active'):raise self.server.error('Pause or stop the running file before staging',409)
            if s.get('pause_resume',{}).get('is_paused') and s.get('print_stats',{}).get('filename')!=filename:raise self.server.error('While paused, stage only the active file',409)
            self.operation={'state':'idle'}
            self.generation+=1;generation=self.generation;self.model=None;self.bounds_cache={};self.initial_machine=s.get('gcode_move',{}).get('position',[0,0,0])[:3]
            self.job={'id':uuid.uuid4().hex,'filename':filename,'state':'scanning','progress':0,'lines':0,'message':'Scanning G-code in the background…','metadata':metadata_from_header(path)}
            asyncio.create_task(self._scan(path,generation));return dict(self.job)
    async def _scan(self,path,generation):
        async with self.scan_lock:
            if generation!=self.generation:return
            def progress(ratio,lines):
                if generation!=self.generation:raise ValueError('Replaced by a newer staged file')
                self.job['progress']=round(ratio,3);self.job['lines']=lines
            try:
                model=await asyncio.to_thread(scan_file,path,progress)
                if generation!=self.generation:return
                self.model=model;self.job.update(state='analyzed',progress=1,report=model.report(),message='Analysis complete; checking current setup.')
                report=model.report();report['analyzed_at']=datetime.datetime.now(datetime.timezone.utc).isoformat();record=self.directory/(model.sha256+'.json');temporary=record.with_suffix('.tmp');temporary.write_text(json.dumps(report,indent=2));temporary.replace(record)
            except Exception as error:
                if generation==self.generation:self.job.update(state='error',message=str(error))
    async def _status(self,request):
        result=dict(self.job)
        result['operation']=dict(getattr(self,'operation',{'state':'idle'}))
        try:
            s=await self._snapshot(config=self.model is not None);paused=s.get('pause_resume',{}).get('is_paused',False)
            result['paused']=paused;result['active_filename']=s.get('print_stats',{}).get('filename','');result['preliminary']=self._preliminary(s)
            if self.model:result['verification']=await self._check(s,paused)
        except Exception as error:result['verification']={'approved':False,'reason':str(error)}
        return result
    def _preliminary(self,s,box=None):
        if box is None:box=self.job.get('metadata',{})
        if not box.get('available'):return {'available':False,'message':'No boundary metadata — full scan required.'}
        gm=s.get('gcode_move',{});tool=s.get('toolhead',{})
        if tool.get('homed_axes')!='xyz':return {'available':True,'message':'Preliminary metadata found; home and set zeros before checking fit.'}
        offset=[a-b for a,b in zip(gm['position'][:3],gm['gcode_position'][:3])]
        fit=evaluate_bounds({**box,'section':0,'label':'Metadata'},offset,tool['axis_minimum'],tool['axis_maximum'])
        return {**fit,'available':True,'message':'PRELIMINARY: header bounds exceed current travel.' if not fit['fits'] else 'PRELIMINARY: header bounds fit; full scan still required.'}
    async def _check(self,s,paused=False,hash_check=False):
        model=self.model;generation=self.generation;job_id=self.job.get('id');filename=self.job.get('filename')
        if model is None:return {'approved':False,'reason':'Analysis is not complete.'}
        if model.issues:return {'approved':False,'reason':'Cannot fully verify: '+model.issues[0]['message'],'issues':model.issues}
        reason=self._idle_reason(s,paused) or self._profile_reason(s)
        if reason:return {'approved':False,'reason':reason}
        path=self._path(filename);stat=path.stat()
        if stat.st_size!=model.size or stat.st_mtime_ns!=model.modified_ns:return {'approved':False,'reason':'The file changed. Stage it again for a new scan.'}
        if hash_check:
            before=(stat.st_size,stat.st_mtime_ns,stat.st_ino);digest,_=await asyncio.to_thread(fingerprints,path);after=path.stat()
            if digest!=model.sha256 or before!=(after.st_size,after.st_mtime_ns,after.st_ino):return {'approved':False,'reason':'File content changed. Stage it again.'}
        gm=s['gcode_move'];tool=s['toolhead'];offset=[a-b for a,b in zip(gm['position'][:3],gm['gcode_position'][:3])];position=0;return_points=[]
        if paused:
            if s.get('print_stats',{}).get('filename')!=filename:return {'approved':False,'reason':'Stage the active paused file before verifying Resume.'}
            pause=s.get('gcode_macro PAUSE_BASE',{})
            if not pause.get('valid') or pause.get('file_position',-1)<0:return {'approved':False,'reason':'No captured pause/file position is available.'}
            if any(abs(offset[i]-float(pause.get('origin_'+axis,math.inf)))>1e-5 for i,axis in enumerate('xy')):return {'approved':False,'reason':'X/Y work origin changed while paused. Resume is blocked; re-establish the original XY origin.'}
            position=int(pause['file_position']);safe=max(gm['gcode_position'][2],float(pause['work_z'])+10.,10.)+offset[2]
            return_points=[gm['position'][:3],[gm['position'][0],gm['position'][1],safe],[pause['machine_x'],pause['machine_y'],safe],[pause['machine_x'],pause['machine_y'],pause['work_z']+offset[2]]]
        initial=[a-b for a,b in zip(self.initial_machine or gm['position'][:3],offset)]
        # Start uses the actual current position for any initially unspecified axes.
        if not paused:initial=gm['gcode_position'][:3]
        anchor=[pause['machine_x']-offset[0],pause['machine_y']-offset[1],pause['work_z']] if paused else None
        key=(model.sha256,job_id,position,tuple(initial),tuple(anchor) if anchor else None)
        if key not in self.bounds_cache:
            self.bounds_cache={key:await asyncio.to_thread(model.remaining_bounds,initial,position,True,anchor)}
        bounds=self.bounds_cache[key]
        if bounds is None and paused:
            # A completed file paused before M117/EOF still needs its return path checked.
            bounds={'min':gm['gcode_position'][:3],'max':gm['gcode_position'][:3],'section':len(model.sections)-1,'label':'End of file'}
        fit=evaluate_bounds(bounds,offset,tool['axis_minimum'],tool['axis_maximum'])
        return_violations=[]
        for point in return_points:
            for i,axis in enumerate('XYZ'):
                short=max(tool['axis_minimum'][i]-point[i],point[i]-tool['axis_maximum'][i],0.)
                if short>1e-5:return_violations.append({'axis':axis,'overflow_mm':short,'message':f'Resume return path exceeds {axis} travel by {short:.3f} mm'})
        approved=fit['fits'] and not return_violations
        if generation!=self.generation or model is not self.model:return {'approved':False,'reason':'The staged file changed during verification. Try again.'}
        return {**fit,'approved':approved,'reason':'Within machine travel limits for this tool section and return path.' if approved else 'Out of bounds — adjust the setup/tool zero and verify again.','return_violations':return_violations,'sha256':model.sha256,'file_position':position,'scope':'Next tool section; later sections require their actual tool zeros. This is a travel check, not fixture/cutter collision certification.'}
    async def _verify(self,request):
        if not self.model:return {'approved':False,'reason':'Stage the file and wait for analysis.'}
        s=await self._snapshot(True);return await self._check(s,s.get('pause_resume',{}).get('is_paused',False),True)
    async def _approve_and_run(self,request,resume):
        async with self.action_lock:
            if getattr(self,'operation',{}).get('state')=='returning':raise self.server.error('Resume return is already in progress. Do not send another Resume.',409)
            if request.get_str('stage_id')!=self.job.get('id'):raise self.server.error('The staged file changed. Review the new selection.',409)
            generation=self.generation;s=await self._snapshot(True);result=await self._check(s,resume,True)
            if not result.get('approved'):raise self.server.error(result.get('reason','Verification failed')+' '+ '; '.join(v['message'] for v in result.get('violations',[])+result.get('return_violations',[])),409)
            # Re-read after hashing/analysis to catch any concurrent origin/jog change.
            fresh=await self._snapshot(True)
            if generation!=self.generation or fresh['gcode_move']['position'][:3]!=s['gcode_move']['position'][:3] or fresh['gcode_move']['gcode_position'][:3]!=s['gcode_move']['gcode_position'][:3]:raise self.server.error('Position or zero changed during verification. Try again.',409)
            reason=self._idle_reason(fresh,resume)
            if reason:raise self.server.error(reason,409)
            gm=fresh['gcode_move'];offset=[a-b for a,b in zip(gm['position'][:3],gm['gcode_position'][:3])]
            commands=[]
            for i,axis in enumerate('xyz'):
                commands.append(f'SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=offset_{axis} VALUE={offset[i]:.9f}')
                commands.append(f'SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=machine_{axis} VALUE={gm["position"][i]:.9f}')
            commands.append(f'SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=expires VALUE={fresh["toolhead"]["estimated_print_time"]+5:.6f}')
            if resume:
                commands.extend(['SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=resume_approved VALUE=1','RESUME'])
            else:
                name=self.job['filename'];commands.extend([f'SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=filename VALUE=\'"{name}"\'','SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=start_approved VALUE=1',f'SDCARD_PRINT_FILE FILENAME="{name}"']);self.initial_machine=gm['position'][:3]
            if resume:
                # The return can take minutes. Acknowledge promptly and let the
                # shared status endpoint report its actual completion.
                self.operation={'state':'returning','action':'resume','id':uuid.uuid4().hex,'filename':self.job['filename'],'message':'Returning to saved position…'}
                self.operation_task=asyncio.create_task(self._execute_resume('\n'.join(commands)))
                return {'ok':True,'accepted':True,'operation':dict(self.operation)}
            await self._execute_commands('\n'.join(commands))
            return {'ok':True,'action':'resume' if resume else 'start','verification':result}
    async def _execute_commands(self,script):
        try:await self.api.run_gcode(script)
        finally:
            try:await self.api.run_gcode('SET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=start_approved VALUE=0\nSET_GCODE_VARIABLE MACRO=_CNC_PREFLIGHT_STATE VARIABLE=resume_approved VALUE=0')
            except Exception:logging.exception('CNC preflight approval cleanup unavailable; guards remain single-use and expire')
    async def _execute_resume(self,script):
        try:
            await self._execute_commands(script)
            self.operation.update(state='complete',message='Resume return complete.')
        except Exception as error:
            try:
                actual=await self._snapshot()
                if not actual.get('pause_resume',{}).get('is_paused') and actual.get('print_stats',{}).get('state')=='printing':
                    self.operation.update(state='complete',message='Controller confirms the job is running.');return
            except Exception:pass
            self.operation.update(state='failed',message=str(error))
    async def _start(self,request):return await self._approve_and_run(request,False)
    async def _resume(self,request):return await self._approve_and_run(request,True)
    async def _clear(self,request):
        async with self.action_lock:
            if getattr(self,'operation',{}).get('state')=='returning':raise self.server.error('Resume return is in progress',409)
            s=await self._snapshot()
            if s.get('virtual_sdcard',{}).get('is_active') or s.get('print_stats',{}).get('state') in ['printing','paused'] or s.get('pause_resume',{}).get('is_paused'):raise self.server.error('Cannot clear an active or paused job',409)
            self.generation+=1;self.model=None;self.bounds_cache={};self.job={'state':'empty','message':'Select and stage a file.'};self.operation={'state':'idle'};return self.job

def load_component(config):return CNCPreflight(config)
