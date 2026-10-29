"""Ordered single-tool posting plan and comment metadata. No Fusion/machine calls."""
import hashlib
import json
import math
from .naming import clean


def tool_key(tool):
    """Preset/feed differences do not constitute a physical tool change."""
    return json.dumps({k: tool.get(k) for k in ('number', 'description', 'type', 'geometry')}, sort_keys=True)


def plan(rows):
    groups, pending = [], []
    for row in rows:
        if row.get('manual'):
            pending.append(row)
            continue
        key = tool_key(row['tool'])
        if not groups or groups[-1]['key'] != key:
            groups.append({'key': key, 'tool': row['tool'], 'rows': []})
        groups[-1]['rows'].extend(pending + [row])
        pending = []
    if not groups:
        raise ValueError('Select at least one generated machining operation.')
    groups[-1]['rows'].extend(pending)
    if len(groups) > 24:
        raise ValueError('A batch supports at most 24 consecutive tool stages. Select a smaller sequence.')
    return groups


def filename(document, setup, number, stage, batch_id):
    # Stage remains near the front even when the PC helper shortens the name.
    return '__'.join([clean(document, 24), f'S{stage:03d}-T{clean(number, 6)}', clean(setup, 24), batch_id])


def with_metadata(data, summary, operations):
    def line(key, value):
        # JSON escapes newlines and control characters; metadata cannot inject commands.
        return '; ' + key + ': ' + json.dumps(value, ensure_ascii=True, separators=(',', ':'), allow_nan=False)
    header = [line('CNC_BATCH_V1', summary)]
    header.extend(line('CNC_FUSION_OPERATION_V1', op) for op in operations)
    return ('\n'.join(header) + '\n').encode('utf-8') + data


def finite(value):
    return value if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0 else None


def checksum(data):
    return hashlib.sha256(data).hexdigest()
