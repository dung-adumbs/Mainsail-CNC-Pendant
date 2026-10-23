import datetime
import re
import uuid

def clean(text, limit=45):
    return re.sub(r'[^A-Za-z0-9._-]+', '_', str(text)).strip('._-')[:limit] or 'unnamed'

def unique_name(document, setup, tool):
    stamp = datetime.datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    return '__'.join([clean(document), clean(setup), clean(tool), stamp, uuid.uuid4().hex[:8]])
