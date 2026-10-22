"""Versioned Fusion travel markers. Offline feed-only transform; no execution.

GPL-3.0-or-later. Version 1 deliberately supports only absolute millimeter
linear programs with explicit feeds, as emitted by the bundled simple post.
"""
from __future__ import annotations
import hashlib, math, re

HEADER='; CNC_PENDANT_OPTIMIZER: V1'
KINDS={'TRAVEL_XY','RETRACT_Z','POSITION_Z','CUT','PLUNGE','LINK','UNKNOWN'}
NUMBER=r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'
WORD=re.compile(r'([XYZF])\s*('+NUMBER+r')',re.I)
MAX_BYTES=64*1024*1024

def inspect_header(text):
    lines=text.splitlines()[:100]
    compatible=HEADER in lines
    clearance=None
    for line in lines:
        m=re.fullmatch(r'; CNC_TRAVEL_CLEARANCE_MM: ('+NUMBER+r')',line)
        if m:clearance=float(m[1])
    return {'compatible':compatible and clearance is not None and math.isfinite(clearance) and clearance>=1,
            'version':1 if compatible else None,'clearance_mm':clearance,
            'already_optimized':any(line.startswith('; CNC_OPTIMIZED:') for line in lines)}

def optimize_bytes(data,xy_feed,z_feed):
    for value,maximum in [(xy_feed,30000),(z_feed,3000)]:
        if isinstance(value,bool) or not isinstance(value,(int,float)) or not math.isfinite(value) or not 1<=value<=maximum:
            raise ValueError('XY travel must be 1–30000 and Z retract 1–3000 mm/min.')
    if len(data)>MAX_BYTES:raise ValueError('Travel optimization is limited to 64 MiB files.')
    text=data.decode('utf-8-sig',errors='strict');info=inspect_header(text)
    if not info['compatible']:raise ValueError('No supported CNC Pendant optimizer V1 header/clearance; repost with the marked Fusion post.')
    if info['already_optimized']:raise ValueError('Select the original marked file, not an optimized copy.')
    if text.splitlines().count(HEADER)!=1:raise ValueError('Duplicate optimizer headers.')
    clearance=info['clearance_mm'];pos={a:None for a in 'XYZ'};absolute=False;metric=False;pending=None
    changed=0;eligible=0;preserved=0;before=0.;after=0.;travel_distance=0.;unknown_time=False;output=[]
    for number,raw in enumerate(text.splitlines(),1):
        stripped=raw.strip()
        if stripped.startswith('; CNC_MOVE:'):
            if pending is not None:raise ValueError(f'Line {number}: marker without its immediately following move.')
            pending=stripped.removeprefix('; CNC_MOVE:').strip()
            if pending not in KINDS:raise ValueError(f'Line {number}: unsupported movement marker.')
            output.append(raw);continue
        code=raw.split(';',1)[0].strip()
        if not code:
            if pending is not None:raise ValueError(f'Line {number}: move must immediately follow its marker.')
            output.append(raw);continue
        motion=re.match(r'^G0?1(?=\s|[XYZF])',code,re.I)
        if motion:
            if not absolute or not metric:raise ValueError(f'Line {number}: explicit G90 and G21 required before motion.')
            if pending is None:raise ValueError(f'Line {number}: unmarked motion; cannot optimize this file.')
            rest=code[motion.end():];words=WORD.findall(rest)
            if WORD.sub('',rest).strip():raise ValueError(f'Line {number}: unsupported motion parameters.')
            values={}
            for key,value in words:
                key=key.upper()
                if key in values:raise ValueError(f'Line {number}: duplicate motion word.')
                values[key]=float(value)
            if not any(a in values for a in 'XYZ') or 'F' not in values or not all(math.isfinite(v) for v in values.values()) or values['F']<=0:
                raise ValueError(f'Line {number}: every move needs coordinates and an explicit positive feed.')
            target={a:values.get(a,pos[a]) for a in 'XYZ'};known=all(pos[a] is not None and target[a] is not None for a in 'XYZ')
            delta={a:(target[a]-pos[a] if target[a] is not None and pos[a] is not None else None) for a in 'XYZ'}
            feed=values['F'];new_feed=feed;kind=pending;pending=None
            if kind=='TRAVEL_XY':
                if target['Z'] is not None and pos['Z'] is not None and (abs(target['Z']-pos['Z'])>1e-7 or min(pos['Z'],target['Z'])<clearance):
                    raise ValueError(f'Line {number}: marked XY travel is not level above declared clearance.')
                if known:
                    eligible+=1;new_feed=xy_feed
            elif kind=='RETRACT_Z':
                if any(a in values and (delta[a] is None or abs(delta[a])>1e-7) for a in 'XY') or 'Z' not in values:
                    raise ValueError(f'Line {number}: marked retract must be vertical.')
                # Starting location is unknown until established; never speed that move up.
                if pos['Z'] is not None and target['Z']<pos['Z']-1e-7:raise ValueError(f'Line {number}: marked retract descends.')
                if known and target['Z']>pos['Z']:
                    eligible+=1;new_feed=z_feed
            if known:
                distance=math.sqrt(sum(delta[a]**2 for a in 'XYZ'));before+=distance/feed*60;after+=distance/new_feed*60
                if kind in ['TRAVEL_XY','RETRACT_Z']:travel_distance+=distance
            else:unknown_time=True
            if abs(feed-new_feed)>1e-7:
                # Replace only F. All coordinates, move order and comments remain unchanged.
                code=re.sub(r'(?i)(?<![A-Za-z])F\s*'+NUMBER,'F'+format(new_feed,'.3f').rstrip('0').rstrip('.'),code,count=1)
                suffix=(';'+raw.split(';',1)[1]) if ';' in raw else ''
                raw=code+(' '+suffix if suffix else '');changed+=1
            else:preserved+=1
            pos=target;output.append(raw);continue
        if pending is not None:raise ValueError(f'Line {number}: marker must immediately precede a G1 move.')
        upper=code.upper()
        if upper=='G90':absolute=True
        elif upper=='G21':metric=True
        elif upper=='PAUSE_BASE':pos={a:None for a in 'XYZ'}
        elif upper in ['M400','START_JOB','END_JOB','LED_ON','LED_OFF']:pass
        elif re.fullmatch(r'M220\s+S'+NUMBER,code,re.I):
            if float(code.upper().split('S')[1])<=0:raise ValueError('Invalid feed override.')
        elif re.fullmatch(r'G4\s+P'+NUMBER,code,re.I):pass
        elif upper.startswith('RESPOND ') or upper.startswith('M117 '):pass
        else:raise ValueError(f'Line {number}: unsupported command for travel optimization: {code[:60]}')
        output.append(raw)
    if pending is not None:raise ValueError('File ends with an unconsumed move marker.')
    if not eligible:raise ValueError('No eligible travel with established coordinates. Nothing to optimize.')
    source_hash=hashlib.sha256(data).hexdigest()
    provenance=[f'; CNC_OPTIMIZED: V1 SOURCE_SHA256={source_hash}',
                f'; CNC_OPTIMIZED_FEEDS_MM_MIN: XY={xy_feed:g} Z={z_feed:g}',
                '; CNC_ESTIMATES: original header time is stale; verify optimized copy before Start.']
    result=('\n'.join(provenance+output)+'\n').encode('utf-8')
    report={'source_sha256':source_hash,'output_sha256':hashlib.sha256(result).hexdigest(),'changed_moves':changed,
            'eligible_moves':eligible,'unchanged_moves':preserved,'travel_distance_mm':round(travel_distance,3),
            'nominal_before_seconds':round(before,2),'nominal_after_seconds':round(after,2),
            'estimate_excludes_unknown_initial_moves':unknown_time,'clearance_mm':clearance,'xy_feed':xy_feed,'z_feed':z_feed}
    return result,report
