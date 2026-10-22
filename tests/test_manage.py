import importlib.util,pathlib,tempfile,unittest,types
spec=importlib.util.spec_from_file_location('manage','tools/manage.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class Installer(unittest.TestCase):
 def test_dry_plan_separate_page(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);web=root/'mainsail';cfg=root/'config';web.mkdir();cfg.mkdir();(web/'.version').write_text('v2.17.0');(web/'index.html').write_text('<html><head></head><body>Original dashboard</body></html>')
   args=types.SimpleNamespace(mainsail_dir=web,config_dir=cfg,recovery=False)
   roots,files=module.plan(args)
   self.assertEqual(len(files),8);self.assertIn(b'cnc-pendant-link.js',files[0][1]);self.assertIn(b'Original dashboard',files[0][1]);self.assertNotIn(b'mainsail-cnc.js',files[0][1])
   self.assertIn('Original dashboard',(web/'index.html').read_text());self.assertFalse((web/'cnc-pendant.html').exists())
 def test_version_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'.version').write_text('unknown');(root/'index.html').write_text('</head>')
   with self.assertRaises(RuntimeError):module.plan(types.SimpleNamespace(mainsail_dir=root,config_dir=root,recovery=False))
if __name__=='__main__':unittest.main()
