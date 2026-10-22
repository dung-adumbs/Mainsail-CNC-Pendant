#!/usr/bin/env python3
"""Local preview installer: backs up first, never edits machine configuration.

GPL-3.0-or-later. No service restarts or motion commands are issued.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
BEGIN = '<!-- BEGIN Mainsail-CNC managed loader -->'
END = '<!-- END Mainsail-CNC managed loader -->'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.mainsail-cnc-tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)

def api(url, endpoint):
    with urllib.request.urlopen(url.rstrip('/') + endpoint, timeout=10) as response:
        value = json.load(response)
    if 'error' in value or 'result' not in value:
        raise RuntimeError('Moonraker request failed: ' + endpoint)
    return value['result']

def idle(url):
    state = api(url, '/printer/objects/query?webhooks&print_stats&pause_resume&idle_timeout')['status']
    if state.get('webhooks', {}).get('state') != 'ready':
        raise RuntimeError('Klipper must be Ready before installing or uninstalling.')
    if (state.get('print_stats', {}).get('state') in ('printing', 'paused')
            or state.get('pause_resume', {}).get('is_paused')
            or state.get('idle_timeout', {}).get('state') == 'Printing'):
        raise RuntimeError('Wait until there is no running/paused job or motion.')

def destination(path, root):
    candidate = root / path
    if candidate.is_symlink() or not candidate.resolve().is_relative_to(root):
        raise RuntimeError('Managed destination must not be a symlink or escape its root: ' + str(candidate))
    return candidate

def plan(args):
    mainsail = args.mainsail_dir.resolve()
    config = args.config_dir.resolve()
    if not mainsail.is_dir() or not config.is_dir():
        raise RuntimeError('Mainsail and config directories must already exist.')
    version = (mainsail / '.version').read_text().strip()
    if version.lstrip('v') != '2.17.0':
        raise RuntimeError('This preview has only been adapted to Mainsail 2.17.0; no files changed.')
    index = destination('index.html', mainsail)
    text = index.read_text()
    if BEGIN in text or 'lowrider-light-controls.js' in text or 'cnc-pendant-link.js' in text:
        raise RuntimeError('An existing CNC overlay is loaded; remove it using its own recovery path first.')
    if '</head>' not in text:
        raise RuntimeError('Could not find Mainsail loading-page insertion point.')
    loader = BEGIN + '\n<script defer src="/cnc-pendant-link.js?v=0.2-preview"></script>\n' + END + '\n'
    files = [(index, text.replace('</head>', loader + '</head>', 1).encode())]
    for name in ['cnc-pendant.html','cnc-pendant.css','cnc-pendant-core.js','cnc-pendant.js','cnc-pendant-settings.js','cnc-pendant-link.js','cnc-pendant-preflight.js']:
        files.append((destination(name,mainsail),(ROOT/'src'/name).read_bytes()))
    roots = {'mainsail': str(mainsail), 'config': str(config)}
    if args.recovery:
        if not args.klipper_dir or not (args.klipper_dir / 'klippy/extras').is_dir():
            raise RuntimeError('--recovery needs --klipper-dir pointing at an existing Klipper checkout.')
        klipper = args.klipper_dir.resolve()
        roots['klipper'] = str(klipper)
        files.append((destination('klippy/extras/cnc_force_jog.py', klipper), (ROOT / 'klipper/extras/cnc_force_jog.py').read_bytes()))
        files.append((destination('mainsail-cnc/forced-motion.cfg', config), b'# Optional Cartesian recovery; review before including.\n[cnc_force_jog]\n'))
    for path, _ in files:
        if path.exists() and not path.is_file():
            raise RuntimeError('A managed file path is not a regular file: ' + str(path))
    return roots, files

def install(args):
    roots, files = plan(args)
    print('Preview file plan:')
    for path, _ in files:
        print('  ' + str(path))
    print('Machine pins, limits, kinematics, macros, includes and services will NOT be changed.')
    print('Open /cnc-pendant.html only after reviewing the required controller macros in docs/SETUP.md.')
    if not args.apply:
        print('Dry run only. Read docs/SETUP.md before adding --apply.')
        return
    idle(args.moonraker_url)
    config = Path(roots['config'])
    backup_root = (args.backup_root or config.parent / 'config_backups/mainsail-cnc').resolve()
    for root in [ROOT] + [Path(value) for value in roots.values()]:
        if backup_root.is_relative_to(root):
            raise RuntimeError('Backups must be outside the source project and managed directories.')
    tag = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    backup = backup_root / tag
    backup.mkdir(parents=True, mode=0o700)
    # Keep full machine configuration locally, including secrets. Never upload this backup.
    shutil.copytree(config, backup / 'full-config', symlinks=False)
    manifest = {'format': 1, 'state': 'prepared', 'roots': roots, 'files': []}
    for number, (path, data) in enumerate(files):
        relative = 'originals/' + str(number)
        original = path.read_bytes() if path.exists() else None
        if original is not None:
            write(backup / relative, original)
        manifest['files'].append({'path': str(path), 'original': relative if original is not None else None,
                                  'original_sha256': sha(path), 'installed_sha256': hashlib.sha256(data).hexdigest()})
    # This settings export is a recovery reference only; installation never writes the database.
    try:
        settings = api(args.moonraker_url, '/server/database/item?namespace=mainsail')['value']
        write(backup / 'mainsail-settings.json', json.dumps(settings, indent=2).encode())
    except Exception as error:
        print('Settings export unavailable; database is not modified: ' + type(error).__name__)
    record = backup / 'manifest.json'
    write(record, json.dumps(manifest, indent=2).encode())
    touched = []
    try:
        for entry, (path, data) in zip(manifest['files'], files):
            # Recheck after backup; do not overwrite concurrent edits.
            if sha(path) != entry['original_sha256']:
                raise RuntimeError('Destination changed during installation: ' + str(path))
            touched.append(entry)
            write(path, data)
        manifest['state'] = 'installed'
    except Exception:
        for entry in reversed(touched):
            restore_one(entry, backup)
        manifest['state'] = 'rolled_back'
        write(record, json.dumps(manifest, indent=2).encode())
        raise
    write(record, json.dumps(manifest, indent=2).encode())
    print('Installed files. No controller restart was requested.')
    print('BACKUP: ' + str(backup))
    print('Uninstall: python3 tools/manage.py uninstall --backup ' + str(backup) + ' --apply')
    print('Next: follow docs/SETUP.md; review optional macro/include changes individually.')

def restore_one(entry, backup):
    target = Path(entry['path'])
    if entry['original'] is None:
        target.unlink(missing_ok=True)
    else:
        source = backup / entry['original']
        if sha(source) != entry['original_sha256']:
            raise RuntimeError('Original backup failed its integrity check: ' + str(source))
        write(target, source.read_bytes())

def uninstall(args):
    backup = args.backup.resolve()
    record = backup / 'manifest.json'
    manifest = json.loads(record.read_text())
    if manifest.get('format') != 1 or manifest.get('state') != 'installed':
        raise RuntimeError('Choose an intact backup whose manifest state is installed.')
    roots = [Path(value).resolve() for value in manifest['roots'].values()]
    conflicts = []
    for entry in manifest['files']:
        path = Path(entry['path'])
        if path.is_symlink() or not any(path.resolve().is_relative_to(root) for root in roots):
            raise RuntimeError('Unsafe recovery destination in manifest.')
        if entry['original']:
            original = (backup / entry['original']).resolve()
            if not original.is_relative_to(backup) or sha(original) != entry['original_sha256']:
                raise RuntimeError('Invalid or damaged original backup.')
        if sha(path) != entry['installed_sha256']:
            conflicts.append(str(path))
    if conflicts:
        raise RuntimeError('Later edits found; no files restored. Compare these with the backup manually:\n' + '\n'.join(conflicts))
    print('Restore only the files managed by this installation; keep unrelated/newer configuration.')
    if not args.apply:
        print('Dry run only. Add --apply after reading docs/RECOVERY.md.')
        return
    idle(args.moonraker_url)
    # Preflight all originals and conflicts before any restoration.
    for entry in reversed(manifest['files']):
        restore_one(entry, backup)
    manifest['state'] = 'uninstalled'
    write(record, json.dumps(manifest, indent=2).encode())
    print('Uninstalled. Full backup retained: ' + str(backup))
    print('Remove any manually added includes/macros using docs/RECOVERY.md before restarting Klipper.')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='action', required=True)
    for name in ('install', 'uninstall'):
        sub = subs.add_parser(name)
        sub.add_argument('--apply', action='store_true', help='Make the listed changes; omitted means dry run')
        sub.add_argument('--moonraker-url', default='http://127.0.0.1:7125')
        if name == 'install':
            sub.add_argument('--mainsail-dir', type=Path, required=True)
            sub.add_argument('--config-dir', type=Path, required=True)
            sub.add_argument('--klipper-dir', type=Path)
            sub.add_argument('--backup-root', type=Path)
            sub.add_argument('--recovery', action='store_true', help='Also stage the optional Cartesian recovery extension/config')
        else:
            sub.add_argument('--backup', type=Path, required=True)
    args = parser.parse_args()
    try:
        (install if args.action == 'install' else uninstall)(args)
    except Exception as error:
        print('STOP: ' + str(error), file=sys.stderr)
        return 1
    return 0

if __name__ == '__main__':
    sys.exit(main())
