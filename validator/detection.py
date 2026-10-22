"""PDF signature presence and public names only. NO cryptographic validation.

Embedded CMS IDs compare presence, not authenticity, identity or preservation of
document content. Reader/parser and subprocess resource limits still apply.
"""
from hashlib import sha256
from io import BytesIO
from asn1crypto import cms
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.sign.fields import enumerate_sig_fields
from validator.inventory import InventoryFailure, MAX_BYTES, MAX_SIGNATURES

POLICY='leapsign-v1.1-signature-detection-1'


def _signer_certificate(data):
    sid=data['signer_infos'][0]['sid']
    for entry in data['certificates']:
        if entry.name!='certificate':continue
        cert=entry.chosen
        if sid.name=='issuer_and_serial_number':
            value=sid.chosen
            if cert.serial_number==value['serial_number'].native and cert.issuer.dump()==value['issuer'].dump():return cert
        elif sid.name=='subject_key_identifier' and cert.key_identifier==sid.native:return cert
    return None


def detect_signatures(pdf:bytes)->dict:
    if not isinstance(pdf,bytes) or not 5<=len(pdf)<=MAX_BYTES or not pdf.startswith(b'%PDF-'):
        raise InventoryFailure('INVALID_PDF')
    try:
        reader=PdfFileReader(BytesIO(pdf),strict=False)
        if reader.encrypted or not 1<=reader.root['/Pages']['/Count']<=500 or reader.xrefs.total_revisions>128:
            raise InventoryFailure('PDF_LIMIT_OR_ENCRYPTION')
        records=[];seen=set()
        for field,value,_ in enumerate_sig_fields(reader,filled_status=True):
            signature=value.get_object()
            if str(signature.get('/Type',''))=='/DocTimeStamp' or str(signature.get('/SubFilter',''))=='/ETSI.RFC3161':continue
            contents=signature.get('/Contents')
            if not contents:continue
            container=cms.ContentInfo.load(bytes(contents))
            if container['content_type'].native!='signed_data' or not len(container['content']['signer_infos']):
                raise InventoryFailure('SIGNATURE_NOT_READABLE')
            data=container['content'];identifier=sha256(container.dump(force=True)).hexdigest()
            if identifier in seen:raise InventoryFailure('DUPLICATE_SIGNATURE')
            seen.add(identifier)
            cert=_signer_certificate(data)
            name=str(signature.get('/Name',''))[:512]
            if cert is not None:name=str(cert.subject.native.get('common_name') or cert.subject.human_friendly)[:512]
            info=data['signer_infos'][0]
            records.append({'id':identifier,'field':str(field)[:256],'revision':reader.xrefs.total_revisions-1,
                'byteRange':[],'declaredSigningTime':None,
                'certificate':{'subject':name,'issuer':str(cert.issuer.human_friendly)[:512] if cert else '',
                    'serial':format(cert.serial_number,'x') if cert else '',
                    'fingerprint':sha256(cert.dump()).hexdigest() if cert else '',
                    'notBefore':'','notAfter':''},
                'algorithms':{'digest':str(info['digest_algorithm']['algorithm'].native)[:64],
                    'signature':str(info['signature_algorithm']['algorithm'].native)[:64]},
                'integrity':'not_evaluated','trust':'not_evaluated','revocation':'unknown',
                'certificateValidity':'not_evaluated','coverage':'not_evaluated',
                'subsequentChanges':'not_evaluated','codes':[]})
            if len(records)>MAX_SIGNATURES:raise InventoryFailure('SIGNATURE_LIMIT')
        return {'policy':POLICY,'sha256':sha256(pdf).hexdigest(),'byteSize':len(pdf),'signatures':records}
    except InventoryFailure:raise
    except Exception:raise InventoryFailure('SIGNATURE_NOT_READABLE') from None


def compare_detected_signatures(previous:bytes,candidate:bytes,*,base_sha256:str)->dict:
    if sha256(previous).hexdigest()!=base_sha256:raise InventoryFailure('PARENT_HASH_MISMATCH')
    old=detect_signatures(previous);new=detect_signatures(candidate)
    before={s['id'] for s in old['signatures']};after={s['id'] for s in new['signatures']}
    if not before.issubset(after):raise InventoryFailure('PREVIOUS_SIGNATURE_CHANGED')
    added=after-before
    if not added:raise InventoryFailure('NO_NEW_SIGNATURE')
    if len(added)!=1:raise InventoryFailure('MULTIPLE_NEW_SIGNATURES')
    return {'policy':POLICY,'accepted':True,'baseSha256':old['sha256'],'signedSha256':new['sha256'],
        'signatureCount':len(new['signatures']),'inheritedCount':len(old['signatures']),
        'addedSignatureIds':sorted(added),'previousSignaturesIntact':True,'signatures':new['signatures']}
