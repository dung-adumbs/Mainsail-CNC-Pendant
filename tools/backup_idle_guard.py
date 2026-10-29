"""Read-only admission check for scheduled backups; never sends G-code."""
import json
import math
import sys
import urllib.request
import urllib.error
import time
import uuid

QUERY = ('http://127.0.0.1:7125/printer/objects/query?webhooks&print_stats'
         '&pause_resume&virtual_sdcard&toolhead&idle_timeout')


def reason(status):
    try:
        if status['webhooks']['state'] != 'ready':
            return 'controller not ready'
        if status['print_stats']['state'] not in ('standby', 'complete', 'cancelled', 'error'):
            return 'job running, paused, or unknown'
        if status['pause_resume']['is_paused'] is not False:
            return 'job paused or pause state unknown'
        if status['virtual_sdcard']['is_active'] is not False:
            return 'file execution active or unknown'
        if status['idle_timeout']['state'] not in ('Idle', 'Ready'):
            return 'motion or recent machine activity'
        tool = status['toolhead']
        planned, clock = tool['print_time'], tool['estimated_print_time']
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
               for v in (planned, clock)):
            return 'motion timing unavailable'
        # Leave a 30-second quiet period after the last scheduled motion.
        if planned > 0 and clock - planned < 30:
            return 'queued motion or less than 30 seconds quiet'
    except (KeyError, TypeError):
        return 'incomplete controller status'
    return None


def api(path, value=None):
    data = None if value is None else json.dumps(value).encode()
    req = urllib.request.Request('http://127.0.0.1:7125'+path, data=data,
                                 headers={'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=4) as response:
            return json.load(response)['result']
    except urllib.error.HTTPError as error:
        if error.code == 404 and value is None and path.startswith('/server/database/item?'):
            return {'value': None}
        raise


def read(key):
    return api('/server/database/item?namespace=cnc_maintenance&key='+key)['value']


def write(key, value):
    api('/server/database/item', {'namespace': 'cnc_maintenance', 'key': key, 'value': value})


def recent(status, activity, now):
    at = (activity or {}).get('at', 0)
    if not isinstance(at, (int, float)) or not math.isfinite(at):
        raise ValueError('Invalid activity timestamp')
    if at > now+120:
        raise ValueError('Activity clock differs; defer backup')
    tool = status['toolhead']
    return (at > 0 and now-at < 900) or (tool['print_time'] > 0 and
             tool['estimated_print_time']-tool['print_time'] < 900)


def admit(status_reader, read_record, write_record, now=time.time, sleep=time.sleep):
    status = status_reader()
    problem = reason(status)
    if problem:
        return problem
    if not recent(status, read_record('backup_activity'), now()):
        write_record('backup_prompt', {'state': 'admitted', 'at': now()})
        return None
    previous = read_record('backup_prompt') or {}
    if previous.get('state') == 'deferred':
        return 'waiting until activity has been quiet for 15 minutes'
    token = uuid.uuid4().hex
    prompt = {'id': token, 'state': 'pending', 'created': now(), 'expires': now()+60}
    write_record('backup_prompt', prompt)
    outcome = 'no answer; waiting until finished'
    try:
        # Bound the loop independently of wall-clock jumps.
        for _ in range(20):
            sleep(3)
            problem = reason(status_reader())
            if problem:
                outcome = problem
                return problem
            choice = read_record('backup_choice') or {}
            if choice.get('id') != token:
                continue
            if choice.get('action') == 'now' and now() < prompt['expires']:
                prompt.update(state='admitted', at=now())
                return None
            outcome = 'operator deferred; waiting until finished'
            return outcome
        return outcome
    finally:
        if prompt['state'] == 'pending':
            prompt.update(state='deferred', reason=outcome, at=now())
        write_record('backup_prompt', prompt)


def main():
    try:
        status_reader = lambda: api(QUERY.split('7125', 1)[1])['status']
        if '--check-only' in sys.argv:
            problem = reason(status_reader())
        else:
            problem = admit(status_reader, read, write)
    except Exception as error:
        problem = 'status unavailable (' + type(error).__name__ + ')'
    if problem:
        print('Backup deferred: ' + problem + '; next scheduled run will retry.')
        return 75
    print('Backup admission: controller ready, no active/paused job, motion quiet.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
