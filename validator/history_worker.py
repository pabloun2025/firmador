"""Resource-bounded local history job. Not exposed by the validation HTTP API."""
import base64
import json
import resource
import sys

resource.setrlimit(resource.RLIMIT_CPU,(15,15))
resource.setrlimit(resource.RLIMIT_AS,(512*1024*1024,512*1024*1024))
from validator.history import inspect_historical_version


if __name__=='__main__':
    try:
        raw=sys.stdin.buffer.read(29*1024*1024+1)
        if len(raw)>29*1024*1024:
            raise ValueError()
        data=json.loads(raw)
        if set(data)!={'versionId','sha256','pdf','parent'}:
            raise ValueError()
        def decode(value):
            if value is None:
                return None
            if not isinstance(value,str) or len(value)>4*((10*1024*1024+2)//3):
                raise ValueError()
            return base64.b64decode(value,validate=True)
        result=inspect_historical_version(version_id=data['versionId'],expected_hash=data['sha256'],
            pdf=decode(data['pdf']),parent=decode(data['parent']))
        sys.stdout.write(json.dumps(result))
    except Exception:
        sys.stdout.write(json.dumps({'status':'analysis_unavailable','relationship':'not_proven'}))
