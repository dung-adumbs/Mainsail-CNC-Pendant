import sys,configparser

import jinja2
from types import SimpleNamespace as NS
c=configparser.RawConfigParser();c.read('examples/lowrider-v4/work-light.cfg',encoding='utf-8-sig')
env=jinja2.Environment(block_start_string='{%',block_end_string='%}',variable_start_string='{',variable_end_string='}')
templates={n:env.from_string(c.get(n,'gcode')) for n in c.sections() if c.has_option(n,'gcode')}
s=NS(automatic=0,idle_since=0,last_move=1,snooze_until=0,steady=.7,timeout=1800,phase=0,warning_since=-1,disable_after=1800,shutdown_minutes=30)
p={'gcode_macro _LED_IDLE_STATE':s,'toolhead':NS(estimated_print_time=1799,print_time=1),'stepper_enable':NS(steppers={'x':True}),'idle_timeout':NS(state='Ready'),'print_stats':NS(state='standby'),'pause_resume':NS(is_paused=False),'save_variables':NS(variables={})}
def render(n,params={}):return templates[n].render(printer=p,params=params,action_raise_error=lambda text:(_ for _ in ()).throw(ValueError(text)),action_respond_info=lambda text:'')
assert 'VARIABLE=automatic VALUE=1' not in render('delayed_gcode led_idle_watch')
p['toolhead'].estimated_print_time=1800;assert 'VARIABLE=automatic VALUE=1' in render('delayed_gcode led_idle_watch')
s.automatic=1;s.warning_since=1800;p['toolhead'].estimated_print_time=3599;assert '\n        M84' not in render('delayed_gcode led_idle_watch')
p['toolhead'].estimated_print_time=3600;assert 'M84' in render('delayed_gcode led_idle_watch')
p['pause_resume'].is_paused=True;assert 'M84' not in render('delayed_gcode led_idle_watch')
p['pause_resume'].is_paused=False;p['print_stats'].state='printing';assert 'M84' not in render('delayed_gcode led_idle_watch')
p['print_stats'].state='standby'
text=render('gcode_macro SET_STEPPER_TIMEOUT',{'WARNING_MINUTES':'45','MINUTES':'20','ENABLE':'1'})
assert 'VARIABLE=timeout VALUE=2700.0' in text and 'VARIABLE=disable_after VALUE=1200.0' in text
assert 'SAVE_VARIABLE VARIABLE=cnc_idle_warning_minutes VALUE=45.0' in text and 'SAVE_VARIABLE VARIABLE=cnc_stepper_timeout_minutes VALUE=20.0' in text
text=render('delayed_gcode led_restore_settings');assert 'VARIABLE=timeout VALUE=1800.0' in text and 'VARIABLE=disable_after VALUE=1800.0' in text
p['save_variables'].variables={'cnc_idle_warning_minutes':45,'cnc_stepper_timeout_minutes':20,'cnc_stepper_auto_disable':0}
text=render('delayed_gcode led_restore_settings');assert 'VARIABLE=timeout VALUE=2700.0' in text and 'VARIABLE=disable_after VALUE=0.0' in text
for key in ['WARNING_MINUTES','MINUTES']:
 try:render('gcode_macro SET_STEPPER_TIMEOUT',{key:'0'})
 except ValueError:pass
 else:raise AssertionError('Invalid time accepted')
print('Passed 30+30 defaults and boundaries, paused/running exclusions, validation, saving both stages, restoring customized stages and Disabled across reboot.')
