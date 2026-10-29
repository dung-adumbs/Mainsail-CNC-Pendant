import sys
sys.path.insert(0,'moonraker')
from cnc_gcode_scan import keepout_interferences
b=[dict(name='Clamp',enabled=True,xmin=10,xmax=20,ymin=10,ymax=20,safeZ=5,margin=2)]
def box(lo,hi):return dict(min=lo,max=hi)
assert keepout_interferences(box([8,8,0],[9,9,4]),[0,0,0],b)
assert not keepout_interferences(box([10,10,6],[20,20,10]),[0,0,0],b)
assert keepout_interferences(box([0,0,0],[1,1,1]),[10,10,0],b)
assert keepout_interferences(None,[0,0,0],b,[[0,15,0],[30,15,0]])
assert not keepout_interferences(None,[0,0,0],[{**b[0],'enabled':False}],[[0,15,0],[30,15,0]])
try:keepout_interferences(None,[0,0,0],[{**b[0],'margin':-1}])
except ValueError:pass
else:raise AssertionError('Invalid enabled block accepted')
print('PASS keep-out envelopes, machine offsets, clearance, margin, return route and invalid settings')
