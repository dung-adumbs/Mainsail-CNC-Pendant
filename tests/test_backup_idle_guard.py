import copy
import importlib.util
import pathlib
import unittest

spec=importlib.util.spec_from_file_location('backup_guard',pathlib.Path(__file__).parents[1]/'tools/backup_idle_guard.py')
guard=importlib.util.module_from_spec(spec);spec.loader.exec_module(guard)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.s={'webhooks':{'state':'ready'},'print_stats':{'state':'standby'},
                'pause_resume':{'is_paused':False},'virtual_sdcard':{'is_active':False},
                'idle_timeout':{'state':'Idle'},'toolhead':{'print_time':100,'estimated_print_time':1200}}
        self.records={};self.writes=[];self.t=10000

    def run_gate(self, action=None, busy=False):
        def write(key,value):
            self.records[key]=copy.deepcopy(value);self.writes.append((key,copy.deepcopy(value)))
        def sleep(seconds):
            self.t+=seconds
            if busy:self.s['print_stats']['state']='printing'
            if action:self.records['backup_choice']={'id':self.records['backup_prompt']['id'],'action':action}
        return guard.admit(lambda:self.s,self.records.get,write,lambda:self.t,sleep)

    def test_busy_missing_and_timing_fail_closed(self):
        for obj,key,value in [('webhooks','state','shutdown'),('print_stats','state','printing'),
                              ('print_stats','state','paused'),('pause_resume','is_paused',True),
                              ('virtual_sdcard','is_active',True),('toolhead','print_time',1201),
                              ('toolhead','print_time',float('nan')),('idle_timeout','state','Printing')]:
            s=copy.deepcopy(self.s);s[obj][key]=value;self.assertIsNotNone(guard.reason(s))
        for key in self.s:
            s=copy.deepcopy(self.s);del s[key];self.assertIsNotNone(guard.reason(s))
        self.s['print_stats']['state']='printing';self.assertIsNotNone(self.run_gate());self.assertEqual(self.writes,[])

    def test_quiet_admits_without_question(self):
        self.assertIsNone(self.run_gate());self.assertEqual(self.records['backup_prompt']['state'],'admitted')
        self.assertFalse(any(v.get('state')=='pending' for _,v in self.writes))

    def test_recent_activity_and_explicit_now(self):
        self.records['backup_activity']={'at':9999};self.assertIsNone(self.run_gate('now'))
        self.assertEqual(self.records['backup_prompt']['state'],'admitted')

    def test_no_response_and_stale_choice_defer(self):
        self.records.update(backup_activity={'at':9999},backup_choice={'id':'old','action':'now'})
        self.assertIsNotNone(self.run_gate());self.assertEqual(self.records['backup_prompt']['state'],'deferred')
        self.assertEqual(self.t,10060)

    def test_defer_is_not_repeated_until_quiet(self):
        self.records['backup_activity']={'at':9999};self.assertIsNotNone(self.run_gate('defer'))
        self.writes=[];self.assertIsNotNone(self.run_gate());self.assertEqual(self.writes,[])
        self.t=11000;self.assertIsNone(self.run_gate())

    def test_job_start_cancels_pending_request(self):
        self.records['backup_activity']={'at':9999};self.assertIsNotNone(self.run_gate('now',busy=True))
        self.assertEqual(self.records['backup_prompt']['state'],'deferred')

    def test_recent_motion_and_bad_clock(self):
        self.s['toolhead']['estimated_print_time']=150
        self.assertTrue(guard.recent(self.s,None,self.t))
        with self.assertRaises(ValueError):guard.recent(self.s,{'at':20000},self.t)


if __name__=='__main__':unittest.main()
