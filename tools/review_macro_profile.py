#!/usr/bin/env python3
"""Record explicitly reviewed loaded macros; never command motion."""
import argparse, hashlib, json, pathlib, urllib.request
p=argparse.ArgumentParser()
p.add_argument('--url',default='http://127.0.0.1:7125')
p.add_argument('--output',type=pathlib.Path,default=pathlib.Path('~/printer_data/config/cnc_preflight_profile.json').expanduser())
p.add_argument('--write',action='store_true')
p.add_argument('--reviewed',action='store_true')
a=p.parse_args()
with urllib.request.urlopen(a.url.rstrip('/')+'/printer/objects/query?configfile',timeout=15) as r:
    config=json.load(r)['result']['status']['configfile']['config']
macros={k:hashlib.sha256(v['gcode'].encode()).hexdigest() for k,v in config.items() if k.startswith('gcode_macro ') and 'gcode' in v}
if not macros:raise SystemExit('No loaded macros found')
for name in sorted(macros):print(name)
if a.write:
    if not a.reviewed:raise SystemExit('Review actual definitions first, then explicitly add --reviewed')
    if a.output.exists():raise SystemExit('Profile exists: preserve and review it before replacing')
    a.output.parent.mkdir(parents=True,exist_ok=True)
    a.output.write_text(json.dumps({'macro_sha256':macros},indent=2),encoding='utf-8')
    print('Wrote',a.output)
else:print('Read only. Review definitions before --write --reviewed.')
