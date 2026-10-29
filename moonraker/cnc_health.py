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
    for name,data in drivers:
        flags=data.get('drv_status');available=isinstance(flags,dict)
        bad=[key for key in ('otpw','ot','s2ga','s2gb','s2vsa','s2vsb') if available and flags.get(key)]
        # Only overtemperature flags qualify for the agreed timed pause policy.
        heat=available and bool(flags.get('otpw') or flags.get('ot'))
        if heat:warnings.append(name+': overtemperature warning/fault')
        if not available:unknown.append(name+' status unavailable (may be disabled)')
        rows.append({'label':name,'value':', '.join(bad) if bad else 'No heat/fault flags reported' if available else 'Unavailable / possibly disabled','warning':bool(bad)})
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
        if not running:self.attempted=False
        return remaining,pause


class CNCHealth:
    def __init__(self, server, api, config):
        self.server=server;self.api=api;self.db=server.lookup_component('database')
        self.enabled=config.getboolean('health_enabled',False)
        self.state=HealthState();self.snapshot={'state':'unavailable','message':'Monitor not activated','rows':[]}
        self.lock=asyncio.Lock();self.names=None;self.task=None;self.lamp=False;self.loaded=False;self.updated=0
        self.pi_cache={};self.pi_at=0;self.pause_error=None
        server.register_endpoint('/machine/cnc_health/status',RequestType.GET,self.status)
        server.register_endpoint('/machine/cnc_health/acknowledge',RequestType.POST,self.acknowledge)
        server.register_endpoint('/machine/cnc_health/pause',RequestType.POST,self.pause_now)
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
            if self.state.pause_reasons:self.snapshot['rows'].append({'label':'Last health pause','value':'; '.join(self.state.pause_reasons),'warning':self.state.ack_required})
            if self.state.ack_required and not result['warnings']:
                self.snapshot['message']='Warning cleared; inspect and acknowledge before Resume' if not result['unknown'] else 'Restore missing readings before acknowledgment'
                if not self.pause_error:self.snapshot['state']='warning'
            self.updated=time.monotonic()
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
        return None

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
