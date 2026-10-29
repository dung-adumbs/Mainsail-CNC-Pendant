"""Fusion CNC Outbox command. Never runs G-code or calls a machine API."""
import adsk.core
import adsk.cam
import json
import pathlib
import traceback
import datetime
import uuid
import html
from .batch import plan, filename as batch_filename, with_metadata, finite, checksum
from .naming import unique_name

ROOT = pathlib.Path(__file__).parent
COMMAND = 'MainsailCncPostOutbox'
PANEL = 'MainsailCncOutboxPanel'
handlers = []
definition = None
menu_handler = None

def configuration():
    path = ROOT / 'config.json'
    config = json.loads(path.read_text(encoding='utf-8-sig'))
    return path, config

def expanded(items):
    result = []
    seen = set()
    for item in items:
        op = adsk.cam.Operation.cast(item)
        children = [op] if op else list(item.allOperations) if hasattr(item, 'allOperations') else []
        for child in children:
            if child.isSuppressed or child.operationId in seen:
                continue
            seen.add(child.operationId)
            result.append(child)
    return result

def parameter(op, name, default=''):
    p = op.parameters.itemByName(name)
    return p.value.value if p else default

def perform(items, memo=''):
    memo = str(memo).strip()
    if len(memo) > 200 or any(ord(c) < 32 for c in memo):
        raise ValueError('Use a one-line posting memo of at most 200 characters.')
    app = adsk.core.Application.get()
    ui = app.userInterface
    config_path, config = configuration()
    cam = adsk.cam.CAM.cast(app.activeDocument.products.itemByProductType('CAMProductType'))
    if not cam:
        raise ValueError('Open a Manufacture document first.')
    cam.checkValidity()
    operations = expanded(items)
    if not operations:
        raise ValueError('Select operations, one setup, or an NC Program before pressing Post to CNC Outbox.')
    setups = {op.parentSetup.operationId: op.parentSetup for op in operations}
    if len(setups) != 1:
        raise ValueError('Select operations from one setup only.')
    setup = next(iter(setups.values()))
    machine = setup.machine
    if not machine:
        raise ValueError('This setup has no machine assigned. Edit Setup > Machine > Select, choose your LowRider machine, then try again.')
    machine_id = machine.id
    identity = {'id': machine_id, 'vendor': machine.vendor, 'model': machine.model, 'description': machine.description}
    saved = config.get('machine')
    if not saved:
        text = 'Use this machine for CNC Outbox?\n\nVendor: ' + machine.vendor + '\nModel: ' + machine.model + '\nDescription: ' + machine.description + '\n\nChoose Yes only for your intended CNC. No files will be posted until the next review.'
        if ui.messageBox(text, 'Identify CNC machine', adsk.core.MessageBoxButtonTypes.YesNoButtonType) != adsk.core.DialogResults.DialogYes:
            return
        config['machine'] = identity
        config_path.write_text(json.dumps(config, indent=2), encoding='utf-8')
        saved = identity
    copies = config.get('machine_copies', [])
    if not machine_id:
        raise ValueError('The assigned machine has no identity. No post was created.')
    if identity != saved and identity not in copies:
        if any(identity[k] != saved.get(k) for k in ('vendor', 'model', 'description')):
            raise ValueError('The assigned machine differs from the registered CNC Outbox machine. Check Setup > Machine. No post was created.')
        review_copy = ('This setup uses a different Fusion machine ID with the same registered name/details.\n\n'
                       + machine.vendor + '\n' + machine.model + '\n' + machine.description
                       + '\n\nRegistered ID: ' + saved['id'] + '\nThis setup ID: ' + machine_id
                       + '\n\nRegister this document copy for CNC Outbox? Confirm only if this is the intended machine definition. No machine settings are changed.')
        if ui.messageBox(review_copy, 'Review machine document copy', adsk.core.MessageBoxButtonTypes.YesNoButtonType) != adsk.core.DialogResults.DialogYes:
            return
        config['machine_copies'] = copies + [identity]
        config_path.write_text(json.dumps(config, indent=2), encoding='utf-8')
    # Fusion's programmed order wins over the order in which items were clicked.
    selected = {op.operationId for op in operations}
    operations = [op for op in setup.allOperations if op.operationId in selected and not op.isSuppressed]
    rows = []
    for op in operations:
        if op.strategy == 'manual':
            rows.append({'op': op, 'name': op.name, 'manual': True})
            continue
        if not op.hasToolpath or not op.isToolpathValid or op.hasError:
            raise ValueError('Generate a valid, non-empty toolpath first: ' + op.name)
        tool = json.loads(op.tool.toJson())
        number = parameter(op, 'tool_number', None)
        if number is None:
            raise ValueError('Unable to read the tool number for ' + op.name)
        identity = {'number': number, 'description': tool.get('description', ''),
                    'type': tool.get('type', ''), 'geometry': tool.get('geometry', {})}
        # Fusion estimates, not controller predictions. Rapid assumption is disclosed.
        try:
            seconds = finite(cam.getMachiningTime(op, 100, 1000 / 600, 0).machiningTime)
        except Exception:
            seconds = None
        rows.append({'op': op, 'id': op.operationId, 'name': op.name,
                     'strategy': op.strategy, 'tool': identity,
                     'rpm': finite(parameter(op, 'tool_spindleSpeed', None)),
                     'feed_mm_min': finite(parameter(op, 'tool_feedCutting', 0)),
                     'seconds': seconds, 'warning': op.warning or ''})
    groups = plan(rows)
    outbox = pathlib.Path(config['outbox'])
    outbox.mkdir(parents=True, exist_ok=True)
    library = adsk.cam.CAMManager.get().libraryManager.postLibrary
    query = library.createQuery(adsk.cam.LibraryLocations.LocalLibraryLocation)
    query.vendor = 'Mainsail CNC Pendant'
    posts = [p for p in query.execute() if p.description == config['post_description']]
    if len(posts) != 1:
        raise ValueError('Expected one local Mainsail CNC Pendant post, found ' + str(len(posts)) + '.')
    batch_id = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S-%f') + '__' + uuid.uuid4().hex[:8]
    created = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for index, group in enumerate(groups, 1):
        group['filename'] = batch_filename(app.activeDocument.name, setup.name, group['tool']['number'], index, batch_id)
    review = 'Machine: ' + machine.model + '\nSetup: ' + setup.name + '\n\nFiles in programmed order:\n'
    for index, group in enumerate(groups, 1):
        review += '\n' + str(index) + '. T' + str(group['tool']['number']) + ' - ' + group['tool']['description'] + '\n'
        review += '\n'.join('   ' + row['name'] + (' [Fusion warning]' if row.get('warning') else '') for row in group['rows']) + '\n'
    review += '\nPost ' + str(len(groups)) + ' file(s) to CNC Outbox? Files transfer automatically; no job starts. Suppressed operations are excluded. Review CAM/simulation separately.'
    # The native command dialog already reviews the exact selection and memo.
    app.log(review)
    # Complete and verify every native post in an unwatched folder before publication.
    staging = outbox.parent / '.cnc-posting' / batch_id
    staging.mkdir(parents=True, exist_ok=False)
    manifest = {'schema': 1, 'id': batch_id, 'created': created, 'document': app.activeDocument.name,
                'setup': setup.name, 'memo': memo, 'machine': saved,
                'time_basis': {'source': 'Fusion CAM', 'feed_scale_percent': 100,
                               'rapid_mm_min': 1000, 'manual_tool_change_seconds': 0},
                'state': 'posting', 'files': []}
    record = staging / 'manifest.json'
    record.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    progress = ui.createProgressDialog()
    progress.show('Post to CNC Outbox', 'Posting file %v of %m', 0, len(groups), 0)
    try:
        prepared = []
        for index, group in enumerate(groups, 1):
            progress.progressValue = index - 1
            if progress.wasCancelled:
                raise RuntimeError('Batch cancelled. No files published; completed drafts are preserved in ' + str(staging))
            name = group['filename']
            nc = cam.ncPrograms.createInput()
            nc.displayName = name
            nc.operations = [row['op'] for row in group['rows']]
            for key, value in [('nc_program_filename', name), ('nc_program_name', name), ('nc_program_output_folder', staging.as_posix()), ('nc_program_openInEditor', False), ('nc_program_postToFusionTeam', False)]:
                p = nc.parameters.itemByName(key)
                if not p:
                    raise ValueError('Fusion NC parameter unavailable: ' + key)
                p.value.value = value
            program = cam.ncPrograms.add(nc)
            program.postConfiguration = posts[0]
            program.machine = machine
            if not program.postProcess(adsk.cam.NCProgramPostProcessOptions.create()):
                raise RuntimeError('Fusion posting failed at stage ' + str(index) + '. No batch published; inspect ' + str(staging))
            path = staging / (name + '.gcode')
            if not path.is_file() or not path.stat().st_size:
                raise RuntimeError('Expected G-code output is missing: ' + str(path))
            details = [{k: v for k, v in row.items() if k not in ('op', 'manual')} for row in group['rows'] if not row.get('manual')]
            summary = {'schema': 1, 'id': batch_id, 'document': app.activeDocument.name, 'setup': setup.name,
                       'memo': memo, 'created': created, 'stage': index, 'count': len(groups), 'time_basis': manifest['time_basis']}
            data = with_metadata(path.read_bytes(), summary, details)
            path.write_bytes(data)
            if len(data) > 64 * 1024 * 1024:
                raise ValueError('Stage exceeds the Outbox helper 64 MiB limit; no batch published.')
            expected = checksum(data)
            if checksum(path.read_bytes()) != expected:
                raise RuntimeError('Draft checksum mismatch; no files published.')
            prepared.append((path, expected))
            manifest['files'].append({'stage': index, 'filename': path.name, 'sha256': expected, 'operations': details})
        manifest['state'] = 'prepared'
        record.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        for path, expected in prepared:
            # Exclusive creation prevents overwriting an existing Outbox entry.
            with (outbox / path.name).open('xb') as target:
                target.write(path.read_bytes())
            if checksum((outbox / path.name).read_bytes()) != expected:
                raise RuntimeError('Outbox checksum mismatch. Drafts preserved; review this incomplete batch.')
        manifest['state'] = 'published'
        record.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    except Exception:
        manifest['state'] = 'incomplete; inspect preserved drafts and Outbox before retrying'
        record.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
        raise
    finally:
        progress.hide()
    ui.statusMessage = 'Posted ' + str(len(groups)) + ' ordered file(s) to CNC Outbox - transfer pending'
    app.log('CNC Outbox batch published: ' + batch_id)

