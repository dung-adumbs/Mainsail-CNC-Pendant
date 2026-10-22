/** LowRider V4 / Klipper. Original minimal post, version 0.10.
 * One tool, one work origin, millimeters, manual router. No automatic zeroing.
 * PAUSE_BASE is the existing Klipper pause command renamed by mainsail.cfg.
 */
description = "Mainsail CNC Pendant - marked travel (manual router, mm, one tool)";
vendor = "Mainsail CNC Pendant";
vendorUrl = "https://github.com/dung-adumbs/Mainsail-CNC-Pendant";
legal = "Mainsail CNC Pendant contributors. GPL-3.0-or-later.";
extension = "gcode";
certificationLevel = 0;
minimumRevision = 45702;
capabilities = CAPABILITY_MILLING;
setCodePage("ascii");
tolerance = spatial(0.01, MM);
minimumChordLength = spatial(0.01, MM);
allowHelicalMoves = false;
allowedCircularPlanes = 0;

properties = {
  materialLabel: {title:"Material name (header note)", description:"Optional material description; Fusion may not export the assigned physical material.", type:"string", value:"Not supplied", scope:"post"},
  startSpeedFactor: {title:"Starting feed override (%)", description:"100 preserves Fusion feeds. Adjust with Mainsail while running.", type:"number", value:100, scope:"post"},
  travelFeed: {title:"Travel feed (mm/min)", description:"XY travel feed above the safe stock clearance plane.", type:"number", value:3000, scope:"post"},
  zTravelFeed: {title:"Z travel feed (mm/min)", type:"number", value:180, scope:"post"},
  fastClearanceZ: {title:"Travel clearance above stock top (mm)", description:"Offset above Fusion stock top. Set high enough to clear every fastener and clamp crossed by travel.", type:"number", value:5, scope:"post"},
  maxSegment: {title:"Maximum straight segment (mm)", type:"number", value:10, scope:"post"}
};
var xyz = createFormat({decimals:3});
var feedFormat = createFormat({decimals:1});
var firstTool;
var firstOffset;
var lastRPM;
var sectionTop;
var stockTop;
function travelPlane() {
  if (stockTop===undefined) {
    if (typeof hasGlobalParameter!="function" || !hasGlobalParameter("stock-upper-z")) { error("Fusion stock top is unavailable. Define setup stock before posting."); return NaN; }
    stockTop=Number(getGlobalParameter("stock-upper-z"));
    if (!isFinite(stockTop)) { error("Invalid Fusion stock top."); return NaN; }
  }
  return stockTop+getProperty("fastClearanceZ");
}
function stockComments() {
  comment("CNC_STOCK_TOP_WORK_Z_MM: "+xyz.format(stockTop));
  comment("CNC_TRAVEL_OFFSET_MM: "+xyz.format(getProperty("fastClearanceZ")));
  comment("CNC_TRAVEL_PLANE_WORK_Z_MM: "+xyz.format(travelPlane()));
  var values=[];
  for (var i=0;i<3;++i) { var axis="xyz".charAt(i),lo="stock-lower-"+axis,hi="stock-upper-"+axis;
    if (hasGlobalParameter(lo)&&hasGlobalParameter(hi)) values.push(axis.toUpperCase()+" "+xyz.format(getGlobalParameter(lo))+".."+xyz.format(getGlobalParameter(hi)));
  }
  if (values.length) comment("CNC_STOCK_BOUNDS_MM: "+values.join("; "));
  comment("CNC_MATERIAL: "+getProperty("materialLabel"));
  comment("CNC_TRAVEL_POLICY: Level XY at or above stock top + offset uses travel feed, regardless of CAM movement label. Offset must clear fixtures.");
}
var estimatedMotionSeconds=0;
function metadataDuration(seconds) {
  seconds=Math.ceil(seconds);
  return Math.floor(seconds/3600)+"h "+Math.floor(seconds%3600/60)+"m "+(seconds%60)+"s";
}

