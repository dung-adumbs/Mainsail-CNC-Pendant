import configparser,copy,unittest
from pathlib import Path
import jinja2
c=configparser.RawConfigParser();c.read(Path(__file__).resolve().parents[1]/'moonraker/cnc_preflight_guard.cfg')
env=jinja2.Environment(block_start_string='{%',block_end_string='%}',variable_start_string='{',variable_end_string='}')
template=env.from_string(c.get('gcode_macro _CNC_PREFLIGHT_REQUIRE','gcode'))
def fail(message):raise ValueError(message)
class GuardTests(unittest.TestCase):
 def setUp(self):
  self.gate={'start_approved':1,'resume_approved':0,'filename':'test.gcode','expires':105,**{'machine_'+a:10 for a in 'xyz'},**{'offset_'+a:5 for a in 'xyz'}}
  self.p={'gcode_macro _CNC_PREFLIGHT_STATE':self.gate,'gcode_move':{'position':dict.fromkeys('xyz',10),'gcode_position':dict.fromkeys('xyz',5)},'toolhead':{'homed_axes':'xyz','estimated_print_time':100},'pause_resume':{'is_paused':False}}
 def render(self,**params):return template.render(printer=self.p,params={'KIND':'START','FILENAME':'test.gcode',**params},action_raise_error=fail)
 def test_valid_consumes(self):self.assertIn('VARIABLE=start_approved VALUE=0',self.render())
 def test_unapproved_expired_filename_unhomed_and_changed_zero(self):
  edits=[lambda:self.gate.update(start_approved=0),lambda:self.gate.update(expires=99),lambda:self.gate.update(filename='other.gcode'),lambda:self.p['toolhead'].update(homed_axes='xy'),lambda:self.p['gcode_move']['gcode_position'].update(z=0)]
  for edit in edits:
   self.setUp();edit()
   with self.assertRaises(ValueError):self.render()
 def test_resume_requires_pause_and_approval(self):
  with self.assertRaises(ValueError):self.render(KIND='RESUME')
  self.gate['resume_approved']=1;self.p['pause_resume']['is_paused']=True;self.assertIn('resume_approved VALUE=0',self.render(KIND='RESUME'))
if __name__=='__main__':unittest.main()
