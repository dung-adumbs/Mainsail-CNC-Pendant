"""CNC hardware warning monitor. GPL-3.0-or-later.

No motion except explicitly configured PAUSE via the existing pause workflow.
Never resumes, homes, changes offsets, or disables motors.
"""
import asyncio
import logging
import math
import time
from ..common import RequestType


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def evaluate(status, pi, limit=75, hot=False):
    warnings=[];rows=[];unknown=[]
    ready=status.get('webhooks',{}).get('state')=='ready'
    if not ready:unknown.append('Controller is not ready')
    temp=pi.get('temperature')
    hot=finite(temp) and temp >= (limit-2 if hot else limit)
    if hot:warnings.append('Pi temperature above warning threshold')
    if not finite(temp):unknown.append('Pi temperature unavailable')
    rows.append({'label':'Pi temperature','value':f'{temp:.1f} °C / warning {limit} °C' if finite(temp) else 'Unavailable','warning':hot})
    bits=pi.get('bits')
    valid_bits=isinstance(bits,int) and bits>=0
    if not valid_bits:unknown.append('Pi voltage/throttle flags unavailable')
    active=[]
    if valid_bits:
        for bit,label in [(0,'undervoltage'),(2,'throttled'),(3,'soft temperature limit')]:
            if bits & (1<<bit):active.append(label)
        if active:warnings.append('Pi '+', '.join(active))
    rows.append({'label':'Pi power / throttle','value':', '.join(active) if active else 'No active flags' if valid_bits else 'Unavailable','warning':bool(active)})
    rows.append({'label':'Pi CPU (informational)','value':f"{pi['cpu']:.1f}%" if finite(pi.get('cpu')) else 'Unavailable','warning':False})
    drivers=[(name,data) for name,data in status.items() if name.startswith(('tmc2209 ','tmc2208 ','tmc2130 ','tmc5160 ','tmc2240 ','tmc2660 '))]
    if not drivers:unknown.append('No supported driver status objects found')
    driver_labels={'stepper_x':'X','stepper_y':'Y X-max','y1':'Y1 X-min',
                   'stepper_z':'Z X-max','z1':'Z1 X-min'}
    for name,data in drivers:
        flags=data.get('drv_status');available=isinstance(flags,dict)
        bad=[key for key in ('otpw','ot','s2ga','s2gb','s2vsa','s2vsb') if available and flags.get(key)]
        # Only overtemperature flags qualify for the agreed timed pause policy.
        heat=available and bool(flags.get('otpw') or flags.get('ot'))
        if heat:warnings.append(name+': overtemperature warning/fault')
        if not available:unknown.append(name+' status unavailable (may be disabled)')
        stepper=name.split(' ',1)[1] if ' ' in name else name
        rows.append({'label':driver_labels.get(stepper,stepper),'value':', '.join(bad) if bad else 'No heat/fault flags reported' if available else 'Unavailable / possibly disabled','warning':bool(bad)})
    mcu=status.get('mcu',{}).get('last_stats',{})
    awake=mcu.get('mcu_awake')
    rows.append({'label':'MCU awake (informational)','value':f'{awake*100/5:.1f}% of last 5-second interval' if finite(awake) else 'Unavailable','warning':False})
    tool=status.get('toolhead',{});pt=tool.get('print_time');clock=tool.get('estimated_print_time')
    queued=max(0,pt-clock) if finite(pt) and finite(clock) else None
    rows.append({'label':'Scheduled motion ahead (informational)','value':f'~{queued:.2f} s; not an exact pause time' if finite(queued) else 'Unavailable','warning':False})
    return {'warnings':warnings,'rows':rows,'unknown':unknown,'hot':hot,'ready':ready}


class HealthState:
    def __init__(self):
        self.since=None;self.last=None;self.attempted=False;self.ack_required=False;self.hot=False;self.pause_reasons=[]

    def update(self, result, now, running):
        self.hot=result.get('hot',False)
        # Break persistence on stale gaps; never count missing samples as warnings.
        if self.last is not None and now-self.last>3:self.since=None
        self.last=now
        if result['warnings'] and result['ready']:
            if self.since is None:self.since=now
        else:self.since=None
        remaining=max(0,10-(now-self.since)) if self.since is not None else None
        pause=running and remaining is not None and remaining<=0 and not self.attempted
        if pause:self.attempted=True;self.ack_required=True
        # A pause must not re-arm the same hot fault. Re-arm only after the
        # monitored warning actually clears; otherwise an early Resume causes
        # a second automatic pause for the same event.
        if not result['warnings']:self.attempted=False
        return remaining,pause


