import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[1] / 'fusion-addin/CncOutbox/naming.py'
spec = importlib.util.spec_from_file_location('naming', path)
naming = importlib.util.module_from_spec(spec)
spec.loader.exec_module(naming)

class Naming(unittest.TestCase):
    def test_unique_and_identifiable(self):
        names = [naming.unique_name('P38', 'Fasten only', 'T1 1/8 inch') for _ in range(100)]
        self.assertEqual(len(set(names)), 100)
        self.assertTrue(all(n.startswith('P38__Fasten_only__T1_1_8_inch__') for n in names))
    def test_invalid_characters_and_length(self):
        self.assertEqual(naming.clean('a:b/c*?'), 'a_b_c')
        self.assertLessEqual(len(naming.clean('x'*200)), 45)
        self.assertEqual(naming.clean('???'), 'unnamed')

if __name__ == '__main__':
    unittest.main()
