"""Conservative CNC motion reader. Geometry only; never executes G-code.
GPL-3.0-or-later. Unsupported syntax is recorded and prevents approval.
"""
from __future__ import annotations
import bisect, hashlib, json, math, re, time
from array import array
from dataclasses import dataclass, field
from pathlib import Path
NUMBER=r'[-+]?(?:\d+(?:\.\d*)?|\.\d+)'
WORDS=re.compile(r'([A-Za-z])\s*('+NUMBER+r')')
COMMAND=re.compile(r'^([A-Za-z_]+)(\d+(?:\.\d+)?)?(?=\s|[A-Za-z]|$)')
BOUNDS=re.compile(r'Operation\s+\d+\s+bounds\s+mm:\s*X\s*('+NUMBER+r')\.\.('+NUMBER+r')\s+Y\s*('+NUMBER+r')\.\.('+NUMBER+r')\s+Z\s*('+NUMBER+r')\.\.('+NUMBER+r')',re.I)
VERSION=1

def thumbnail_data_url(model):
    """Sampled top-view geometry for identification only, never verification."""
    import base64
    if model.issues:raise ValueError('Unsupported G-code: use the full viewer.')
    points=[];group=0;unknown=False
    for n,mask in enumerate(model.masks):
        if mask&3:
            if not unknown:group+=1
            unknown=True;continue
        unknown=False;x,y=model.coords[n*3:n*3+2]
        if not math.isfinite(x) or not math.isfinite(y):continue
        if not points or (x,y,group)!=points[-1]:points.append((x,y,group))
    if len(points)<2:raise ValueError('Not enough known XY motion for a preview.')
    xmin=min(p[0] for p in points);xmax=max(p[0] for p in points);ymin=min(p[1] for p in points);ymax=max(p[1] for p in points)
    spanx=xmax-xmin;spany=ymax-ymin
    if max(spanx,spany)<1e-8:raise ValueError('No XY path to display.')
    scale=min(292/max(spanx,.001),170/max(spany,.001));left=(320-spanx*scale)/2;top=(184-spany*scale)/2
    # Bound SVG size; preserve actual extents while sampling dense programs.
    count=len(points);indices={0,count-1}
    indices.update(round(i*(count-1)/min(count-1,2999)) for i in range(min(count,3000)))
    for axis in [0,1]:
        indices.add(min(range(count),key=lambda i:points[i][axis]));indices.add(max(range(count),key=lambda i:points[i][axis]))
    path=[];previous_group=None
    for index in sorted(indices):
        x,y,g=points[index];op='M' if previous_group!=g else 'L';previous_group=g
        path.append(f'{op}{left+(x-xmin)*scale:.2f},{top+(ymax-y)*scale:.2f}')
    svg=('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="210" viewBox="0 0 320 210">'
         '<rect width="320" height="210" fill="#171717"/>'
         '<path d="'+' '.join(path)+'" fill="none" stroke="#69c5ff" stroke-width=".65"/>'
         f'<text x="160" y="202" text-anchor="middle" font-family="sans-serif" font-size="11" fill="#ccc">X {spanx:.1f} × Y {spany:.1f} mm · sampled</text></svg>')
    return 'data:image/svg+xml;base64,'+base64.b64encode(svg.encode()).decode()