class BatteryState:
    """Persistent time-based router-battery reminder state.

    This is deliberately not presented as voltage or state-of-charge telemetry.
    Runtime advances only while an acknowledged Pendant job is actively running.
    """
    def __init__(self):
        self.profile='';self.full_confirmed=False;self.battery_seconds=0.;self.job_seconds=0.
        self.filename='';self.reminder_at=None;self.deadline=None;self.ack_required=False
        self.pause_attempted=False;self.last=None;self.was_running=False;self.cycles=[]

    def restore(self, value):
        if not isinstance(value,dict):return
        self.profile=str(value.get('profile') or '')[:24];self.full_confirmed=bool(value.get('full_confirmed'))
        self.battery_seconds=max(0.,float(value.get('battery_seconds') or 0));self.job_seconds=max(0.,float(value.get('job_seconds') or 0))
        self.filename=str(value.get('filename') or '')[:512];self.reminder_at=value.get('reminder_at');self.deadline=value.get('deadline')
        self.ack_required=bool(value.get('ack_required'));self.pause_attempted=bool(value.get('pause_attempted'))
        self.cycles=list(value.get('cycles') or [])[-40:]

    def dump(self):
        return {'profile':self.profile,'full_confirmed':self.full_confirmed,'battery_seconds':self.battery_seconds,
                'job_seconds':self.job_seconds,'filename':self.filename,'reminder_at':self.reminder_at,
                'deadline':self.deadline,'ack_required':self.ack_required,'pause_attempted':self.pause_attempted,
                'cycles':self.cycles[-40:]}

    def arm(self, profile, full, filename, interval_minutes, now, changed=False):
        if changed and self.profile and self.battery_seconds>0:
            self.cycles.append({'profile':self.profile,'seconds':round(self.battery_seconds,1),'full_confirmed':self.full_confirmed,'outcome':'changed','at':time.time()})
        if changed or full:self.battery_seconds=0.
        if filename!=self.filename:self.job_seconds=0.
        self.profile=profile;self.full_confirmed=bool(full);self.filename=filename
        self.reminder_at=self.battery_seconds+interval_minutes*60;self.deadline=None
        self.ack_required=False;self.pause_attempted=False;self.last=now;self.was_running=False

    def acknowledge(self, interval_minutes, now, depleted=False):
        if depleted and self.profile:
            self.cycles.append({'profile':self.profile,'seconds':round(self.battery_seconds,1),'full_confirmed':self.full_confirmed,'outcome':'depleted','at':time.time()})
        self.reminder_at=self.battery_seconds+interval_minutes*60;self.deadline=None
        self.ack_required=False;self.pause_attempted=False;self.last=now

    def update(self, now, running, filename, interval_minutes, grace_minutes):
        if self.last is None:self.last=now
        delta=max(0.,min(5.,now-self.last))
        if self.was_running and self.filename==filename:
            self.battery_seconds+=delta;self.job_seconds+=delta
        self.last=now;self.was_running=bool(running and self.filename==filename and self.profile)
        if filename and filename!=self.filename and running:return {'start_required':True,'pause':False}
        if not self.was_running:return {'start_required':False,'pause':False}
        if self.reminder_at is None:self.reminder_at=self.battery_seconds+interval_minutes*60
        if self.battery_seconds>=self.reminder_at and self.deadline is None:
            self.deadline=now+grace_minutes*60;self.ack_required=True
        pause=bool(self.deadline is not None and now>=self.deadline and not self.pause_attempted)
        if pause:self.pause_attempted=True
        return {'start_required':False,'pause':pause}

    def view(self, now, enabled, profiles):
        names={str(p.get('id')):str(p.get('name')) for p in profiles if isinstance(p,dict)}
        return {'enabled':enabled,'profile':self.profile,'profile_name':names.get(self.profile,self.profile or 'Not selected'),
                'full_confirmed':self.full_confirmed,'battery_seconds':self.battery_seconds,'job_seconds':self.job_seconds,
                'ack_required':self.ack_required,'countdown':max(0,self.deadline-now) if self.deadline is not None else None,
                'next_in':max(0,self.reminder_at-self.battery_seconds) if self.reminder_at is not None else None,
                'filename':self.filename,'pause_attempted':self.pause_attempted,'cycles':self.cycles[-12:]}