class Execute(adsk.core.CommandEventHandler):
    def __init__(self, items):
        super().__init__()
        self.items = items
    def notify(self, args):
        try:
            perform(self.items, args.command.commandInputs.itemById('posting_memo').value)
        except Exception as error:
            app = adsk.core.Application.get()
            app.log(traceback.format_exc())
            app.userInterface.messageBox(str(error), 'CNC Outbox - not posted')

class Created(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            ui = adsk.core.Application.get().userInterface
            items = [ui.activeSelections.item(i).entity for i in range(ui.activeSelections.count)]
            # Saved NC Programs expose their own reviewed operation list.
            if len(items) == 1 and adsk.cam.NCProgram.cast(items[0]):
                items = list(adsk.cam.NCProgram.cast(items[0]).operations)
            ops = expanded(items)
            preview = 'Fusion file: ' + adsk.core.Application.get().activeDocument.name
            preview += '\nSetup: ' + (ops[0].parentSetup.name if ops else 'Select a setup or operations')
            preview += '\nPosted: ' + datetime.datetime.now().astimezone().strftime('%Y-%m-%d %H:%M:%S %Z')
            preview += '\n\nSelected operations (setup order):'
            if ops:
                ordered = [op for op in ops[0].parentSetup.allOperations if op.operationId in {o.operationId for o in ops} and not op.isSuppressed]
                for op in ordered:
                    preview += '\nT' + str(parameter(op, 'tool_number', '?')) + ' · ' + op.name
            preview += '\n\nEach tool change creates a stage. Transfer is automatic; no job starts.'
            args.command.setDialogInitialSize(520, 460)
            args.command.setDialogMinimumSize(420, 320)
            args.command.okButtonText = 'Post to CNC Outbox'
            posting = args.command.commandInputs.addTextBoxCommandInput('posting_preview', '', html.escape(preview).replace('\n', '<br>'), 16, True)
            posting.isFullWidth = True
            args.command.commandInputs.addStringValueInput('posting_memo', 'Memo (optional)', '')
            execute = Execute(items)
            args.command.execute.add(execute)
            handlers.append(execute)
            args.command.isExecutedWhenPreEmpted = False
        except Exception:
            adsk.core.Application.get().userInterface.messageBox(traceback.format_exc(), 'CNC Outbox')

class ContextMenu(adsk.core.MarkingMenuEventHandler):
    def notify(self, args):
        try:
            ui = adsk.core.Application.get().userInterface
            if not ui.activeWorkspace or ui.activeWorkspace.id != 'CAMEnvironment':
                return
            # Keep Fusion's existing menu; offer posting only for CAM selections.
            items = list(args.selectedEntities)
            if not items:
                items = [ui.activeSelections.item(i).entity for i in range(ui.activeSelections.count)]
            if not any(adsk.cam.Operation.cast(item) or adsk.cam.Setup.cast(item)
                       or adsk.cam.NCProgram.cast(item) for item in items):
                return
            controls = args.linearMarkingMenu.controls
            if not controls.itemById(COMMAND):
                anchor = ''
                for index in range(controls.count):
                    control = controls.item(index)
                    command = adsk.core.CommandControl.cast(control)
                    if command:
                        # Some native CAM controls reject commandDefinition access.
                        control_id = control.id
                        if 'postprocess' in control_id.casefold():
                            anchor = control.id
                            break
                controls.addCommand(definition, anchor, False)
        except Exception:
            adsk.core.Application.get().log(traceback.format_exc())


def run(context):
    global definition, menu_handler
    app = adsk.core.Application.get()
    ui = app.userInterface
    definition = ui.commandDefinitions.itemById(COMMAND) or ui.commandDefinitions.addButtonDefinition(COMMAND, 'Post to CNC Outbox', 'Post a setup or selected operations as ordered single-tool files, splitting at each tool change. Verified PC-to-Pi delivery.', str(ROOT / 'resources' / 'post'))
    created = Created()
    definition.commandCreated.add(created)
    handlers.append(created)
    workspace = ui.workspaces.itemById('CAMEnvironment')
    # Locate the native posting control rather than relying on a panel name.
    tab = workspace.toolbarTabs.itemById('MillingTab')
    panels = tab.toolbarPanels if tab else workspace.toolbarPanels
    old_panel = workspace.toolbarPanels.itemById(PANEL)
    if old_panel:
        old_panel.deleteMe()
    panel = next((panels.item(i) for i in range(panels.count)
                  if panels.item(i).controls.itemById('IronPostProcess')), None)
    if not panel:
        raise RuntimeError('Cannot locate the native Post Process control in Milling Actions.')
    control = panel.controls.itemById(COMMAND) or panel.controls.addCommand(definition, 'IronPostProcess', False)
    control.isPromoted = True
    control.isPromotedByDefault = True
    menu_handler = ContextMenu()
    ui.markingMenuDisplaying.add(menu_handler)
    handlers.append(menu_handler)

def stop(context):
    global menu_handler
    ui = adsk.core.Application.get().userInterface
    if menu_handler:
        ui.markingMenuDisplaying.remove(menu_handler)
        menu_handler = None
    workspace = ui.workspaces.itemById('CAMEnvironment')
    for i in range(workspace.toolbarPanels.count):
        control = workspace.toolbarPanels.item(i).controls.itemById(COMMAND)
        if control:
            control.deleteMe()
    panel = ui.workspaces.itemById('CAMEnvironment').toolbarPanels.itemById(PANEL)
    if panel:
        panel.deleteMe()
    command = ui.commandDefinitions.itemById(COMMAND)
    if command:
        command.deleteMe()
    handlers.clear()
