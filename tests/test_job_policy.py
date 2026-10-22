import configparser,unittest
from types import SimpleNamespace as NS
import jinja2
c=configparser.RawConfigParser();c.read('examples/lowrider-v4/job-speed-policy.cfg')
env=jinja2.Environment(block_start_string='{%',block_end_string='%}',variable_start_string='{',variable_end_string='}')
def render(section,p,params={}):return env.from_string(c.get(section,'gcode')).render(printer=p,params=params,rawparams='FILENAME="test.gcode"')
class JobPolicy(unittest.TestCase):
 def test_restore_never_exceeds_normal(self):
  for saved,want in [(50,50),(100,100),(300,100)]:
   text=render('delayed_gcode cnc_restore_run_speed',NS(save_variables=NS(variables={'cnc_run_speed':saved})))
   self.assertEqual(float(text.split('M220 S')[1].strip()),want)
 def test_start_wrap_and_resume_separation(self):
  self.assertIn('START_JOB',render('gcode_macro SDCARD_PRINT_FILE',{}))
  self.assertFalse(c.has_section('gcode_macro RESUME'))
 def test_reference_start_cap(self):
  r=configparser.RawConfigParser();r.read('examples/lowrider-v4/cnc-macros.cfg');template=env.from_string(r.get('gcode_macro START_JOB','gcode'))
  for factor,want in [(.5,50),(1,100),(3,100)]:
   text=template.render(printer=NS(gcode_move=NS(speed_factor=factor)))
   self.assertEqual(float(text.split('M220 S')[1].splitlines()[0]),want)
if __name__=='__main__':unittest.main()
