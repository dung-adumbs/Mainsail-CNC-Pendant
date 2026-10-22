import importlib.util, pathlib, unittest
ROOT=pathlib.Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('travel',ROOT/'moonraker/cnc_travel_optimize.py');travel=importlib.util.module_from_spec(spec);spec.loader.exec_module(travel)
HEADER='; CNC_PENDANT_OPTIMIZER: V1\n; CNC_POST_VERSION: Test 0.5\n; CNC_TRAVEL_CLEARANCE_MM: 5\nG90\nG21\n'
PROGRAM=HEADER+'''; CNC_MOVE: UNKNOWN
G1 X0 Y0 Z10 F100
; CNC_MOVE: TRAVEL_XY
G1 X10 Y0 Z10 F100
; CNC_MOVE: PLUNGE
G1 Z-1 F75
; CNC_MOVE: CUT
G1 X20 F200
; CNC_MOVE: RETRACT_Z
G1 Z10 F100
; CNC_MOVE: TRAVEL_XY
G1 Y10 F100
; CNC_MOVE: CUT
G1 X25 F200
'''
class Travel(unittest.TestCase):
 def run_program(self,s=PROGRAM):return travel.optimize_bytes(s.encode(),3000,180)
 def test_only_proven_travel_feeds_change(self):
  result,report=self.run_program();text=result.decode();self.assertEqual(report['changed_moves'],3)
  self.assertIn('G1 X10 Y0 Z10 F3000',text);self.assertIn('G1 Z10 F180',text)
  self.assertIn('G1 Z-1 F75',text);self.assertIn('G1 X20 F200',text);self.assertIn('G1 X25 F200',text)
  before=[line.rsplit(' F',1)[0] for line in PROGRAM.splitlines() if line.startswith('G1')]
  after=[line.rsplit(' F',1)[0] for line in text.splitlines() if line.startswith('G1')];self.assertEqual(before,after)
 def test_legacy_and_future_headers_rejected(self):
  for s in [PROGRAM.replace(travel.HEADER,''),PROGRAM.replace('OPTIMIZER: V1','OPTIMIZER: V2')]:
   with self.assertRaises(ValueError):self.run_program(s)
 def test_no_inherited_feed_or_mode(self):
  for old,new in [('G90','G91'),('G21','G20'),('G1 X20 F200','G1 X20')]:
   with self.assertRaises(ValueError):self.run_program(PROGRAM.replace(old,new))
 def test_bad_marker_geometry_rejected(self):
  for old,new in [('G1 X10 Y0 Z10 F100','G1 X10 Y0 Z4 F100'),('G1 Z10 F100','G1 X30 Z10 F100'),('G1 Z10 F100','G1 Z-2 F100')]:
   with self.assertRaises(ValueError):self.run_program(PROGRAM.replace(old,new))
 def test_markers_do_not_leak(self):
  for old,new in [('; CNC_MOVE: CUT\nG1 X20','G1 X20'),('; CNC_MOVE: CUT\nG1 X20','; CNC_MOVE: CUT\n; note\nG1 X20')]:
   with self.assertRaises(ValueError):self.run_program(PROGRAM.replace(old,new))
 def test_pause_invalidates_coordinate_knowledge(self):
  result,report=self.run_program(PROGRAM.replace('; CNC_MOVE: RETRACT_Z','PAUSE_BASE\n; CNC_MOVE: RETRACT_Z'))
  self.assertIn('G1 Z10 F100',result.decode());self.assertEqual(report['changed_moves'],1)
 def test_reoptimization_rejected(self):
  result,_=self.run_program()
  with self.assertRaises(ValueError):travel.optimize_bytes(result,3000,180)
 def test_nonfinite_rates_rejected(self):
  for rate in [float('nan'),float('inf'),0,-1,30001]:
   with self.assertRaises(ValueError):travel.optimize_bytes(PROGRAM.encode(),rate,180)
 def test_unknown_start_preserved(self):
  result,_=self.run_program();self.assertIn('G1 X0 Y0 Z10 F100',result.decode())
 def test_header_original_not_modified(self):
  original=PROGRAM.encode();result,report=self.run_program();self.assertEqual(original,PROGRAM.encode());self.assertNotEqual(report['source_sha256'],report['output_sha256']);self.assertIn(b'CNC_OPTIMIZED:',result)
if __name__=='__main__':unittest.main()
