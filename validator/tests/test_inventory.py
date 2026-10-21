"""Synthetic certificates only. No P12 files, real users, network or v2 imports."""
import importlib
import importlib.util
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from io import BytesIO
import pytest
from asn1crypto import keys, x509 as asn1x509
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from pyhanko.pdf_utils.incremental_writer import IncrementalPdfFileWriter
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils import generic
from pyhanko.sign import fields, signers
from pyhanko_certvalidator.registry import SimpleCertificateStore
from reportlab.pdfgen import canvas


def engine():
    assert importlib.util.find_spec('validator.inventory'), 'v1.1 inventory engine is not implemented'
    return importlib.import_module('validator.inventory')


@pytest.fixture(scope='module', params=['EC', 'ES'])
def sample(request):
    now = datetime.now(timezone.utc)
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COUNTRY_NAME, request.param),
                         x509.NameAttribute(NameOID.COMMON_NAME, 'TEST ONLY v1.1 CA')])
    ca = (x509.CertificateBuilder().subject_name(ca_name).issuer_name(ca_name)
          .public_key(ca_key.public_key()).serial_number(x509.random_serial_number())
          .not_valid_before(now-timedelta(days=3)).not_valid_after(now+timedelta(days=3))
          .add_extension(x509.BasicConstraints(ca=True, path_length=0), critical=True)
          .sign(ca_key, hashes.SHA256()))

    def identity(expired=False):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cert = (x509.CertificateBuilder().subject_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Persona sintetica')]))
                .issuer_name(ca_name).public_key(key.public_key()).serial_number(x509.random_serial_number())
                .not_valid_before(now-timedelta(days=2)).not_valid_after(now+timedelta(days=-1 if expired else 2))
                .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
                .add_extension(x509.KeyUsage(True, True, False, False, False, False, False, None, None), critical=True)
                .sign(ca_key, hashes.SHA256()))
        registry = SimpleCertificateStore(); registry.register(asn1x509.Certificate.load(ca.public_bytes(serialization.Encoding.DER)))
        return signers.SimpleSigner(signing_cert=asn1x509.Certificate.load(cert.public_bytes(serialization.Encoding.DER)),
            signing_key=keys.PrivateKeyInfo.load(key.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())), cert_registry=registry)

    out = BytesIO(); page = canvas.Canvas(out, pagesize=(595,842))
    page.drawString(40,740,'Original de prueba v1.1'); page.showPage(); page.drawString(40,740,'Pagina dos'); page.save()
    base = out.getvalue()
    assert '/AcroForm' not in PdfFileReader(BytesIO(base)).root
    signer = identity()

    def sign(pdf, number=1, changed=False, expired=False, remove_prior=False):
        writer = IncrementalPdfFileWriter(BytesIO(pdf))
        if changed: writer.add_stream_to_page(0,writer.add_object(generic.StreamObject(stream_data=b'0 0 100 100 re f')))
        if remove_prior:
            form=writer.root['/AcroForm']; form[generic.pdf_name('/Fields')]=generic.ArrayObject(); writer.update_container(form)
        return signers.sign_pdf(writer,signers.PdfSignatureMetadata(field_name=f'Signature_{number}',subfilter=fields.SigSeedSubFilter.PADES),identity(True) if expired else signer,
            new_field_spec=fields.SigFieldSpec(f'Signature_{number}',on_page=1,box=(320,20+90*(number-1),570,100+90*(number-1)))).getvalue()
    one=sign(base); two=sign(one,2); three=sign(two,3)
    return dict(base=base,one=one,two=two,three=three,sign=sign)


def compare(sample, previous='base', candidate='one', **kwargs):
    before=sample[previous] if isinstance(previous,str) else previous
    after=sample[candidate] if isinstance(candidate,str) else candidate
    return engine().compare_signed_pdfs(before,after,base_sha256=sha256(before).hexdigest(),**kwargs)


def test_unsigned_inventory(sample):
    result=engine().inventory_pdf(sample['base'])
    assert result['signatures']==[] and result['sha256']==sha256(sample['base']).hexdigest()


