"""Exclusive v1 service. Run with TLS/service auth and no access logs.

No multipart spooling, PDF persistence, request-body logs, public API docs or
outbound certificate fetching. Provider-wide quotas remain required upstream.
"""
import asyncio
import hmac
import json
import os
from pathlib import Path
import sys
from fastapi import FastAPI,HTTPException,Request
from fastapi.responses import JSONResponse
from validator.detection import POLICY

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
slots=asyncio.Semaphore(1)
MAX_REQUEST=29*1024*1024


def authorize(request):
    token=os.getenv('V1_PDF_VALIDATOR_TOKEN','')
    if os.getenv('PDF_SIGNATURE_INVENTORY_ENABLED')!='true' or len(token)<32:
        raise HTTPException(503,'VALIDATOR_DISABLED')
    if not hmac.compare_digest(request.headers.get('authorization',''),'Bearer '+token):
        raise HTTPException(401,'UNAUTHORIZED')


@app.get('/health')
@app.get('/ready')
async def health(request:Request):
    authorize(request)
    return {'ready':True,'policy':POLICY,'trust':'not_evaluated','revocation':'unknown'}


@app.post('/validate')
async def validate(request:Request):
    authorize(request)
    if request.headers.get('content-type','').split(';')[0]!='application/json':raise HTTPException(415,'JSON_REQUIRED')
    length=request.headers.get('content-length')
    if length is not None and (not length.isascii() or not length.isdigit() or int(length)>MAX_REQUEST):raise HTTPException(413,'REQUEST_TOO_LARGE')
    if slots.locked():raise HTTPException(429,'VALIDATOR_BUSY')
    async with slots:
        data=bytearray(); process=None
        try:
            async with asyncio.timeout(15):
                async for chunk in request.stream():
                    if len(data)+len(chunk)>MAX_REQUEST:raise HTTPException(413,'REQUEST_TOO_LARGE')
                    data.extend(chunk)
            process=await asyncio.create_subprocess_exec(sys.executable,'-m','validator.inventory_worker',
                stdin=asyncio.subprocess.PIPE,stdout=asyncio.subprocess.PIPE,stderr=asyncio.subprocess.DEVNULL,
                cwd=Path(__file__).resolve().parent.parent,
                env={'PYTHONPATH':str(Path(__file__).resolve().parent.parent)})
            result,_=await asyncio.wait_for(process.communicate(data),timeout=20)
            if process.returncode or len(result)>262144:raise HTTPException(503,'VALIDATION_UNAVAILABLE')
            report=json.loads(result)
            return JSONResponse(report,status_code=200 if report.get('accepted') is True else 422,headers={'Cache-Control':'no-store'})
        except TimeoutError:raise HTTPException(503,'VALIDATION_TIMEOUT') from None
        except HTTPException:raise
        except Exception:raise HTTPException(503,'VALIDATION_UNAVAILABLE') from None
        finally:
            data.clear()
            if process is not None and process.returncode is None:
                process.kill();await process.wait()