@dataclass
class Model:
    filename: str
    sha256: str=''
    body_sha256: str=''
    size: int=0
    modified_ns: int=0
    seconds: float=0.
    lines: int=0
    moves: int=0
    sections: list=field(default_factory=list)
    issues: list=field(default_factory=list)
    warnings: list=field(default_factory=list)
    metadata: dict=field(default_factory=dict)
    uses_arcs: bool=False
    loops: list=field(default_factory=list)
    runtime_macros: list=field(default_factory=list)
    offsets: array=field(default_factory=lambda:array('Q'))
    coords: array=field(default_factory=lambda:array('d'))
    masks: array=field(default_factory=lambda:array('B'))
    section_ids: array=field(default_factory=lambda:array('I'))
    def point(self,offset,position,mask,section):
        self.offsets.append(offset);self.coords.extend(position);self.masks.append(mask);self.section_ids.append(section)
    def issue(self,line,message):
        if len(self.issues)<50 and not any(x['message']==message for x in self.issues):self.issues.append({'line':line,'message':message})
    def remaining_bounds(self,initial_work,position=0,tool_section=True,anchor_work=None):
        # A loop still has future moves before the current file pointer.
        for loop in self.loops:
            if loop['start']<=position<loop['end']:position=min(position,loop['start'])
        begin=bisect.bisect_left(self.offsets,max(0,position))
        if begin>=len(self.offsets):return None
        if anchor_work is not None:
            initial_work=list(initial_work)
            for i in range(3):
                if self.masks[begin]&(1<<i):initial_work[i]=anchor_work[i]-self.coords[begin*3+i]
        section=self.section_ids[begin];lo=[math.inf]*3;hi=[-math.inf]*3;count=0
        for n in range(begin,len(self.offsets)):
            if tool_section and self.section_ids[n]!=section:break
            mask=self.masks[n];j=n*3
            for i in range(3):
                value=self.coords[j+i]+(initial_work[i] if mask&(1<<i) else 0.)
                lo[i]=min(lo[i],value);hi[i]=max(hi[i],value)
            count+=1
        return {'min':lo,'max':hi,'section':section,'label':self.sections[section]['label'],'points':count}
    def report(self):
        return {'schema':VERSION,'filename':self.filename,'sha256':self.sha256,'program_body_sha256':self.body_sha256,'size':self.size,'modified_ns':self.modified_ns,'scan_seconds':round(self.seconds,3),'lines':self.lines,'moves':self.moves,'sections':self.sections,'issues':self.issues,'warnings':self.warnings,'metadata':self.metadata,'loops':self.loops,'runtime_macros':self.runtime_macros}

def metadata_from_header(path):
    with Path(path).open('rb') as source:text=source.read(262144).decode('utf-8',errors='replace')
    boxes=[];claimed=None
    for line in text.splitlines():
        if not line.strip().startswith(';'):continue
        if line.lstrip().startswith('; CNC_BOUNDS_V1 '):
            try:
                value=json.loads(line.split('CNC_BOUNDS_V1 ',1)[1]);factor={'mm':1.,'cm':10.,'in':25.4}[value['units']]
                low=[float(x)*factor for x in value['min']];high=[float(x)*factor for x in value['max']]
                if len(low)==3 and len(high)==3 and all(math.isfinite(a) and math.isfinite(b) and a<=b for a,b in zip(low,high)):boxes.append((low,high));claimed=value.get('program_body_sha256')
            except (ValueError,KeyError,TypeError):pass
        match=BOUNDS.search(line)
        if match:
            values=list(map(float,match.groups()));boxes.append(([values[0],values[2],values[4]],[values[1],values[3],values[5]]))
    if not boxes:return {'available':False,'message':'No boundary metadata — full scan required.'}
    return {'available':True,'min':[min(x[0][i] for x in boxes) for i in range(3)],'max':[max(x[1][i] for x in boxes) for i in range(3)],'program_body_sha256':claimed,'message':'Preliminary header bounds only; full scan required.'}

def fingerprints(path):
    full=hashlib.sha256();body=hashlib.sha256();inside=False
    with Path(path).open('rb') as source:
        for raw in source:
            full.update(raw);line=raw.strip()
            if line==b'; CNC_PREFLIGHT_RECORD_BEGIN':inside=True;continue
            if line==b'; CNC_PREFLIGHT_RECORD_END':inside=False;continue
            if not inside:body.update(raw)
    return full.hexdigest(),body.hexdigest()

