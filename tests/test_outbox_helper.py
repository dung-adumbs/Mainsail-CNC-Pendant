import importlib.util
import pathlib
import tempfile
import unittest
import urllib.error

spec = importlib.util.spec_from_file_location('outbox', pathlib.Path(__file__).resolve().parents[1] / 'pc-outbox/outbox_helper.py')
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Fake:
    inbox = 'Inbox'
    def __init__(self):
        self.remote = {}
        self.uploads = 0
        self.offline = False
        self.corrupt = False
    def ensure_inbox(self):
        if self.offline:
            raise urllib.error.URLError('offline')
    def read(self, name):
        if name not in self.remote:
            raise urllib.error.HTTPError('', 404, '', {}, None)
        return b'wrong' if self.corrupt else self.remote[name]
    def send(self, name, data):
        self.uploads += 1
        self.remote[name] = data

class Outbox(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = pathlib.Path(self.tmp.name)
        self.fake = Fake()
        self.notices = []
        self.worker = mod.Worker(self.root, {'server': 'http://test', 'outbox': str(self.root/'Outbox'), 'sent': str(self.root/'Sent'), 'settle_seconds': 10}, self.fake, lambda *args: self.notices.append(args))
        self.path = self.worker.outbox/'example.gcode'
        self.path.write_bytes(b'; inert upload test\n')
    def test_settle_verify_and_archive(self):
        self.worker.tick(0)
        self.worker.tick(9)
        self.assertTrue(self.path.exists())
        self.worker.tick(11)
        self.assertFalse(self.path.exists())
        self.assertEqual(self.fake.uploads, 1)
        self.assertEqual(len(list(self.worker.sent.rglob('*.receipt.json'))), 1)
        self.assertFalse(self.notices)
    def test_offline_retains_then_recovers_silently(self):
        self.fake.offline = True
        self.worker.tick(0)
        self.worker.tick(11)
        self.worker.tick(12)
        self.assertTrue(self.path.exists())
        self.assertEqual(len(self.notices), 1)
        self.fake.offline = False
        self.worker.tick(80)
        self.assertFalse(self.path.exists())
        self.assertEqual(len(self.notices), 1)
    def test_checksum_failure_retains_original(self):
        self.fake.corrupt = True
        with self.assertRaises(RuntimeError):
            self.worker.transfer(self.path)
        self.assertTrue(self.path.exists())
    def test_retry_does_not_upload_duplicate(self):
        data = self.path.read_bytes()
        name = 'example--' + mod.digest(data)[:20] + '.gcode'
        self.fake.remote[name] = data
        self.assertTrue(self.worker.transfer(self.path))
        self.assertEqual(self.fake.uploads, 0)
    def test_reposted_name_does_not_overwrite_archive(self):
        self.worker.transfer(self.path)
        self.path.write_bytes(b'; a changed program\n')
        self.worker.transfer(self.path)
        self.assertEqual(len(self.fake.remote), 2)
        self.assertEqual(len(list(self.worker.sent.rglob('*.gcode'))), 2)

if __name__ == '__main__':
    unittest.main()
