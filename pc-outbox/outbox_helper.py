"""CNC Outbox v1. Standard-library-only verified Moonraker transfers."""
import argparse
import datetime as dt
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import pathlib
import socket
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

EXTENSIONS = {'.gcode', '.gco', '.gc', '.nc', '.ngc', '.tap'}
MAX_BYTES = 64 * 1024 * 1024

def digest(data):
    return hashlib.sha256(data).hexdigest()

class Client:
    def __init__(self, base, inbox='Inbox'):
        self.base = base.rstrip('/')
        self.inbox = inbox

    def request(self, path, data=None, headers=None):
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        with urllib.request.urlopen(req, timeout=30) as response:
            return response.read()

    def ensure_inbox(self):
        try:
            self.request('/server/files/directory', json.dumps({'path': 'gcodes/' + self.inbox}).encode(), {'Content-Type': 'application/json'})
        except urllib.error.HTTPError as error:
            # Existing directories may return a conflict. Confirm via listing.
            if error.code not in (400, 409):
                raise
            self.request('/server/files/directory?path=' + urllib.parse.quote('gcodes/' + self.inbox))

    def read(self, name):
        return self.request('/server/files/gcodes/' + urllib.parse.quote(self.inbox + '/' + name, safe='/'))

    def send(self, name, data):
        boundary = 'cnc-' + uuid.uuid4().hex
        parts = []
        for key, value in [('root', 'gcodes'), ('path', self.inbox)]:
            parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="' + key + '"\r\n\r\n' + value + '\r\n').encode())
        parts.append(('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + name + '"\r\nContent-Type: application/octet-stream\r\n\r\n').encode())
        parts.extend([data, ('\r\n--' + boundary + '--\r\n').encode()])
        response = json.loads(self.request('/server/files/upload', b''.join(parts), {'Content-Type': 'multipart/form-data; boundary=' + boundary}))
        if response.get('error'):
            raise RuntimeError(str(response['error']))

def notify(folder, title, message):
    """A short-lived Windows tray balloon; never blocks the transfer worker."""
    if __import__('os').name != 'nt':
        return
    script = pathlib.Path(__file__).with_name('notify.ps1')
    subprocess.Popen(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), title, message], creationflags=0x08000000, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def stamp(path):
    s = path.stat()
    return (s.st_size, s.st_mtime_ns)

class Worker:
    def __init__(self, folder, config, client=None, notification=notify):
        self.folder = folder
        self.config = config
        self.outbox = pathlib.Path(config['outbox'])
        self.sent = pathlib.Path(config['sent'])
        self.client = client or Client(config['server'], config.get('inbox', 'Inbox'))
        self.notification = notification
        self.observed = {}
        self.failure = False
        self.retry_at = 0
        self.failures = 0
        self.transferred = 0
        self.last = ''
        self.outbox.mkdir(parents=True, exist_ok=True)
        self.sent.mkdir(parents=True, exist_ok=True)

    def status(self, state, pending, error=''):
        payload = {'version': 1, 'updated': dt.datetime.now().astimezone().isoformat(), 'state': state, 'pending': pending, 'transferred_this_run': self.transferred, 'last_transfer': self.last, 'error': error, 'outbox': str(self.outbox), 'server': self.config['server']}
        temp = self.folder / 'status.tmp'
        temp.write_text(json.dumps(payload, indent=2), encoding='utf-8')
        temp.replace(self.folder / 'status.json')

    def transfer(self, path):
        before = stamp(path)
        if before[0] > MAX_BYTES:
            raise ValueError('File exceeds the v1 64 MiB limit: ' + path.name)
        data = path.read_bytes()
        if stamp(path) != before:
            return False
        sha = digest(data)
        # Content-addressed names avoid overwriting different versions and allow
        # retrying after an interrupted acknowledgement without duplicate uploads.
        safe = ''.join(c if c.isascii() and (c.isalnum() or c in '-_ .') else '_' for c in path.stem)[:90].strip(' .') or 'program'
        name = safe + '--' + sha[:20] + path.suffix.lower()
        self.client.ensure_inbox()
        try:
            remote = self.client.read(name)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            self.client.send(name, data)
            remote = self.client.read(name)
        if digest(remote) != sha:
            raise RuntimeError('Pi checksum mismatch; PC original retained: ' + path.name)
        if stamp(path) != before or digest(path.read_bytes()) != sha:
            return False
        destination = self.sent / dt.date.today().isoformat()
        destination.mkdir(parents=True, exist_ok=True)
        target = destination / (path.stem + '--' + dt.datetime.now().strftime('%H%M%S%f') + '--' + sha[:12] + path.suffix)
        path.rename(target)
        target.with_suffix(target.suffix + '.receipt.json').write_text(json.dumps({'source_name': path.name, 'pi_path': self.client.inbox + '/' + name, 'sha256': sha, 'verified_at': dt.datetime.now().astimezone().isoformat()}, indent=2), encoding='utf-8')
        self.last = path.name
        self.transferred += 1
        logging.info('Verified and archived %s -> %s', path.name, name)
        return True

    def tick(self, now=None):
        now = time.monotonic() if now is None else now
        files = sorted((p for p in self.outbox.iterdir() if p.is_file() and not p.is_symlink() and p.suffix.lower() in EXTENSIONS), key=lambda p: p.stat().st_mtime_ns)
        if not files:
            self.status('Watching Outbox', 0)
            return
        if now < self.retry_at:
            self.status('Waiting to retry', len(files), 'Pi unavailable or transfer failed; originals retained.')
            return
        for path in files:
            current = stamp(path)
            previous = self.observed.get(str(path))
            if previous is None or previous[0] != current:
                self.observed[str(path)] = (current, now)
                continue
            if now - previous[1] < self.config.get('settle_seconds', 10):
                continue
            try:
                self.status('Verifying transfer: ' + path.name, len(files))
                self.transfer(path)
                self.observed.pop(str(path), None)
                self.failure = False
                self.failures = 0
            except Exception as error:
                logging.exception('Transfer retained in Outbox: %s', path.name)
                self.status('Transfer waiting', len(files), str(error))
                offline = isinstance(error, (urllib.error.URLError, TimeoutError, ConnectionError)) and not isinstance(error, urllib.error.HTTPError)
                if offline and not self.failure:
                    self.notification(self.folder, 'CNC Outbox: Pi offline', path.name + ' is waiting. Files stay in Outbox and retry automatically.')
                self.failure = True
                self.failures += 1
                self.retry_at = now + min(60, 5 * 2 ** min(self.failures, 4))
                return
        self.status('Watching Outbox', sum(p.exists() for p in files))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', type=pathlib.Path, default=pathlib.Path(__file__).with_name('config.json'))
    args = parser.parse_args()
    folder = args.config.resolve().parent
    config = json.loads(args.config.read_text(encoding='utf-8-sig'))
    # Local-only singleton lock, automatically released on exit/crash.
    lock = socket.socket()
    try:
        lock.bind(('127.0.0.1', config.get('lock_port', 47831)))
    except OSError:
        return
    handler = RotatingFileHandler(folder / 'helper.log', maxBytes=1_000_000, backupCount=3, encoding='utf-8')
    logging.basicConfig(level=logging.INFO, handlers=[handler], format='%(asctime)s %(levelname)s %(message)s')
    worker = Worker(folder, config)
    logging.info('CNC Outbox helper started')
    while not (folder / 'STOP').exists():
        try:
            worker.tick()
        except Exception as error:
            logging.exception('Outbox scan failed')
            worker.status('Needs attention', 0, str(error))
        time.sleep(config.get('poll_seconds', 3))
    worker.status('Stopped', 0)

if __name__ == '__main__':
    main()
