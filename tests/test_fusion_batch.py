"""Exercise native-post orchestration with a fake Fusion API, never a controller."""
import importlib
import json
import pathlib
import sys
import tempfile
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
PKG = ROOT / 'fusion-addin/CncOutbox'
package = types.ModuleType('batch_fixture')
package.__path__ = [str(PKG)]
sys.modules['batch_fixture'] = package
batch = importlib.import_module('batch_fixture.batch')

class Operation:
    def __init__(self, number, name, manual=False):
        self.operationId=name;self.name=name;self.isSuppressed=False
        self.strategy='manual' if manual else 'adaptive'
        self.hasToolpath=True;self.isToolpathValid=True;self.hasError=False;self.warning=''
        geometry={'DC':3.175,'LCF':15}
        self.tool=types.SimpleNamespace(toJson=lambda:json.dumps({'type':'flat end mill','description':'Tool '+str(number),'geometry':geometry}))
        values={'tool_number':number,'tool_spindleSpeed':16000,'tool_feedCutting':80}
        self.parameters=types.SimpleNamespace(itemByName=lambda k:types.SimpleNamespace(value=types.SimpleNamespace(value=values[k])) if k in values else None)

class Setup:
    def __init__(self, ops):
        self.operationId='setup';self.name='BONE';self.allOperations=ops
        self.machine=types.SimpleNamespace(id='machine',vendor='test',model='test mill',description='mock only')
        for op in ops:op.parentSetup=self