class CNCHealth:
    def __init__(self, server, api, config):
        self.server=server;self.api=api;self.db=server.lookup_component('database')
        self.enabled=config.getboolean('health_enabled',False)
        self.state=HealthState();self.snapshot={'state':'unavailable','message':'Monitor not activated','rows':[]}
        self.lock=asyncio.Lock();self.names=None;self.task=None;self.lamp=False;self.loaded=False;self.updated=0
        self.pi_cache={};self.pi_at=0;self.pause_error=None
        self.battery=BatteryState();self.battery_loaded=False;self.battery_saved=0
        self.battery_settings={'enabled':False,'reminder':15.,'grace':3.,'profiles':[{'id':'small','name':'Small battery'},{'id':'large','name':'Large battery'}]}
        server.register_endpoint('/machine/cnc_health/status',RequestType.GET,self.status)
        server.register_endpoint('/machine/cnc_health/acknowledge',RequestType.POST,self.acknowledge)
        server.register_endpoint('/machine/cnc_health/pause',RequestType.POST,self.pause_now)
        server.register_endpoint('/machine/cnc_health/battery_status',RequestType.GET,self.battery_status)
        server.register_endpoint('/machine/cnc_health/battery_start',RequestType.POST,self.battery_start)
        server.register_endpoint('/machine/cnc_health/battery_acknowledge',RequestType.POST,self.battery_acknowledge)
        server.register_endpoint('/machine/cnc_health/battery_change',RequestType.POST,self.battery_change)
        server.register_event_handler('server:klippy_ready',self.ready)
        server.register_event_handler('server:klippy_disconnect',self.disconnected)

    async def ready(self):
        self.names=None
        if self.enabled and (self.task is None or self.task.done()):self.task=asyncio.create_task(self.loop())

    async def disconnected(self):
        self.updated=0;self.names=None;self.state.since=None;self.lamp=False
        self.snapshot={'state':'unavailable','message':'Klipper connection unavailable','rows':[],'ack_required':self.state.ack_required}

    async def loop(self):
        while self.enabled:
            try:await self.refresh(force=True)
            except asyncio.CancelledError:raise
            except Exception:
                self.updated=0;self.state.since=None
                self.snapshot={'state':'unavailable','message':'Health sampling unavailable','rows':[],'ack_required':self.state.ack_required}
                logging.exception('CNC health sampling failed')
            await asyncio.sleep(1)

    async def refresh(self, force=False):
        if not self.enabled:return self.snapshot
        async with self.lock:
            now=time.monotonic()
            if not force and now-self.updated<.8:return self.snapshot
            if not self.loaded:
                latch=await asyncio.wait_for(self.db.get_item('cnc_health','pause_latch',False),3)
                self.state.ack_required=bool(latch.get('required')) if isinstance(latch,dict) else bool(latch)
                self.state.pause_reasons=latch.get('reasons',[]) if isinstance(latch,dict) else []
                self.loaded=True
            if not self.battery_loaded:
                saved=await asyncio.wait_for(self.db.get_item('cnc_battery','state',{}),3)
                self.battery.restore(saved);self.battery_loaded=True
            if self.names is None:
                names=await self.api.get_object_list()
                self.names={n:None for n in names if n in ['webhooks','toolhead','print_stats','pause_resume','virtual_sdcard','mcu','gcode_macro CNC_HEALTH_LIGHT'] or n.startswith(('tmc2209 ','tmc2208 ','tmc2130 ','tmc5160 ','tmc2240 ','tmc2660 '))}
            s=await asyncio.wait_for(self.api.query_objects(self.names),3)
            if now-self.pi_at>=2:
                proc=self.server.lookup_component('proc_stats')
                raw=await asyncio.wait_for(proc._handle_stat_request(None),3)
                throttle=raw.get('throttled_state') or {}
                self.pi_cache={'temperature':raw.get('cpu_temp'),'cpu':raw.get('system_cpu_usage',{}).get('cpu'),
                               'bits':throttle.get('bits') if throttle.get('flags')!=['?'] else None}
                self.pi_at=now
            limit=await asyncio.wait_for(self.db.get_item('cnc_pendant','temperatureWarning',75),3)
            if not finite(limit) or not 40<=limit<=85:raise ValueError('Invalid temperature warning setting')
            result=evaluate(s,self.pi_cache,limit,self.state.hot)
            lamp_status=s.get('gcode_macro CNC_HEALTH_LIGHT')
            if isinstance(lamp_status,dict):self.lamp=bool(lamp_status.get('active'))
            else:result['unknown'].append('Hardware warning lamp macro unavailable')
            running=s.get('print_stats',{}).get('state')=='printing' and not s.get('pause_resume',{}).get('is_paused')
            remaining,should_pause=self.state.update(result,time.monotonic(),running)
            power=await asyncio.wait_for(self.db.get_item('cnc_pendant','spindlePower','battery'),3)
            reminder=await asyncio.wait_for(self.db.get_item('cnc_pendant','batteryReminderMinutes',15),3)
            grace=await asyncio.wait_for(self.db.get_item('cnc_pendant','batteryGraceMinutes',3),3)
            profiles=await asyncio.wait_for(self.db.get_item('cnc_pendant','batteryProfiles',self.battery_settings['profiles']),3)
            if power not in ('battery','ac','controlled'):power='battery'
            if not finite(reminder) or not 1<=reminder<=180:reminder=15.
            if not finite(grace) or not .25<=grace<=30:grace=3.
            if not isinstance(profiles,list) or not profiles:profiles=self.battery_settings['profiles']
            self.battery_settings={'enabled':power=='battery','reminder':float(reminder),'grace':float(grace),'profiles':profiles}
            filename=str(s.get('print_stats',{}).get('filename') or '')
            battery_result=self.battery.update(time.monotonic(),running,filename,float(reminder),float(grace)) if power=='battery' else {'start_required':False,'pause':False}
            if battery_result.get('pause'):
                try:
                    await asyncio.wait_for(self.api.pause_print(),5)
                    logging.warning('CNC battery reminder requested PAUSE after acknowledgment deadline')
                except Exception:
                    self.pause_error='Battery reminder pause failed; stop the router and check the machine'
                    logging.exception('CNC battery reminder PAUSE failed')
            if should_pause:
                self.state.pause_reasons=list(result['warnings'])
                try:
                    await asyncio.wait_for(self.db.insert_item('cnc_health','pause_latch',{'required':True,'reasons':self.state.pause_reasons,'at':time.time()}),3)
                except Exception:
                    logging.exception('CNC health pause latch persistence failed; requesting PAUSE anyway')
                try:
                    # Same established pause macro/return capture as normal Pause.
                    await asyncio.wait_for(self.api.pause_print(),5)
                    self.pause_error=None
                    logging.warning('CNC health requested PAUSE: %s',result['warnings'])
                except Exception as error:
                    self.pause_error='Pause request failed; check machine immediately'
                    logging.exception('CNC health PAUSE failed')
            want_lamp=bool(result['warnings']) and result['ready']
            if want_lamp!=self.lamp:
                try:
                    await asyncio.wait_for(self.api.run_gcode('CNC_HEALTH_LIGHT ACTIVE='+str(int(want_lamp))),3)
                    self.lamp=want_lamp
                    if self.pause_error and self.pause_error.startswith('Warning lamp'):self.pause_error=None
                except Exception:
                    self.pause_error='Warning lamp command failed; check machine'
                    logging.exception('CNC health lamp unavailable')
            if not want_lamp and not self.lamp and self.pause_error and self.pause_error.startswith('Warning lamp'):
                self.pause_error=None
            self.snapshot={**result,'state':'fault' if not result['ready'] or self.pause_error else 'warning' if result['warnings'] else 'unavailable' if result['unknown'] else 'normal',
                           'countdown':remaining if running else None,'ack_required':self.state.ack_required,'running':running,
                           'message':self.pause_error or ('; '.join(result['warnings']) if result['warnings'] else 'Some readings unavailable' if result['unknown'] else 'No monitored warnings'),
                           'pause_attempted':self.state.attempted}
            self.snapshot['battery']={**self.battery.view(time.monotonic(),power=='battery',profiles),
                                      'start_required':battery_result.get('start_required',False),
                                      'reminder_minutes':float(reminder),'grace_minutes':float(grace),'profiles':profiles}
            if self.state.pause_reasons:self.snapshot['rows'].append({'label':'Last health pause','value':'; '.join(self.state.pause_reasons),'warning':self.state.ack_required})
            if self.state.ack_required and not result['warnings']:
                self.snapshot['message']='Warning cleared; inspect and acknowledge before Resume' if not result['unknown'] else 'Restore missing readings before acknowledgment'
                if not self.pause_error:self.snapshot['state']='warning'
            self.updated=time.monotonic()
            if time.monotonic()-self.battery_saved>=10 or battery_result.get('pause'):
                await asyncio.wait_for(self.db.insert_item('cnc_battery','state',self.battery.dump()),3)
                self.battery_saved=time.monotonic()
            return self.snapshot

    async def status(self, request):
        stale=not self.updated or time.monotonic()-self.updated>5
        return {**self.snapshot,'state':'unavailable' if stale else self.snapshot['state'],
                'message':'Hardware status stale or unavailable' if stale else self.snapshot.get('message'),
                'stale':stale,'enabled':self.enabled}

    async def blocked(self):
        if not self.enabled:return None
        try:r=await self.refresh()
        except Exception:return 'Hardware health unavailable; check status before Start/Resume.'
        if not self.updated or time.monotonic()-self.updated>5 or not r.get('ready'):return 'Hardware health unavailable; check status.'
        if r.get('warnings'):return 'Active hardware warning: '+ '; '.join(r['warnings'])
        if r.get('unknown'):return 'Required hardware readings unavailable; check Machine health.'
        if self.state.ack_required:return 'Health pause requires acknowledgment after the fault clears.'
        if self.battery_settings.get('enabled') and self.battery.ack_required:return 'Router battery reminder requires acknowledgment before Resume.'
        return None

    def _battery_profile(self, request):
        profile=request.get_str('profile','')
        valid={str(p.get('id')) for p in self.battery_settings.get('profiles',[]) if isinstance(p,dict)}
        if profile not in valid:raise self.server.error('Select a configured router battery.',400)
        return profile

    def _battery_interval(self, request):
        try:value=float(request.get_str('next_minutes',str(self.battery_settings.get('reminder',15))))
        except Exception:raise self.server.error('Enter a valid next reminder time.',400)
        if not 1<=value<=180:raise self.server.error('Next reminder must be from 1 to 180 minutes.',400)
        return value

    async def _save_battery(self):
        await self.db.insert_item('cnc_battery','state',self.battery.dump());self.battery_saved=time.monotonic()

    async def battery_status(self, request):
        await self.refresh()
        return {**self.battery.view(time.monotonic(),self.battery_settings['enabled'],self.battery_settings['profiles']),
                'profiles':self.battery_settings['profiles'],'reminder_minutes':self.battery_settings['reminder'],
                'grace_minutes':self.battery_settings['grace']}

    async def battery_start(self, request):
        if not self.battery_settings['enabled']:return {'ok':True,'enabled':False}
        profile=self._battery_profile(request);filename=request.get_str('filename','')
        if not filename:raise self.server.error('A prepared job filename is required.',400)
        full=request.get_str('full','false').lower() in ('1','true','yes','on')
        self.battery.arm(profile,full,filename,self._battery_interval(request),time.monotonic())
        await self._save_battery();return {'ok':True,**self.battery.view(time.monotonic(),True,self.battery_settings['profiles'])}

    async def battery_acknowledge(self, request):
        if not self.battery_settings['enabled']:return {'ok':True,'enabled':False}
        self.battery.acknowledge(self._battery_interval(request),time.monotonic())
        await self._save_battery();return {'ok':True,**self.battery.view(time.monotonic(),True,self.battery_settings['profiles'])}

    async def battery_change(self, request):
        if not self.battery_settings['enabled']:return {'ok':True,'enabled':False}
        profile=self._battery_profile(request);filename=request.get_str('filename',self.battery.filename)
        self.battery.arm(profile,True,filename,self._battery_interval(request),time.monotonic(),changed=True)
        await self._save_battery();return {'ok':True,**self.battery.view(time.monotonic(),True,self.battery_settings['profiles'])}

    async def acknowledge(self, request):
        r=await self.refresh(force=True)
        if not r.get('ready') or r.get('warnings') or r.get('unknown') or not self.updated:raise self.server.error('Clear active hardware warnings and restore readings before acknowledgment.',409)
        await self.db.insert_item('cnc_health','pause_latch',False)
        self.state.ack_required=False;self.pause_error=None
        return {'ok':True,'message':'Acknowledged. Reverify and explicitly Resume; no motion requested.'}

    async def pause_now(self, request):
        r=await self.refresh(force=True)
        if not r.get('running') or not r.get('ready'):raise self.server.error('No running job available to pause.',409)
        await self.db.insert_item('cnc_health','pause_latch',True);self.state.ack_required=True
        await self.api.pause_print()
        return {'ok':True,'message':'Pause requested; buffered motion and the pause macro may still execute.'}
