# Narrow manual recovery moves for Cartesian CNC machines.
# No fake homing or SET_KINEMATIC_POSITION; individual-motor moves require acknowledgement.
class CNCForceJog:
    def __init__(self, config):
        self.printer = config.get_printer()
        if config.getsection('printer').get('kinematics') != 'cartesian':
            raise config.error('cnc_force_jog requires cartesian kinematics')
        self.reactor = self.printer.get_reactor()
        self.enabled = False
        self.busy = False
        self.sequence = 0
        self.gcode = self.printer.lookup_object('gcode')
        self.gcode.register_command('CNC_FORCE_MODE', self.cmd_MODE,
                                    desc='Enable/disable acknowledged unhomed recovery mode')
        self.gcode.register_command('CNC_FORCE_JOG', self.cmd_JOG,
                                    desc='Unhomed axis only: 0.1 or 1 mm at 1 mm/s')
        for event in ['homing:home_rails_begin', 'homing:homing_move_begin',
                      'stepper_enable:motor_off', 'klippy:shutdown']:
            self.printer.register_event_handler(event, self.clear)

    def clear(self, *args):
        self.enabled = False
        self.sequence += 1

    def job_active(self, eventtime):
        stats = self.printer.lookup_object('print_stats').get_status(eventtime)
        paused = self.printer.lookup_object('pause_resume').get_status(eventtime)
        sd = self.printer.lookup_object('virtual_sdcard').get_status(eventtime)
        return (stats['state'] in ('printing', 'paused')
                or paused['is_paused'] or sd['is_active'])

    def check_idle(self, gcmd):
        now = self.reactor.monotonic()
        if self.job_active(now):
            self.clear()
            raise gcmd.error('Forced motion is blocked during running or paused jobs')
        toolhead = self.printer.lookup_object('toolhead')
        print_time, estimated, empty = toolhead.check_busy(now)
        if self.busy or not empty or print_time + .05 > estimated:
            raise gcmd.error('Wait for motion to finish; forced clicks cannot queue')
        return toolhead, now

    def cmd_MODE(self, gcmd):
        enabled = gcmd.get_int('ENABLE', minval=0, maxval=1)
        if not enabled:
            self.clear()
            return
        toolhead, now = self.check_idle(gcmd)
        if gcmd.get_int('CONFIRM', 0) != 1:
            raise gcmd.error('Acknowledge unknown position, travel and clearance first')
        if all(a in toolhead.get_status(now)['homed_axes'] for a in 'xyz'):
            raise gcmd.error('All axes are homed; use normal jogging')
        self.enabled = True
        self.sequence += 1

    def cmd_JOG(self, gcmd):
        toolhead, now = self.check_idle(gcmd)
        if not self.enabled:
            raise gcmd.error('Enable Forced unhomed motion first')
        if gcmd.get_int('TOKEN') != self.sequence:
            raise gcmd.error('Stale forced-motion request; wait and press again')
        axis = gcmd.get('AXIS').upper()
        if axis not in ('X', 'Y', 'Z'):
            raise gcmd.error('Specify one X, Y or Z axis')
        distance = gcmd.get_float('DISTANCE')
        if not any(abs(distance - n) < 1.e-8 for n in (-1., -.1, .1, 1.)):
            raise gcmd.error('Forced moves must be exactly +/-0.1 or +/-1 mm')
        if axis.lower() in toolhead.get_status(now)['homed_axes']:
            raise gcmd.error('Axis is homed; use normal travel-checked jogging')
        motors = {'X': ['stepper_x'], 'Y': ['stepper_y', 'stepper_y1'],
                  'Z': ['stepper_z', 'stepper_z1']}[axis]
        selection = gcmd.get('MOTORS', 'both').lower()
        if selection not in ('both', 'primary', 'secondary') or (axis == 'X' and selection != 'both'):
            raise gcmd.error('Invalid motor selection')
        if selection != 'both' and gcmd.get_int('SINGLE_CONFIRM', 0) != 1:
            raise gcmd.error('Acknowledge gantry skew before moving one motor')
        index = 'XYZ'.index(axis)
        target = list(toolhead.get_position())
        target[index] += distance
        kin = toolhead.get_kinematics()
        original_check = kin.check_move
        def checked_recovery(move):
            if any(abs(d) > 1.e-8 for i, d in enumerate(move.axes_d) if i != index):
                raise gcmd.error('Recovery may only move the selected unhomed axis')
            if abs(move.axes_d[index] - distance) > 1.e-8:
                raise gcmd.error('Unexpected forced-motion distance')
            move.limit_speed(1., 10.)
        self.busy = True
        self.sequence += 1
        try:
            # The normal toolhead schedules every motor on the selected axis
            # together, including paired Y/Y1 and Z/Z1. Only this move's check
            # is replaced. No homing flags, limits or work offsets are changed.
            if selection == 'both':
                kin.check_move = checked_recovery
                try:
                    toolhead.move(target, 1.)
                finally:
                    kin.check_move = original_check
            else:
                # Excluded motors HOLD; never de-energize a Z support.
                force = self.printer.lookup_object('force_move')
                steppers = [force.lookup_stepper(name) for name in motors]
                for stepper in steppers:
                    force._force_enable(stepper)
                selected = steppers[0 if selection == 'primary' else 1]
                force.manual_move(selected, distance, 1., 10.)
            self.printer.lookup_object('gcode_move').reset_last_position()
            toolhead.wait_moves()
        finally:
            self.busy = False

    def get_status(self, eventtime):
        toolhead = self.printer.lookup_object('toolhead')
        if self.enabled and (self.job_active(eventtime)
                or all(a in toolhead.get_status(eventtime)['homed_axes'] for a in 'xyz')):
            self.clear()
        return {'enabled': self.enabled, 'busy': self.busy,
                'sequence': self.sequence, 'speed': 1., 'steps': [.1, 1.]}

def load_config(config):
    return CNCForceJog(config)
