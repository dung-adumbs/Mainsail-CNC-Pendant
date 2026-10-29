/* Strict rollup of reviewed Mainsail CNC post 0.12 sources. No execution. */
(() => {
 'use strict';
 const completion='RESPOND MSG="Job complete. Turn router OFF manually."';
 const clean=s=>String(s).replace(/[\r\n\x00-\x1f]/g,' ').slice(0,220);
 function compile(project,sources,sha256){
  if(!project.reviewed_order||!Array.isArray(project.stages)||!project.stages.length||project.stages.length>24)throw Error('Save and review a project with 1–24 stages first.');
  if(sources.length!==project.stages.length)throw Error('Source count differs from the saved project.');
  const batchMeta=sources.map(source=>{const text=new TextDecoder().decode(source.bytes.subarray(0,8192)),match=text.match(/^; CNC_BATCH_V1:\s*(.*)$/m);return match?JSON.parse(match[1]):null;});
  if(batchMeta.some(Boolean)){const first=batchMeta[0];if(!first||batchMeta.some((b,i)=>!b||b.id!==first.id||b.setup!==first.setup||b.document!==first.document||b.count!==sources.length||b.stage!==i+1))throw Error('Preserve the complete Fusion batch in its posted stage order. Change selection/order in Fusion and repost.');}
  const seen=new Set(),parts=[],provenance=[],bounds=[],reference={};let moves=0,pauses=0,seconds=0,operations=0;
  for(let index=0;index<sources.length;index++){
   const stage=project.stages[index],source=sources[index];if(source.path!==stage.path||seen.has(stage.path))throw Error('Source order or duplicate source differs from the reviewed project.');seen.add(stage.path);
   const hash=sha256(source.bytes);if(hash!==stage.sha256)throw Error('Source changed: '+stage.path);
   const text=new TextDecoder('utf-8',{fatal:true}).decode(source.bytes),lines=text.split(/\r?\n/);
   if(text.includes('; CNC_ROLLUP_VERSION:')||text.includes('; CNC_OPTIMIZED:'))throw Error('Use original one-tool posts, not prior rollups or optimized copies.');
   const values=key=>[...new Set([...text.matchAll(new RegExp('^; '+key+':\\s*(.*)$','gm'))].map(m=>m[1].trim()))];
   const one=key=>{const list=values(key);if(list.length!==1||!list[0]||/not (?:assigned|supplied)/i.test(list[0]))throw Error('Missing or inconsistent '+key+' in '+stage.path);return list[0];};
   if(one('CNC_POST_VERSION')!=='Mainsail-CNC-Pendant 0.12')throw Error('Rollup currently supports the original CNC Pendant post 0.12 only.');
   const job=one('Job'),document=job.split('__')[0];if(!job.includes('__'))throw Error('Source document identity is missing.');
   const setup=one('CNC_FUSION_SETUP'),machine=['CNC_MACHINE_VENDOR','CNC_MACHINE_MODEL','CNC_MACHINE_DESCRIPTION'].map(one).join(' | ');
   for(const [key,value] of Object.entries({document,machine,top:one('CNC_STOCK_TOP_WORK_Z_MM'),plane:one('CNC_TRAVEL_PLANE_WORK_Z_MM'),offset:one('CNC_TRAVEL_OFFSET_MM'),clearance:one('CNC_TRAVEL_CLEARANCE_MM')})){
    if(index===0)reference[key]=value;else if(reference[key]!==value)throw Error('Stages differ in '+key+'. Review/repost before combining.');
   }
   if(![reference.top,reference.plane,reference.offset,reference.clearance].every(v=>Number.isFinite(Number(v)))||Number(reference.plane)!==Number(reference.clearance)||Math.abs(Number(reference.top)+Number(reference.offset)-Number(reference.plane))>1e-6||Number(reference.offset)<1)throw Error('Invalid stock-relative travel declaration.');
   const tools=[...new Set([...text.matchAll(/^; Tool (\d+):\s*(.*)$/gm)].map(m=>m[1]+': '+m[2].trim()))];if(tools.length!==1)throw Error('Every source must identify exactly one tool.');
   const ops=[...text.matchAll(/^; CNC_OPERATION:\s*(.*)$/gm)].map(m=>m[1].trim());if(!ops.length)throw Error('Operation metadata is missing.');operations+=ops.length;
   let sourceBounds=0;for(const match of text.matchAll(/^; Operation \d+ bounds mm: X ([-+\d.e]+)\.\.([-+\d.e]+) Y ([-+\d.e]+)\.\.([-+\d.e]+) Z ([-+\d.e]+)\.\.([-+\d.e]+)/gm)){
    const b=match.slice(1).map(Number);if(!b.every(Number.isFinite)||b[0]>b[1]||b[2]>b[3]||b[4]>b[5])throw Error('Invalid declared operation bounds.');bounds.push(b);sourceBounds++;
   }if(!sourceBounds)throw Error('Operation bounds are missing.');
   const time=text.match(/^; CNC estimated motion seconds = (\d+)/m);if(time)seconds+=Number(time[1]);
   const active=lines.map(line=>line.trim()).filter(line=>line&&!line.startsWith(';'));
   if(active[0]!=='G90'||active[1]!=='G21'||active[2]!=='M220 S100')throw Error('Unexpected source startup; repost with the canonical post.');
   if(active.slice(-3).join('\n')!==['M400',completion,'M117 Job complete - router OFF'].join('\n'))throw Error('Unexpected source ending; preserve and review it separately.');
   let gotPause=false,sourceMoves=0,lastZ=null;for(const line of active){
    if(line==='PAUSE_BASE'){gotPause=true;pauses++;continue;}
    if(/^G1\s/.test(line)){
     if(!gotPause)throw Error('Motion before the source tool-check pause.');
     if(!/^G1(?:\s+[XYZF][-+]?(?:\d+(?:\.\d*)?|\.\d+))+\s*$/.test(line)||!/(?:^|\s)F(?:\d+(?:\.\d*)?|\.\d+)(?:\s|$)/.test(line))throw Error('Unsupported source move.');
     const words=[...line.matchAll(/([XYZF])([-+\d.]+)/g)],letters=words.map(m=>m[1]);if(new Set(letters).size!==letters.length||!words.some(m=>'XYZ'.includes(m[1]))||words.some(m=>!Number.isFinite(Number(m[2]))||m[1]==='F'&&Number(m[2])<=0))throw Error('Invalid source motion words.');
     const z=words.find(m=>m[1]==='Z');if(z)lastZ=Number(z[2]);sourceMoves++;continue;
    }
    if(['G90','G21','M220 S100','M400','M117 Job complete - router OFF'].includes(line)||/^RESPOND MSG="[^"\r\n]*"$/.test(line)||/^G4 P\d+(?:\.\d+)?$/.test(line))continue;
    throw Error('Unsupported source command: '+line.slice(0,70));
   }
   if(!sourceMoves||lastZ===null||lastZ<Number(reference.plane)-1e-6)throw Error('Source does not finish retracted to its declared travel plane.');moves+=sourceMoves;
   let entry=false;const body=[];
   for(const raw of lines){const line=raw.trim();
    if(!line||line==='; CNC_PENDANT_OPTIMIZER: V1'||/^; (?:estimated printing time|CNC runtime estimate|CNC estimated motion seconds)/.test(line))continue;
    if(index>0&&line==='M220 S100')continue;
    if(index<sources.length-1&&(line===completion||line==='M117 Job complete - router OFF'))continue;
    if(!entry&&/^RESPOND MSG="Tool:/.test(line)){body.push(line.replace('MSG="','MSG="Stage '+(index+1)+'/'+sources.length+'. Router OFF before tool work; set tool Z if changed. '));entry=true;}else body.push(raw);
   }
   if(!entry)throw Error('Canonical tool-check message missing.');
   parts.push('; CNC_PROJECT_STAGE: '+(index+1)+'/'+sources.length+' '+clean(setup)+'\n; CNC_TOOL_BEGIN Stage '+(index+1)+' '+clean(tools[0])+'\n'+body.join('\n'));
   provenance.push({stage:index+1,path:stage.path,sha256:hash,bytes:source.bytes.length,setup,tool:tools[0],operations:ops,moves:sourceMoves});
  }
  const header=['; CNC_ROLLUP_VERSION: 1','; CNC_PENDANT_OPTIMIZER: V1','; CNC_STOCK_TOP_WORK_Z_MM: '+reference.top,'; CNC_TRAVEL_OFFSET_MM: '+reference.offset,'; CNC_TRAVEL_CLEARANCE_MM: '+reference.clearance,'; CNC_PROJECT_NAME: '+clean(project.name),'; CNC_POSTING_MEMO: '+clean(project.memo||''),'; CNC_PROJECT_ID: '+clean(project.id),'; CNC_PROJECT_REVISION: '+clean(project.updated),'; CNC_ROLLUP_POLICY: source order and motion retained; stage entry pauses retained; one shared XY origin and stock-top Z reference required.',...provenance.map(p=>'; CNC_ROLLUP_SOURCE: '+p.stage+' SHA256='+p.sha256+' '+clean(p.path)),...bounds.map((b,i)=>'; Operation '+(i+1)+' bounds mm: X '+b[0]+'..'+b[1]+' Y '+b[2]+'..'+b[3]+' Z '+b[4]+'..'+b[5]),'; CNC estimated motion seconds = '+seconds,'; estimated printing time (normal mode) = '+Math.floor(seconds/3600)+'h '+Math.floor(seconds%3600/60)+'m '+seconds%60+'s','; CNC runtime estimate: nominal source sum; excludes pauses, acceleration, unknown initial positioning and controller limits.'];
  const bytes=new TextEncoder().encode(header.join('\n')+'\n'+parts.join('\n')+'\n');if(bytes.length>64*1024*1024)throw Error('Combined file exceeds the 64 MiB limit.');
  return {bytes,sha256:sha256(bytes),sources:provenance,stage_count:sources.length,moves,pauses,operations,nominal_seconds:seconds};
 }
 const api={compile};if(typeof module!=='undefined'&&module.exports)module.exports=api;else window.CncRollup=api;
})();
