import importlib
import importlib.util
from hashlib import sha256
import base64
import pytest
from fastapi.testclient import TestClient
from validator.tests.test_inventory import sample


def service():
    assert importlib.util.find_spec('validator.inventory_service'), 'private v1 inventory service is not implemented'
    return importlib.import_module('validator.inventory_service')


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('PDF_SIGNATURE_INVENTORY_ENABLED','true')
    monkeypatch.setenv('V1_PDF_VALIDATOR_TOKEN','synthetic-test-token-not-a-production-secret')
    return TestClient(service().app)


def headers():
    return {'Authorization':'Bearer synthetic-test-token-not-a-production-secret'}


def payload(sample):
    return {'previous':base64.b64encode(sample['base']).decode(),
            'candidate':base64.b64encode(sample['one']).decode(),
            'baseSha256':sha256(sample['base']).hexdigest()}


def test_service_disabled_by_default(monkeypatch):
    monkeypatch.delenv('PDF_SIGNATURE_INVENTORY_ENABLED',raising=False)
    assert TestClient(service().app).post('/validate',json={}).status_code==503


def test_all_endpoints_require_authentication(client):
    assert client.get('/health').status_code==401
    assert client.get('/ready').status_code==401
    assert client.post('/validate',json={}).status_code==401
    assert client.get('/docs').status_code==404


def test_authenticated_readiness(client):
    assert client.get('/ready',headers=headers()).json()['policy']=='leapsign-v1.1-signature-detection-1'


def test_requires_json(client):
    assert client.post('/validate',content=b'pdf',headers=headers()|{'Content-Type':'application/pdf'}).status_code==415


def test_rejects_large_body_before_read(client):
    assert client.post('/validate',content=b'{}',headers=headers()|{'Content-Length':str(30*1024*1024),'Content-Type':'application/json'}).status_code==413


def test_rejects_extra_private_fields(client,sample):
    response=client.post('/validate',json=payload(sample)|{'password':'do-not-process'},headers=headers())
    assert response.status_code==422
    assert response.json()['code']=='INVALID_REQUEST'


def test_real_subprocess_validates_without_uploading_keys(client,sample):
    result=client.post('/validate',json=payload(sample),headers=headers())
    assert result.status_code==200
    assert result.json()['accepted'] is True
    assert result.json()['signatureCount']==1
    assert result.json()['signatures'][0]['trust']=='not_evaluated'


def test_subprocess_rejects_unsigned_result(client,sample):
    request=payload(sample);request['candidate']=request['previous']
    result=client.post('/validate',json=request,headers=headers())
    assert result.status_code==422 and result.json()['accepted'] is False


def test_never_queues_unbounded_work(client):
    module=service()
    # Exhaust the real admission gate, not a fake successful validator.
    module.slots._value=0
    try:
        assert client.post('/validate',json={},headers=headers()).status_code==429
    finally:module.slots._value=1