def scan_file(path,progress=None):
    path=Path(path);stat=path.stat();start=time.perf_counter();model=Model(path.name,size=stat.st_size,modified_ns=stat.st_mtime_ns);model.metadata=metadata_from_header(path)
    model.sections=[{'id':0,'label':'Program entry / tool 1','start':0,'end':stat.st_size,'tool_marker':False}]
    full=hashlib.sha256();body=hashlib.sha256();inside=False;offset=0;pos=[0.,0.,0.];mask=7;factor=1.;absolute=True;mode_known=False;plane=17;section=0;label='Tool section';loop_stack=[]
    with path.open('rb') as source:
        for raw in source:
            at=offset;offset+=len(raw);model.lines+=1;full.update(raw);stripped=raw.strip()
            if stripped==b'; CNC_PREFLIGHT_RECORD_BEGIN':inside=True;continue
            if stripped==b'; CNC_PREFLIGHT_RECORD_END':inside=False;continue
            if not inside:body.update(raw)
            if progress and model.lines%4096==0:progress(offset/stat.st_size if stat.st_size else 1.,model.lines)
            if stripped.startswith(b'; CNC_TOOL_BEGIN '):
                label=stripped.decode('utf-8',errors='replace')[17:].strip()[:180]
                if loop_stack:model.issue(model.lines,'Tool marker inside a loop is unsupported')
                # A comment cannot stop execution. Only an actual PAUSE_BASE
                # creates an independently approvable tool section.
                continue
            line=raw.decode('utf-8',errors='replace').strip();line=line.split(';',1)[0].strip()
            if not line:continue
            line=re.sub(r'\([^)]*\)','',line).strip()
            if not line:continue
            line=re.sub(r'^N\d+\s*','',line,flags=re.I)
            first=line.split(None,1)[0].upper()
            if first in ['START_JOB','END_JOB','LED_ON','LED_OFF','CNC_TEST_PREFLIGHT']:
                valid=(line.upper()==first) if first!='CNC_TEST_PREFLIGHT' else bool(re.fullmatch(r'CNC_TEST_PREFLIGHT\s+KIND=(?:CIRCLE|SQUARE)',line,re.I))
                if not valid:model.issue(model.lines,'Unsupported parameters on reviewed macro '+first)
                if first not in model.runtime_macros:model.runtime_macros.append(first)
                continue
            if first in ['RESPOND','M117']:
                tool=re.search(r'Tool:\s*(.*?)(?:Check work zero|Router|[\"]|$)',line,re.I)
                if tool:label=tool[1].strip(' .')[:180] or label
                continue
            if first=='PAUSE_BASE':
                if line.upper()!='PAUSE_BASE':model.issue(model.lines,'Parameters on PAUSE_BASE are unsupported')
                if loop_stack:model.issue(model.lines,'Pause/tool change inside a loop is unsupported')
                model.sections[section]['end']=at;section+=1;model.sections.append({'id':section,'label':label,'start':offset,'end':stat.st_size,'tool_marker':True});continue
            if first=='SDCARD_LOOP_BEGIN':
                count=re.fullmatch(r'SDCARD_LOOP_BEGIN\s+COUNT=(\d+)',line,re.I)
                if not count or mask or not absolute:model.issue(model.lines,'Loop needs fixed absolute XYZ entry and COUNT');continue
                loop_stack.append((at,pos[:],mask,factor,absolute,section));continue
            if first=='SDCARD_LOOP_END':
                if line.upper()!='SDCARD_LOOP_END' or not loop_stack:model.issue(model.lines,'Unmatched loop end');continue
                entry=loop_stack.pop()
                if mask!=entry[2] or factor!=entry[3] or absolute!=entry[4] or section!=entry[5] or any(abs(a-b)>1e-5 for a,b in zip(pos,entry[1])):model.issue(model.lines,'Loop must return to the same position and coordinate mode')
                model.loops.append({'start':entry[0],'end':offset});continue
            match=re.match(r'^([GM])(\d+(?:\.\d+)?)',line,re.I)
            if not match:model.issue(model.lines,'Unsupported command: '+first[:90]);continue
            prefix=match[1].upper();number=float(match[2]);rest=line[match.end():].strip();words=WORDS.findall(rest)
            residue=WORDS.sub('',rest).strip()
            if residue:model.issue(model.lines,'Unparsed parameters on '+match[0]);continue
            params={}
            for letter,value in words:
                letter=letter.upper()
                if letter in params:model.issue(model.lines,'Duplicate '+letter+' word')
                params[letter]=float(value)
            if any(not math.isfinite(x) for x in params.values()):model.issue(model.lines,'Non-finite parameter');continue
            if prefix=='M':
                if number in [220,400]:
                    allowed={'S'} if number==220 else set()
                    if set(params)-allowed:model.issue(model.lines,'Unsupported M parameter')
                    if number==220 and ('S' not in params or params['S']<=0):model.issue(model.lines,'Invalid M220 speed')
                else:model.issue(model.lines,'Unsupported M'+str(number))
                continue
            if number in [90,91,17,18,19,20,21]:
                if params:model.issue(model.lines,'Parameters on mode command')
                if number==90:absolute=True;mode_known=True
                elif number==91:absolute=False;mode_known=True
                elif number in [17,18,19]:plane=int(number)
                elif number==20:factor=25.4;model.issue(model.lines,'G20 is not native Klipper; post millimeter G-code')
                elif number==21:factor=1.
                continue
            if number==4:
                if set(params)-{'P','S'}:model.issue(model.lines,'Unsupported dwell parameters')
                continue
            if number not in [0,1,2,3]:model.issue(model.lines,'Unsupported G'+str(number));continue
            if not mode_known:model.issue(model.lines,'Set G90 or G91 before motion; inherited coordinate mode is unknown')
            if set(params)-set('XYZFIJKR'):model.issue(model.lines,'Unsupported axis or motion parameter');continue
            if 'F' in params and params['F']<=0:model.issue(model.lines,'Feed must be positive')
            target=pos[:];target_mask=mask
            for i,axis in enumerate('XYZ'):
                if axis in params:
                    if absolute:target[i]=params[axis]*factor;target_mask&=~(1<<i)
                    else:target[i]+=params[axis]*factor
            if number in [0,1] and not any(a in params for a in 'XYZ'):continue
            model.point(at,pos,mask,section)
            if number in [2,3]:
                model.uses_arcs=True;u,v,w,cu,cv={17:(0,1,2,'I','J'),18:(2,0,1,'K','I'),19:(1,2,0,'J','K')}[plane]
                if 'R' in params:model.issue(model.lines,'R-form arc unsupported by this verifier')
                elif mask or target_mask:model.issue(model.lines,'Arc start must have established XYZ coordinates')
                elif cu not in params and cv not in params:model.issue(model.lines,'Arc center is missing')
                else:
                    cx=pos[u]+params.get(cu,0)*factor;cy=pos[v]+params.get(cv,0)*factor
                    radius=math.hypot(pos[u]-cx,pos[v]-cy);end_radius=math.hypot(target[u]-cx,target[v]-cy)
                    if radius<1e-9 or abs(radius-end_radius)>max(.01,radius*.001):model.issue(model.lines,'Arc radius is inconsistent')
                    else:
                        a0=math.atan2(pos[v]-cy,pos[u]-cx);a1=math.atan2(target[v]-cy,target[u]-cx);sign=1 if number==3 else -1;sweep=((a1-a0)*sign)%(2*math.pi)
                        if sweep<1e-10:sweep=2*math.pi
                        for angle in [0.,math.pi/2,math.pi,math.pi*1.5]:
                            travel=((angle-a0)*sign)%(2*math.pi)
                            if travel<=sweep+1e-10:
                                point=pos[:];point[u]=cx+radius*math.cos(angle);point[v]=cy+radius*math.sin(angle);point[w]=pos[w]+(target[w]-pos[w])*(travel/sweep);model.point(at,point,mask,section)
            elif any(a in params for a in 'IJKR'):model.issue(model.lines,'Arc parameters on a linear move')
            model.point(at,target,target_mask,section);pos=target;mask=target_mask;model.moves+=1
    if loop_stack:model.issue(model.lines,'Unclosed loop')
    after=path.stat()
    if (stat.st_size,stat.st_mtime_ns,stat.st_ino)!=(after.st_size,after.st_mtime_ns,after.st_ino):raise ValueError('File changed during analysis; stage it again')
    model.sha256=full.hexdigest();model.body_sha256=body.hexdigest();model.seconds=time.perf_counter()-start
    if model.metadata.get('program_body_sha256') and model.metadata['program_body_sha256']!=model.body_sha256:model.warnings.append('Header content hash does not match the program; header is stale')
    if not model.moves:model.issue(0,'No supported motion found')
    return model

def evaluate_bounds(bounds,offset,minimum,maximum):
    if bounds is None:return {'fits':False,'reason':'No remaining motion could be verified','violations':[]}
    low=[a+b for a,b in zip(bounds['min'],offset)];high=[a+b for a,b in zip(bounds['max'],offset)];violations=[]
    for i,axis in enumerate('XYZ'):
        if low[i]<minimum[i]-1e-5:violations.append({'axis':axis,'side':'minimum','overflow_mm':minimum[i]-low[i],'message':f'{axis} exceeds lower travel by {minimum[i]-low[i]:.3f} mm'})
        if high[i]>maximum[i]+1e-5:violations.append({'axis':axis,'side':'maximum','overflow_mm':high[i]-maximum[i],'message':f'{axis} exceeds upper travel by {high[i]-maximum[i]:.3f} mm'})
    return {'fits':not violations,'work_min':bounds['min'],'work_max':bounds['max'],'machine_min':low,'machine_max':high,'violations':violations,'section':bounds['section'],'label':bounds['label']}