class BatchTests(unittest.TestCase):
    def test_planner_keeps_returning_tool_and_manual_order(self):
        rows=[{'name':str(i),'tool':{'number':n,'geometry':{'DC':3}}} for i,n in enumerate([7,4,1,8,5,7])]
        rows.insert(1,{'name':'stop','manual':True})
        result=batch.plan(rows)
        self.assertEqual([g['tool']['number'] for g in result],[7,4,1,8,5,7])
        self.assertEqual([r['name'] for g in result for r in g['rows']],[r['name'] for r in rows])
        a={'tool':{'number':1,'geometry':{'DC':3}}};b={'tool':{'number':1,'geometry':{'DC':6}}}
        self.assertEqual(len(batch.plan([a,a,b])),2)

    def invoke(self, fail=0, invalid=False, memo=''):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup);root=pathlib.Path(folder.name)
        out=root/'Outbox';calls=[];ui=types.SimpleNamespace(messageBox=lambda *a:1,statusMessage='')
        ui.createProgressDialog=lambda:types.SimpleNamespace(show=lambda *a:None,hide=lambda:None,wasCancelled=False,progressValue=0)
        ops=[Operation(6,'face'),Operation(6,'rough'),Operation(9,'island'),Operation(13,'chamfer'),Operation(6,'cutout')]
        setup=Setup(ops)
        if invalid:ops[-1].isToolpathValid=False
        def create_input():
            params={k:types.SimpleNamespace(value=types.SimpleNamespace(value=None)) for k in ['nc_program_filename','nc_program_name','nc_program_output_folder','nc_program_openInEditor','nc_program_postToFusionTeam']}
            return types.SimpleNamespace(parameters=types.SimpleNamespace(itemByName=params.get),_params=params)
        def add(nc):
            def post(options):
                calls.append([o.name for o in nc.operations])
                if fail and len(calls)==fail:return False
                path=pathlib.Path(nc._params['nc_program_output_folder'].value.value)/(nc._params['nc_program_filename'].value.value+'.gcode')
                path.write_text('; mock native post\nG90\nG21\n')
                return True
            return types.SimpleNamespace(postProcess=post)
        cam=types.SimpleNamespace(checkValidity=lambda:None,ncPrograms=types.SimpleNamespace(createInput=create_input,add=add),getMachiningTime=lambda *a:types.SimpleNamespace(machiningTime=60))
        app=types.SimpleNamespace(userInterface=ui,activeDocument=types.SimpleNamespace(name='BONE',products=types.SimpleNamespace(itemByProductType=lambda t:cam)),log=lambda *a:None)
        post=types.SimpleNamespace(description='test post')
        library=types.SimpleNamespace(createQuery=lambda *a:types.SimpleNamespace(execute=lambda:[post]))
        core=types.SimpleNamespace(Application=types.SimpleNamespace(get=lambda:app),MessageBoxButtonTypes=types.SimpleNamespace(YesNoButtonType=1),DialogResults=types.SimpleNamespace(DialogYes=1))
        for name in ['CommandEventHandler','CommandCreatedEventHandler','MarkingMenuEventHandler']:setattr(core,name,object)
        cast=lambda cls:types.SimpleNamespace(cast=lambda item:item if isinstance(item,cls) else None)
        cam_api=types.SimpleNamespace(Operation=cast(Operation),Setup=cast(Setup),CAM=types.SimpleNamespace(cast=lambda item:item),CAMManager=types.SimpleNamespace(get=lambda:types.SimpleNamespace(libraryManager=types.SimpleNamespace(postLibrary=library))),LibraryLocations=types.SimpleNamespace(LocalLibraryLocation=1),NCProgramPostProcessOptions=types.SimpleNamespace(create=lambda:None))
        adsk=types.ModuleType('adsk');adsk.core=core;adsk.cam=cam_api
        for name,value in [('adsk',adsk),('adsk.core',core),('adsk.cam',cam_api)]:sys.modules[name]=value
        sys.modules.pop('batch_fixture.CncOutbox',None)
        module=importlib.import_module('batch_fixture.CncOutbox')
        machine={k:getattr(setup.machine,k) for k in ['id','vendor','model','description']}
        module.configuration=lambda:(root/'config.json',{'outbox':str(out),'post_description':'test post','machine':machine})
        error=None
        try:module.perform([ops[-1],*ops[:-1]], memo)
        except Exception as e:error=e
        return out,calls,error

    def test_whole_batch_published_in_setup_order(self):
        out,calls,error=self.invoke();self.assertIsNone(error)
        self.assertEqual(calls,[['face','rough'],['island'],['chamfer'],['cutout']])
        files=sorted(out.glob('*.gcode'));self.assertEqual(len(files),4)
        for index,p in enumerate(files,1):
            meta=json.loads(p.read_text().splitlines()[0].split(': ',1)[1])
            self.assertEqual((meta['stage'],meta['count']),(index,4))
            self.assertIn('CNC_FUSION_OPERATION_V1',p.read_text())
            operation=json.loads(p.read_text().splitlines()[1].split(': ',1)[1])
            self.assertEqual(operation['feed_mm_min'],80)

    def test_memo_propagates_without_changing_selection(self):
        out,calls,error=self.invoke(memo='Fillet cleanup <test>');self.assertIsNone(error)
        self.assertEqual(calls,[['face','rough'],['island'],['chamfer'],['cutout']])
        for p in out.glob('*.gcode'):
            meta=json.loads(p.read_text().splitlines()[0].split(': ',1)[1]);self.assertEqual(meta['memo'],'Fillet cleanup <test>')
        manifest=json.loads(next((out.parent/'.cnc-posting').glob('*/manifest.json')).read_text());self.assertEqual(manifest['memo'],'Fillet cleanup <test>')

    def test_native_post_failure_publishes_nothing(self):
        out,calls,error=self.invoke(fail=3);self.assertIsInstance(error,RuntimeError)
        self.assertEqual(list(out.glob('*.gcode')),[])
        self.assertEqual(len(calls),3)
        self.assertTrue(list((out.parent/'.cnc-posting').rglob('*.gcode')))

    def test_invalid_last_operation_prevents_all_posts(self):
        out,calls,error=self.invoke(invalid=True);self.assertIsInstance(error,ValueError);self.assertEqual(calls,[])

    def test_metadata_cannot_inject_gcode(self):
        data=batch.with_metadata(b'G90\n',{'name':'x\nG1 X9'},[])
        self.assertEqual(data.count(b'\n'),2)

if __name__=='__main__':unittest.main()
