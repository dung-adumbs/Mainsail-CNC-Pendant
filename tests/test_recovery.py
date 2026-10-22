import importlib.util,types
spec=importlib.util.spec_from_file_location('recovery','klipper/extras/cnc_force_jog.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Command:
 def __init__(self,**kw):self.kw=kw
 def error(self,s):return RuntimeError(s)
 def get(self,k,default=None):return self.kw.get(k,default)
 def get_int(self,k,default=None,**opts):return int(self.kw.get(k,default))
 def get_float(self,k,default=None,**opts):return float(self.kw.get(k,default))
class Kin:
 def __init__(self):self.homed='xz';self.calls=0;self.limits=[(0,624),(1,-1),(0,109)]
 def check_move(self,move):self.calls+=1;raise RuntimeError('Must home axis first')
class Tool:
 def __init__(self):self.kin=Kin();self.pos=[5.,5.,50.,0.];self.moves=[];self.waited=0;self.queued=False
 def check_busy(self,now):return (0,100,not self.queued)
 def get_status(self,now):return {'homed_axes':self.kin.homed}
 def get_position(self):return self.pos
 def get_kinematics(self):return self.kin
 def move(self,target,speed):
  move=types.SimpleNamespace(axes_d=[a-b for a,b in zip(target,self.pos)],limit_speed=lambda v,a:self.moves.append(('limit',v,a)))
  self.kin.check_move(move);self.moves.append(('move',target,speed));self.pos=target
 def wait_moves(self):self.waited+=1
class Force:
 def __init__(self):self.enabled=[];self.moved=[]
 def lookup_stepper(self,n):return n
 def _force_enable(self,n):self.enabled.append(n)
 def manual_move(self,*args):self.moved.append(args)
class Printer:
 def __init__(self):
  self.tool=Tool();self.force=Force();self.events={};self.state='standby';self.paused=False;self.active=False;self.resets=0
  self.gcode=types.SimpleNamespace(register_command=lambda *a,**k:None)
 def get_reactor(self):return types.SimpleNamespace(monotonic=lambda:100)
 def register_event_handler(self,n,fn):self.events[n]=fn
 def lookup_object(self,n):
  return {'gcode':self.gcode,'toolhead':self.tool,'force_move':self.force,'print_stats':types.SimpleNamespace(get_status=lambda t:{'state':self.state}),'pause_resume':types.SimpleNamespace(get_status=lambda t:{'is_paused':self.paused}),'virtual_sdcard':types.SimpleNamespace(get_status=lambda t:{'is_active':self.active}),'gcode_move':types.SimpleNamespace(reset_last_position=lambda:setattr(self,'resets',self.resets+1))}[n]
class Config:
 def __init__(self,p):self.p=p
 def get_printer(self):return self.p
 def getsection(self,n):return types.SimpleNamespace(get=lambda k:'cartesian')
 def error(self,s):return RuntimeError(s)
def reject(fn):
 try:fn()
 except RuntimeError:return
 raise AssertionError('Expected rejection')
p=Printer();c=mod.CNCForceJog(Config(p));orig=p.tool.kin.check_move;limits=p.tool.kin.limits[:]
reject(lambda:c.cmd_MODE(Command(ENABLE=1)))
c.cmd_MODE(Command(ENABLE=1,CONFIRM=1));token=c.sequence
c.cmd_JOG(Command(AXIS='Y',DISTANCE=1,TOKEN=token,MOTORS='both'))
assert p.tool.pos==[5,6,50,0] and p.tool.waited==1 and p.tool.kin.homed=='xz' and p.tool.kin.limits==limits and p.tool.kin.check_move==orig
assert p.tool.moves[0]==('limit',1,10) and not p.force.moved
reject(lambda:c.cmd_JOG(Command(AXIS='Y',DISTANCE=1,TOKEN=token)))
reject(lambda:c.cmd_JOG(Command(AXIS='Y',DISTANCE=2,TOKEN=c.sequence)))
reject(lambda:c.cmd_JOG(Command(AXIS='X',DISTANCE=1,TOKEN=c.sequence)))
reject(lambda:c.cmd_JOG(Command(AXIS='Y',DISTANCE=.1,TOKEN=c.sequence,MOTORS='primary')))
c.cmd_JOG(Command(AXIS='Y',DISTANCE=.1,TOKEN=c.sequence,MOTORS='primary',SINGLE_CONFIRM=1))
assert p.force.enabled==['stepper_y','stepper_y1'] and p.force.moved==[('stepper_y',.1,1.,10.)]
assert p.tool.kin.homed=='xz' and p.tool.kin.check_move==orig
p.events['homing:home_rails_begin']();assert not c.enabled
c.cmd_MODE(Command(ENABLE=1,CONFIRM=1));p.paused=True;reject(lambda:c.cmd_JOG(Command(AXIS='Y',DISTANCE=1,TOKEN=c.sequence)));assert not c.enabled
p.paused=False;p.tool.queued=True;reject(lambda:c.cmd_MODE(Command(ENABLE=1,CONFIRM=1)))
p.tool.queued=False;c.cmd_MODE(Command(ENABLE=1,CONFIRM=1));p.state='printing';assert not c.get_status(100)['enabled']
print('Passed paired scheduling, fixed speed/steps, unchanged homing/limits, no stale click queue, single-motor acknowledgement, excluded-motor HOLD, homing exit and running/paused/moving lockouts.')
