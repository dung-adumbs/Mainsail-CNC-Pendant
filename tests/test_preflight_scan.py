import sys,tempfile,unittest,hashlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'moonraker'))
from cnc_gcode_scan import scan_file,evaluate_bounds,fingerprints,thumbnail_data_url
class ScanTests(unittest.TestCase):
 def test_thumbnail_is_bounded_svg_not_an_approval(self):
  import base64
  m=self.scan('G90\nG21\nG1 X0 Y0 Z5\nG1 X100 Y0\nG1 X100 Y50\nG1 X0 Y50\nG1 X0 Y0\n')
  svg=base64.b64decode(thumbnail_data_url(m).split(',',1)[1]).decode()
  self.assertIn('X 100.0 × Y 50.0 mm',svg);self.assertIn('viewBox="0 0 320 210"',svg);self.assertNotIn('script',svg)
  with self.assertRaises(ValueError):thumbnail_data_url(self.scan('G90\nG92 X0\nG1 X10 Y10\n'))
 def scan(self,text):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'test.gcode';p.write_text(text);return scan_file(p)
 def test_absolute_relative_and_offsets(self):
  m=self.scan('G90\nG1 X10 Y20 Z5\nG91\nG1 X-4 Z-8\n')
  self.assertFalse(m.issues);b=m.remaining_bounds([0,0,0]);self.assertEqual(b['min'],[0,0,-3]);self.assertEqual(b['max'],[10,20,5])
  self.assertFalse(evaluate_bounds(b,[0,0,2],[0]*3,[100]*3)['fits'])
  self.assertTrue(evaluate_bounds(b,[0,0,3],[0]*3,[100]*3)['fits'])
 def test_comment_does_not_create_approval_boundary(self):
  m=self.scan('G90\nG1 X1 Y1 Z1\n; CNC_TOOL_BEGIN other\nG1 X1000\n');self.assertEqual(len(m.sections),1);self.assertEqual(m.remaining_bounds([0]*3)['max'][0],1000)
 def test_pause_creates_boundary(self):
  text='G90\nG1 X1 Y1 Z1\nPAUSE_BASE\nG1 X1000\n';m=self.scan(text)
  self.assertEqual(m.remaining_bounds([0]*3)['max'][0],1)
  self.assertEqual(m.remaining_bounds([0]*3,text.index('G1 X1000'))['max'][0],1000)
 def test_relative_pause_reanchors_at_capture(self):
  text='G91\nG1 X10\nPAUSE_BASE\nG1 X5\n';m=self.scan(text);b=m.remaining_bounds([999,999,999],text.index('PAUSE_BASE'),True,[20,30,40]);self.assertEqual(b['min'],[20,30,40]);self.assertEqual(b['max'],[25,30,40])
 def test_arc_cardinal_extrema(self):
  m=self.scan('G90\nG1 X10 Y0 Z5\nG3 X-10 Y0 I-10 J0\n');self.assertFalse(m.issues);b=m.remaining_bounds([0,0,5]);self.assertAlmostEqual(b['max'][1],10);self.assertEqual(b['min'][0],-10)
 def test_full_circle_and_helix(self):
  m=self.scan('G90\nG1 X10 Y0 Z0\nG2 X10 Y0 Z10 I-10\n');self.assertFalse(m.issues);b=m.remaining_bounds([10,0,0]);self.assertAlmostEqual(b['min'][1],-10);self.assertAlmostEqual(b['max'][1],10);self.assertEqual(b['max'][2],10)
 def test_fail_closed_commands_modes_loops(self):
  for program in ['G1 X1','G90\nG92 X0\nG1 X1','G20\nG90\nG1 X1','G90\nG1 X1 E1','G90\nG1 X1 X2','G90\nG1 X1\nCUSTOM_MACRO','G90\nG1 X0 Y0 Z0\nSDCARD_LOOP_BEGIN COUNT=2\nG1 X1\nSDCARD_LOOP_END']:
   with self.subTest(program=program):self.assertTrue(self.scan(program).issues)
 def test_closed_loop_bounds(self):
  text='G90\nG1 X0 Y0 Z0\nSDCARD_LOOP_BEGIN COUNT=0\nG1 X50\nG1 X0\nSDCARD_LOOP_END\n';m=self.scan(text);self.assertFalse(m.issues);self.assertEqual(m.remaining_bounds([0]*3,text.index('G1 X0\nSDCARD_LOOP_END'))['max'][0],50)
 def test_reviewed_runtime_macros_require_profile_coverage(self):
  m=self.scan('G90\nCNC_TEST_PREFLIGHT KIND=CIRCLE\nLED_ON\nSTART_JOB\nG1 X1\nEND_JOB\n');self.assertFalse(m.issues);self.assertEqual(m.runtime_macros,['CNC_TEST_PREFLIGHT','LED_ON','START_JOB','END_JOB'])
  self.assertTrue(self.scan('G90\nLED_ON X1\nG1 X1').issues)
 def test_hash_and_sidecar_fingerprint(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'f.gcode';body=b'G90\nG1 X1\n';p.write_bytes(body);m=scan_file(p);self.assertEqual(m.sha256,hashlib.sha256(body).hexdigest());p.write_bytes(body+b'; changed\n');self.assertNotEqual(fingerprints(p)[0],m.sha256)
if __name__=='__main__':unittest.main()
