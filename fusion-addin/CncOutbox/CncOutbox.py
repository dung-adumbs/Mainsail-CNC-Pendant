"""Fusion CNC Outbox command. Never runs G-code or calls a machine API."""
import adsk.core
import adsk.cam
import json
import pathlib
import traceback
from .naming import unique_name

ROOT = pathlib.Path(__file__).parent
COMMAND = 'MainsailCncPostOutbox'
PANEL = 'MainsailCncOutboxPanel'
handlers = []
definition = None

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

def perform(items):
    app = adsk.core.Application.get()
    ui = app.userInterface
    config_path, config = configuration()
    cam = adsk.cam.CAM.cast(app.activeDocument.products.itemByProductType('CAMProductType'))
    if not cam:
        raise ValueError('Open a Manufacture document first.')
    operations = expanded(items)
    if not operations:
        raise ValueError('Select the operations, a one-tool setup, or a saved NC Program before pressing Post to CNC Outbox.')
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
        ui.messageBox('Machine identified. Press Post to CNC Outbox again to review and post.', 'CNC Outbox')
        return
    if not machine_id or identity != saved:
        raise ValueError('The assigned machine differs from the registered CNC Outbox machine. Check Setup > Machine. No post was created.')
    machining = []
    tool_keys = set()
    for op in operations:
        if op.strategy == 'manual':
            continue
        if not op.hasToolpath or not op.isToolpathValid:
            raise ValueError('Generate a valid toolpath first: ' + op.name)
        number = parameter(op, 'tool_number', '?')
        if number == '?':
            raise ValueError('Unable to read tool number for ' + op.name + '. No post created.')
        description = parameter(op, 'tool_description', '')
        diameter = parameter(op, 'tool_diameter', '')
        tool_keys.add((str(number), str(description), str(diameter)))
        machining.append(op)
    if len(tool_keys) != 1 or not machining:
        raise ValueError('Select exactly one tool per post. Include its intended operations and Manual NC stops. Found ' + str(len(tool_keys)) + ' tool definitions.')
    number, description, diameter = next(iter(tool_keys))
    tool_label = 'T' + number + '_' + description
    filename = unique_name(app.activeDocument.name, setup.name, tool_label)
    outbox = pathlib.Path(config['outbox'])
    outbox.mkdir(parents=True, exist_ok=True)
    library = adsk.cam.CAMManager.get().libraryManager.postLibrary
    query = library.createQuery(adsk.cam.LibraryLocations.LocalLibraryLocation)
    query.vendor = 'Mainsail CNC Pendant'
    posts = [p for p in query.execute() if p.description == config['post_description']]
    if len(posts) != 1:
        raise ValueError('Expected one local Mainsail CNC Pendant post, found ' + str(len(posts)) + '. Check the local Post Library.')
    review = 'Machine: ' + machine.model + '\nSetup: ' + setup.name + '\nTool: T' + number + ' ' + description + '\n\nOperations in order:\n' + '\n'.join(str(i+1) + '. ' + op.name for i, op in enumerate(operations)) + '\n\nOutput: ' + str(outbox / (filename + '.gcode')) + '\n\nPost these operations? This uploads through Outbox but does not start machining.'
    if ui.messageBox(review, 'Review CNC post', adsk.core.MessageBoxButtonTypes.YesNoButtonType) != adsk.core.DialogResults.DialogYes:
        return
    nc = cam.ncPrograms.createInput()
    nc.displayName = filename
    nc.operations = operations
    for key, value in [('nc_program_filename', filename), ('nc_program_name', filename), ('nc_program_output_folder', outbox.as_posix()), ('nc_program_openInEditor', False), ('nc_program_postToFusionTeam', False)]:
        p = nc.parameters.itemByName(key)
        if not p:
            raise ValueError('Fusion NC parameter unavailable: ' + key)
        p.value.value = value
    program = cam.ncPrograms.add(nc)
    program.postConfiguration = posts[0]
    program.machine = machine
    if not program.postProcess(adsk.cam.NCProgramPostProcessOptions.create()):
        raise RuntimeError('Fusion did not complete posting. Review the post log. No machine start was requested.')
    ui.messageBox('Posted to Outbox. The background helper will verify and transfer it.\n\n' + filename + '.gcode', 'CNC Outbox')

class Execute(adsk.core.CommandEventHandler):
    def __init__(self, items):
        super().__init__()
        self.items = items
    def notify(self, args):
        try:
            perform(self.items)
        except Exception as error:
            app = adsk.core.Application.get()
            app.log(traceback.format_exc())
            app.userInterface.messageBox(str(error), 'CNC Outbox — not posted')

class Created(adsk.core.CommandCreatedEventHandler):
    def notify(self, args):
        try:
            ui = adsk.core.Application.get().userInterface
            items = [ui.activeSelections.item(i).entity for i in range(ui.activeSelections.count)]
            # Saved NC Programs expose their own reviewed operation list.
            if len(items) == 1 and adsk.cam.NCProgram.cast(items[0]):
                items = list(adsk.cam.NCProgram.cast(items[0]).operations)
            execute = Execute(items)
            args.command.execute.add(execute)
            handlers.append(execute)
            args.command.isExecutedWhenPreEmpted = False
        except Exception:
            adsk.core.Application.get().userInterface.messageBox(traceback.format_exc(), 'CNC Outbox')

def run(context):
    global definition
    app = adsk.core.Application.get()
    ui = app.userInterface
    definition = ui.commandDefinitions.itemById(COMMAND) or ui.commandDefinitions.addButtonDefinition(COMMAND, 'Post to CNC Outbox', 'Post selected one-tool operations with unique names and verified PC-to-Pi delivery.')
    created = Created()
    definition.commandCreated.add(created)
    handlers.append(created)
    workspace = ui.workspaces.itemById('CAMEnvironment')
    panel = workspace.toolbarPanels.itemById(PANEL) or workspace.toolbarPanels.add(PANEL, 'CNC Outbox')
    control = panel.controls.itemById(COMMAND) or panel.controls.addCommand(definition)
    control.isPromoted = True
    control.isPromotedByDefault = True

def stop(context):
    ui = adsk.core.Application.get().userInterface
    panel = ui.workspaces.itemById('CAMEnvironment').toolbarPanels.itemById(PANEL)
    if panel:
        panel.deleteMe()
    command = ui.commandDefinitions.itemById(COMMAND)
    if command:
        command.deleteMe()
    handlers.clear()
