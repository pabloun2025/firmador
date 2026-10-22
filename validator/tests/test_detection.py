"""Detection is deliberately not mathematical or legal validation."""
import importlib
import importlib.util
from hashlib import sha256
from io import BytesIO
import pytest
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.sign.fields import append_signature_field, SigFieldSpec
from validator.tests.test_inventory import sample


def engine():
    assert importlib.util.find_spec('validator.detection'), 'signature detection is not implemented'
    return importlib.import_module('validator.detection')


def compare(before, after):
    return engine().compare_detected_signatures(before, after, base_sha256=sha256(before).hexdigest())


@pytest.mark.parametrize('before,after,count',[('base','one',1),('one','two',2),('two','three',3)])
def test_original_may_already_be_signed_and_same_person_may_sign_again(sample,before,after,count):
    result=compare(sample[before],sample[after])
    assert result['signatureCount']==count and result['inheritedCount']==count-1
    assert result['policy']=='leapsign-v1.1-signature-detection-1'
    assert all(s['certificate']['subject']=='Persona sintetica' for s in result['signatures'])
    assert all(s['integrity']=='not_evaluated' for s in result['signatures'])


def test_does_not_validate_crypto_or_require_exact_incremental_prefix(sample):
    sig=PdfFileReader(BytesIO(sample['one'])).embedded_regular_signatures[0]
    value=sig.signer_info['signature'].native.hex().upper().encode()
    damaged=sample['one'].replace(value,(b'00' if value[:2]!=b'00' else b'01')+value[2:],1)
    assert damaged!=sample['one']
    assert compare(sample['base'],damaged)['accepted'] is True
    rewritten=sample['two'].replace(b'%PDF-1.3',b'%PDF-1.4',1)
    assert not rewritten.startswith(sample['one'])
    assert compare(sample['one'],rewritten)['signatureCount']==2


def test_empty_signature_fields_are_not_signatures(sample):
    writer=IncrementalPdfFileWriter(BytesIO(sample['base']))
    append_signature_field(writer,SigFieldSpec('Empty'))
    output=BytesIO();writer.write(output)
    assert engine().detect_signatures(output.getvalue())['signatures']==[]


@pytest.mark.parametrize('before,after,code',[('base','base','NO_NEW_SIGNATURE'),('one','one','NO_NEW_SIGNATURE'),('base','two','MULTIPLE_NEW_SIGNATURES'),('one','base','PREVIOUS_SIGNATURE_CHANGED')])
def test_requires_exactly_one_additional_signature(sample,before,after,code):
    with pytest.raises(Exception,match=code):compare(sample[before],sample[after])


def test_does_not_evaluate_expiry_or_trust(sample):
    result=compare(sample['base'],sample['sign'](sample['base'],expired=True))
    assert result['accepted']
    assert result['signatures'][0]['certificateValidity']=='not_evaluated'
    assert result['signatures'][0]['trust']=='not_evaluated'


def test_embedded_signature_without_certificate_has_unknown_name(sample):
    from asn1crypto import cms
    signature=PdfFileReader(BytesIO(sample['one'])).embedded_regular_signatures[0]
    container=cms.ContentInfo.load(signature.pkcs7_content)
    del container['content']['certificates']
    value=container.dump();padded=value+b'\0'*(len(signature.pkcs7_content)-len(value))
    without_cert=sample['one'].replace(signature.pkcs7_content.hex().upper().encode(),padded.hex().upper().encode(),1)
    assert without_cert!=sample['one']
    report=compare(sample['base'],without_cert)
    assert report['signatureCount']==1
    assert report['signatures'][0]['certificate']['subject']==''


def test_rejects_non_pdf_and_wrong_parent_hash(sample):
    with pytest.raises(Exception,match='INVALID_PDF'):engine().detect_signatures(b'not a pdf')
    with pytest.raises(Exception,match='PARENT_HASH_MISMATCH'):
        engine().compare_detected_signatures(sample['base'],sample['one'],base_sha256='0'*64)