// Track emitted (rounded) coordinates rather than the CAM kernel position:
// startup positioning and retracts also pass through this function.
var moveKind="UNKNOWN";
function motionBlock(kind) {
  var previous=moveKind;moveKind=kind;
  try { block.apply(null,Array.prototype.slice.call(arguments,1)); } finally { moveKind=previous; }
}
var emittedPosition = {X:undefined, Y:undefined, Z:undefined};
function block() {
  var words=Array.prototype.slice.call(arguments);
  if (words[0] != "G1") { writeWords(words); return; }
  var end={}, axes=[], feedWord="", known=true, distance2=0;
  for (var i=1; i<words.length; ++i) {
    var word=String(words[i]);
    var axis=word.charAt(0);
    if (axis == "F") { feedWord=word; }
    if (axis == "X" || axis == "Y" || axis == "Z") {
      axes.push(axis);
      end[axis]=Number(word.substring(1));
      if (emittedPosition[axis] === undefined) { known=false; }
      else { distance2+=Math.pow(end[axis]-emittedPosition[axis],2); }
    }
  }
  // The controller's starting coordinates are unknown to an offline post.
  // Initial Z and initial XY positioning cannot be subdivided reliably.
  if (known && feedWord) {
    var nominalFeed=Number(feedWord.substring(1));
    if (nominalFeed>0) { estimatedMotionSeconds+=Math.sqrt(distance2)*60/nominalFeed; }
  }
  var count=known ? Math.max(1,Math.ceil(Math.sqrt(distance2)/(getProperty("maxSegment")-0.002))) : 1;
  for (var step=1; step<=count; ++step) {
    var line=["G1"];
    for (var a=0; a<axes.length; ++a) {
      var key=axes[a];
      var value=(step == count || !known) ? end[key] : emittedPosition[key]+(end[key]-emittedPosition[key])*step/count;
      line.push(key+xyz.format(value));
    }
    if (feedWord) { line.push(feedWord); }
    comment("CNC_MOVE: "+moveKind);
    writeWords(line);
  }
  for (var a=0; a<axes.length; ++a) { emittedPosition[axes[a]]=end[axes[a]]; }
}
function comment(s) { writeln("; " + String(s).replace(/[\r\n]/g," ")); }
function pauseHere(message, retainCoordinates) {
  block("M400");
  block('RESPOND MSG="' + message.replace(/["\r\n]/g," ") + '"');
  if (retainCoordinates) comment("CNC_PAUSE: SAME_TOOL_RETURN");
  block("PAUSE_BASE"); // Save position and pause WITHOUT the normal PAUSE parking move.
}
function move(x,y,z,f,kind) {
  if (!(f > 0) || !isFinite(f)) { error("Feed must be positive."); return; }
  motionBlock(kind||"CUT", "G1", "X"+xyz.format(x), "Y"+xyz.format(y), "Z"+xyz.format(z), "F"+feedFormat.format(f));
}
function onOpen() {
  var now=new Date();
  function pad(v) { return v<10 ? "0"+v : String(v); }
  var stamp=now.getUTCFullYear()+"-"+pad(now.getUTCMonth()+1)+"-"+pad(now.getUTCDate())+" at "+pad(now.getUTCHours())+":"+pad(now.getUTCMinutes())+":"+pad(now.getUTCSeconds());
  comment("generated by LowRider-Klipper-Post 0.10 on "+stamp);
  comment("CNC_PENDANT_OPTIMIZER: V1");
  comment("CNC_POST_VERSION: Mainsail-CNC-Pendant 0.10");
  comment("CNC_TRAVEL_CLEARANCE_MM: "+xyz.format(travelPlane()));
  stockComments();
  comment("CNC_OPTIMIZER_POLICY: optional feed-only copy; original remains runnable; explicit F on every move.");
  comment("Source: Autodesk Fusion CAM. CNC metadata; no extrusion or temperatures.");
  comment("Job: "+(typeof programName!="undefined" ? programName : "unnamed"));
  if (!(getProperty("startSpeedFactor") > 0) || getProperty("startSpeedFactor") > 300) {
    error("Starting feed override must be greater than zero and at most 300 percent."); return;
  }
  if (unit != MM) { error("Select millimeters in the NC Program."); return; }
  if (!isFinite(getProperty("maxSegment")) || getProperty("maxSegment") < 0.1) {
    error("Maximum segment must be at least 0.1 mm."); return;
  }
  if (!(getProperty("travelFeed") > 0) || !isFinite(getProperty("travelFeed")) || !(getProperty("zTravelFeed") > 0) || !isFinite(getProperty("zTravelFeed"))) {
    error("Travel feeds must be positive."); return;
  }
  if (!isFinite(getProperty("fastClearanceZ")) || getProperty("fastClearanceZ") < 1) { error("Travel clearance offset must be at least 1 mm above stock top."); return; }
  // Validate the entire job before writing any motion.
  for (var i=0; i<getNumberOfSections(); ++i) {
    var s=getSection(i);
    if (s.type != TYPE_MILLING || s.isMultiAxis() || !isSameDirection(s.workPlane.forward,new Vector(0,0,1))) {
      error("Only three-axis milling with tool axis +Z is supported."); return;
    }
    if (i == 0) { firstTool=s.getTool().number; firstOffset=s.workOffset; }
    if (s.getTool().number != firstTool || (i > 0 && s.getForceToolChange())) {
      error("One tool per file. Post tool changes as separate programs and re-zero Z."); return;
    }
    if (s.workOffset != firstOffset || s.workOffset > 1) {
      error("One work origin only. This post uses the current Klipper work coordinates, not G54-G59."); return;
    }
    if (!s.getTool().clockwise) { error("This manual-router post requires clockwise spindle direction."); return; }
  }
  comment("LowRider Klipper Simple v0.10 - maximum segment " + getProperty("maxSegment") + " mm");
  comment("Initial positioning from unknown machine location is not segmented.");
  comment("Preserves existing work zero. Router ON/OFF is MANUAL.");
  comment("CAM-identified rapid XY travel at/above Z"+travelPlane()+" uses "+getProperty("travelFeed")+" mm/min. Plane is Fusion stock top plus clearance offset; clamps must clear travel.");
  comment("Requires Mainsail PAUSE_BASE and RESUME. No automatic homing or probing.");
  for (var j=0; j<getNumberOfSections(); ++j) {
    var sec=getSection(j);
    var xr=sec.getGlobalRange(new Vector(1,0,0));
    var yr=sec.getGlobalRange(new Vector(0,1,0));
    var zr=sec.getGlobalZRange();
    comment("Operation "+(j+1)+" bounds mm: X "+xyz.format(xr.getMinimum())+".."+xyz.format(xr.getMaximum())+
      " Y "+xyz.format(yr.getMinimum())+".."+xyz.format(yr.getMaximum())+
      " Z "+xyz.format(zr.getMinimum())+".."+xyz.format(Math.max(zr.getMaximum(),travelPlane())));
  }
  block("G90");
  block("G21");
  block("M220", "S"+feedFormat.format(getProperty("startSpeedFactor")));
}
function onSection() {
  setRotation(currentSection.workPlane);
  sectionTop=currentSection.getGlobalZRange().getMaximum();
  var p=getFramePosition(currentSection.getInitialPosition());
  if (lastRPM !== spindleSpeed) {
    pauseHere("Tool: "+tool.description+". Check work zero and clearance. Router "+spindleSpeed+" RPM. Set dial using RPM table, turn ON, then Resume.");
    lastRPM=spindleSpeed;
  }
  comment(getParameter("operation-comment","Milling"));
  comment("CNC_OPERATION: "+getParameter("operation-comment","Milling"));
  stockComments();
  comment("CNC_OPERATION_Z_RANGE_MM: "+xyz.format(currentSection.getGlobalZRange().getMinimum())+".."+xyz.format(sectionTop));
  comment("Tool "+tool.number+": "+tool.description+"; diameter "+xyz.format(tool.diameter)+" mm; router "+spindleSpeed+" RPM");
  // Retract before XY. Never lower an already higher tool just to traverse.
  var safeTop=Math.max(sectionTop,travelPlane());
  if (!isFinite(emittedPosition.Z) || emittedPosition.Z<safeTop) {
    motionBlock("RETRACT_Z","G1","Z"+xyz.format(safeTop),"F"+feedFormat.format(getProperty("zTravelFeed")));
  }
  motionBlock("TRAVEL_XY","G1","X"+xyz.format(p.x),"Y"+xyz.format(p.y),"F"+feedFormat.format(getProperty("travelFeed")));
  motionBlock("POSITION_Z","G1","Z"+xyz.format(p.z),"F"+feedFormat.format(getProperty("zTravelFeed")));
}
function onRapid(x,y,z) {
  var p={X:emittedPosition.X,Y:emittedPosition.Y,Z:emittedPosition.Z};
  if (isFinite(p.Z) && z>p.Z) { motionBlock("RETRACT_Z","G1","Z"+xyz.format(z),"F"+feedFormat.format(getProperty("zTravelFeed"))); }
  if (xyz.areDifferent(x,p.X) || xyz.areDifferent(y,p.Y)) {
    var level=emittedPosition.Z>=travelPlane();
    var travel=level?getProperty("travelFeed"):Math.min(getProperty("travelFeed"),getProperty("zTravelFeed"));
    motionBlock(level?"TRAVEL_XY":"LINK","G1","X"+xyz.format(x),"Y"+xyz.format(y),"F"+feedFormat.format(travel));
  }
  if (!isFinite(p.Z) || z<p.Z) { motionBlock("POSITION_Z","G1","Z"+xyz.format(z),"F"+feedFormat.format(getProperty("zTravelFeed"))); }
}
var camMovement;
function onMovement(value) {
  camMovement=value;
  var name=value==MOVEMENT_RAPID?"RAPID":(typeof MOVEMENT_LINK_DIRECT!="undefined"&&value==MOVEMENT_LINK_DIRECT)?"LINK_DIRECT":"OTHER";
  comment("CNC_CAM_MOVEMENT: "+value+" "+name);
}
function splitPureZ(z,feed) {
  var start=emittedPosition.Z,plane=travelPlane(),boundary=z>start?stockTop:plane;
  if (Math.abs(z-start)<0.0005) return false;
  var upward=z>start;
  if ((upward&&start<boundary&&z>boundary)||(!upward&&start>boundary&&z<boundary)) {
    var firstFast=upward?false:true;
    motionBlock(firstFast?"TRAVEL_Z":"CUT","G1","Z"+xyz.format(boundary),"F"+feedFormat.format(firstFast?getProperty("zTravelFeed"):feed));
    motionBlock(upward?"TRAVEL_Z":"PLUNGE","G1","Z"+xyz.format(z),"F"+feedFormat.format(upward?getProperty("zTravelFeed"):feed));
  } else {
    var fast=upward?start>=stockTop:z>=plane;
    motionBlock(fast?"TRAVEL_Z":upward?"CUT":"PLUNGE","G1","Z"+xyz.format(z),"F"+feedFormat.format(fast?getProperty("zTravelFeed"):feed));
  }
  return true;
}
function onLinear(x,y,z,feed) {
  var activeMovement=camMovement!==undefined?camMovement:(typeof movement!="undefined"?movement:undefined);
  var p=emittedPosition,safe=travelPlane();
  var known=isFinite(p.X)&&isFinite(p.Y)&&isFinite(p.Z);
  var level=known&&Math.abs(z-p.Z)<0.0005;
  var xy=known&&(xyz.areDifferent(x,p.X)||xyz.areDifferent(y,p.Y));
  var rapid=(activeMovement!==undefined && activeMovement==MOVEMENT_RAPID);
  var directLink=(activeMovement!==undefined && typeof MOVEMENT_LINK_DIRECT!="undefined" && activeMovement==MOVEMENT_LINK_DIRECT);
  if (known&&!xy&&splitPureZ(z,feed)) return;
  var kind=(known&&z<p.Z&&!xy)?"PLUNGE":"CUT";
  // The user-declared plane above the entire stock and fixtures is authoritative.
  // Only level XY motion qualifies; no descending, ramping or helical shortcuts.
  if (level&&xy&&p.Z>=safe&&z>=safe) { kind="TRAVEL_XY";feed=getProperty("travelFeed"); }
  else if (rapid&&known&&!xy&&z>p.Z) { kind="RETRACT_Z";feed=getProperty("zTravelFeed"); }
  else if (rapid||directLink) { kind="LINK"; }
  move(x,y,z,feed,kind);
}
function onCircular(clockwise,cx,cy,cz,x,y,z,feed) { linearize(tolerance); }
function onCyclePoint(x,y,z) { expandCyclePoint(x,y,z); }
function onCycleEnd() {}
function onDwell(seconds) { estimatedMotionSeconds+=seconds; block("G4","P"+Math.round(seconds*1000)); }
function onRadiusCompensation() {
  if (radiusCompensation != RADIUS_COMPENSATION_OFF) { error("Use In computer compensation in Fusion."); }
}
function onSpindleSpeed(rpm) {
  if (rpm != lastRPM) { pauseHere("Set router to "+rpm+" RPM, then Resume."); lastRPM=rpm; }
}
function onCommand(command) {
  switch(command) {
  case COMMAND_STOP:
  case COMMAND_OPTIONAL_STOP:
    pauseHere("Same-tool stop. Install fasteners or inspect; preserve work zero, then Resume.", true); return;
  case COMMAND_START_SPINDLE:
  case COMMAND_SPINDLE_CLOCKWISE:
  case COMMAND_STOP_SPINDLE:
  case COMMAND_COOLANT_ON:
  case COMMAND_COOLANT_OFF:
  case COMMAND_LOCK_MULTI_AXIS:
  case COMMAND_UNLOCK_MULTI_AXIS:
  case COMMAND_BREAK_CONTROL:
    return; // Manual router; no coolant or auxiliary hardware is controlled.
  default:
    error("Unsupported command: "+getCommandStringId(command));
  }
}
function onRapid5D() { error("Multi-axis motion is unsupported."); }
function onLinear5D() { error("Multi-axis motion is unsupported."); }
function onSectionEnd() {
  var safeTop=Math.max(sectionTop,travelPlane());
  if (emittedPosition.Z<safeTop) motionBlock("RETRACT_Z","G1","Z"+xyz.format(safeTop),"F"+feedFormat.format(getProperty("zTravelFeed")));
}
function onClose() {
  comment("estimated printing time (normal mode) = "+metadataDuration(estimatedMotionSeconds));
  comment("CNC runtime estimate: nominal posted feeds at 100 percent; excludes pauses, unknown initial-position moves, acceleration and controller limits.");
  comment("CNC estimated motion seconds = "+Math.ceil(estimatedMotionSeconds));
  block("M400");
  block('RESPOND MSG="Job complete. Turn router OFF manually."');
  block("M117 Job complete - router OFF");
}
function onComment(message) { comment(message); }
