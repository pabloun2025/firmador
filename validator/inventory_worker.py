"""One private, killable v1 validation job; no service keys in child environment."""
import base64
import json
import re
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))

from validator.inventory import InventoryFailure
from validator.detection import compare_detected_signatures


def run():
    try:
        raw=sys.stdin.buffer.read(29*1024*1024+1)
        if len(raw)>29*1024*1024: raise InventoryFailure('REQUEST_TOO_LARGE')
        payload=json.loads(raw)
        if not isinstance(payload,dict) or set(payload)!={'previous','candidate','baseSha256'}:
            raise InventoryFailure('INVALID_REQUEST')
        if not isinstance(payload['baseSha256'],str) or not re.fullmatch('[a-f0-9]{64}',payload['baseSha256']):
            raise InventoryFailure('INVALID_REQUEST')
        for key in ('previous','candidate'):
            if not isinstance(payload[key],str) or not 8<=len(payload[key])<=4*((10*1024*1024+2)//3):
                raise InventoryFailure('INVALID_REQUEST')
        result=compare_detected_signatures(base64.b64decode(payload['previous'],validate=True),
            base64.b64decode(payload['candidate'],validate=True),base_sha256=payload['baseSha256'])
        sys.stdout.write(json.dumps(result))
    except InventoryFailure as error:
        sys.stdout.write(json.dumps({'accepted':False,'code':str(error)}))
    except Exception:
        sys.stdout.write(json.dumps({'accepted':False,'code':'INVALID_REQUEST'}))


if __name__=='__main__':run()