@pytest.mark.parametrize('previous,candidate,count',[('base','one',1),('one','two',2),('two','three',3)])
def test_incremental_signatures_without_rewriting_original(sample,previous,candidate,count):
    before=sample[previous]; after=sample[candidate]; snapshots=(bytes(before),bytes(after))
    result=compare(sample,previous,candidate)
    assert result['accepted'] is True and result['signatureCount']==count
    assert result['inheritedCount']==count-1 and len(result['addedSignatureIds'])==1
    assert result['previousSignaturesIntact'] is True
    assert (before,after)==snapshots


def test_trust_unknown_does_not_become_bad_signature(sample):
    signature=compare(sample)['signatures'][0]
    assert signature['integrity']=='valid'
    assert signature['trust']=='not_evaluated'
    assert signature['revocation']=='unknown'
    assert signature['certificateValidity']=='valid_now'
    assert len(signature['id'])==64 and len(signature['certificate']['fingerprint'])==64
    assert signature['coverage']=='entire_file'
    assert signature['algorithms']['digest']=='sha256'
    assert signature['byteRange'][0]==0
    assert signature['certificate']['subject']


def test_expired_certificate_separate_from_integrity(sample):
    result=compare(sample,candidate=sample['sign'](sample['base'],expired=True))
    assert result['accepted'] is True
    assert result['signatures'][0]['integrity']=='valid'
    assert result['signatures'][0]['certificateValidity']=='expired'
    assert result['signatures'][0]['trust']=='not_evaluated'


def test_stable_inherited_ids(sample):
    a=engine().inventory_pdf(sample['one'])['signatures'][0]
    b=compare(sample,'one','two')['signatures'][0]
    assert a['id']==b['id'] and a['byteRange']==b['byteRange']
    assert b['coverage']=='entire_revision'


@pytest.mark.parametrize('kind',['identical','two_new','other','tampered','unsigned_tail','not_pdf','removed_prior','content_replacement'])
def test_rejects_unacceptable_candidate(sample,kind):
    before=sample['base']
    after={'identical':before,'two_new':sample['two'],'other':sample['one'].replace(b'Original de prueba',b'Original de XXXXXX'),
           'tampered':sample['one'].replace(b'/ByteRange',b'/ByteRangX',1),'unsigned_tail':sample['one']+b'\n% unsigned tail',
           'not_pdf':b'hello','removed_prior':sample['sign'](sample['one'],2,remove_prior=True),
           'content_replacement':sample['sign'](before,changed=True)}[kind]
    if kind=='other':
        # A different valid PDF from another process, not a filename substitution.
        out=BytesIO(); c=canvas.Canvas(out); c.drawString(30,700,'Other process');c.save();before=out.getvalue()
    if kind=='removed_prior':before=sample['one']
    with pytest.raises(engine().InventoryFailure):
        engine().compare_signed_pdfs(before,after,base_sha256=sha256(before).hexdigest())


def test_wrong_parent_hash(sample):
    with pytest.raises(engine().InventoryFailure,match='PARENT_HASH_MISMATCH'):
        engine().compare_signed_pdfs(sample['base'],sample['one'],base_sha256='0'*64)


def test_corrupt_signature_value(sample):
    reader=PdfFileReader(BytesIO(sample['one'])); sig=reader.embedded_regular_signatures[0]
    signature=sig.signer_info['signature'].native.hex().upper().encode()
    damaged=sample['one'].replace(signature, (b'00' if signature[:2]!=b'00' else b'01')+signature[2:],1)
    assert damaged!=sample['one']
    with pytest.raises(engine().InventoryFailure):compare(sample,candidate=damaged)


def test_invalid_byte_range(sample):
    after=sample['one']; start=after.index(b'/ByteRange'); end=after.index(b']',start)
    altered=after[:start]+after[start:end].replace(b'0 ',b'1 ',1)+after[end:]
    assert altered!=after
    with pytest.raises(engine().InventoryFailure):compare(sample,candidate=altered)


def test_no_certificate_container_or_secret_in_report(sample):
    import json
    result=json.dumps(compare(sample))
    for forbidden in ['PRIVATE KEY','password','signing_key','pkcs12','pfx']:
        assert forbidden not in result


def test_rejects_bad_input_and_excess_size():
    for bad in [b'not a PDF',b'%PDF-broken',b'%PDF-'+b'x'*(10*1024*1024)]:
        with pytest.raises(engine().InventoryFailure):engine().inventory_pdf(bad)
