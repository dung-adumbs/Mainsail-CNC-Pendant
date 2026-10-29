"""Exercise menu integration without Fusion or machine access."""
import ast
import pathlib
import types
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'fusion-addin/CncOutbox/CncOutbox.py'

class MenuTests(unittest.TestCase):
    def invoke(self, names, workspace='CAMEnvironment'):
        controls = types.SimpleNamespace()
        controls.items = [types.SimpleNamespace(id=('IronPostProcess' if n.startswith('Post Process') else 'id'+str(i)), commandDefinition=types.SimpleNamespace(name=n)) for i,n in enumerate(names)]
        controls.count = len(controls.items)
        controls.item = lambda i: controls.items[i]
        controls.itemById = lambda key: next((c for c in controls.items if c.id == key), None)
        controls.addCommand = lambda *args: calls.append(args)
        calls = []
        ui = types.SimpleNamespace(activeWorkspace=types.SimpleNamespace(id=workspace))
        app = types.SimpleNamespace(userInterface=ui, log=lambda msg: self.fail(msg))
        cast = types.SimpleNamespace(cast=lambda x: x)
        adsk = types.SimpleNamespace(core=types.SimpleNamespace(MarkingMenuEventHandler=object, Application=types.SimpleNamespace(get=lambda:app), CommandControl=cast), cam=types.SimpleNamespace(Operation=cast, Setup=cast, NCProgram=cast))
        tree = ast.parse(SOURCE.read_text(encoding='utf-8'))
        cls = next(n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == 'ContextMenu')
        ns = {'adsk':adsk,'definition':'post-command','COMMAND':'MainsailCncPostOutbox'}
        exec(compile(ast.Module(body=[cls],type_ignores=[]),str(SOURCE),'exec'),ns)
        ns['ContextMenu']().notify(types.SimpleNamespace(selectedEntities=['operation'],linearMarkingMenu=types.SimpleNamespace(controls=controls)))
        return calls

    def test_insert_immediately_after_existing_post(self):
        self.assertEqual(self.invoke(['Edit','Post Process...','Simulate']), [('post-command','IronPostProcess',False)])

    def test_fallback_if_post_not_present(self):
        self.assertEqual(self.invoke(['Edit','Simulate']), [('post-command','',False)])

    def test_other_workspaces_unchanged(self):
        self.assertEqual(self.invoke(['Post Process'], 'FusionSolidEnvironment'), [])

if __name__ == '__main__':
    unittest.main()
