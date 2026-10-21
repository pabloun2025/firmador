"""v1-only offline PDF/CMS inventory. No trust roots, network, keys or rewrites.

Integrity is NOT certificate trust, revocation, identity or legal validity.
Call only inside a private resource-bounded worker, never on the web event loop.
"""
from datetime import datetime, timezone
from hashlib import sha256
from io import BytesIO
import re
from asn1crypto import cms
from pyhanko.pdf_utils.reader import PdfFileReader
from pyhanko.pdf_utils import generic
from pyhanko.sign.diff_analysis import DEFAULT_DIFF_POLICY, ModificationLevel, SuspiciousModification
from pyhanko.sign.validation.generic_cms import validate_sig_integrity
from pyhanko.sign.validation.status import SignatureCoverageLevel
from pyhanko.sign.validation.utils import DEFAULT_ALGORITHM_USAGE_POLICY

POLICY = 'leapsign-v1.1-integrity-offline-1'
MAX_BYTES = 10 * 1024 * 1024
MAX_SIGNATURES = 64


class InventoryFailure(Exception):
    """Public fixed code only; never propagate parser/certificate exceptions."""


def _reader(pdf):
    if not isinstance(pdf, bytes) or not 5 <= len(pdf) <= MAX_BYTES or not pdf.startswith(b'%PDF-'):
        raise InventoryFailure('INVALID_PDF')
    try:
        reader = PdfFileReader(BytesIO(pdf), strict=True)
        if reader.encrypted or not 1 <= reader.root['/Pages']['/Count'] <= 500 or reader.xrefs.total_revisions > 128:
            raise InventoryFailure('PDF_LIMIT_OR_ENCRYPTION')
        # Parsed historical objects, not substrings in text or CMS payloads.
        forbidden = {'/JavaScript','/JS','/Launch','/EmbeddedFile','/EmbeddedFiles','/RichMedia','/RichMediaContent','/XFA','/GoToR','/GoToE','/SubmitForm','/ImportData'}
        visits=0
        for revision in range(reader.xrefs.total_revisions):
            resolver=reader.get_historical_resolver(revision)
            pending=list(reader.xrefs.explicit_refs_in_revision(revision)); seen=set()
            while pending:
                visits+=1
                if visits>200_000: raise InventoryFailure('PDF_COMPLEXITY_LIMIT')
                value=pending.pop()
                if isinstance(value,(generic.Reference,generic.IndirectObject)):
                    ref=value.reference if isinstance(value,generic.IndirectObject) else value
                    key=(ref.idnum,ref.generation)
                    if key in seen: continue
                    seen.add(key); pending.append(resolver.get_object(ref))
                elif isinstance(value,generic.NameObject) and str(value) in forbidden:
                    raise InventoryFailure('ACTIVE_PDF_CONTENT')
                elif isinstance(value,generic.DictionaryObject):
                    for k,v in value.items(): pending.extend((k,v))
                elif isinstance(value,generic.ArrayObject): pending.extend(value)
        return reader
    except InventoryFailure: raise
    except Exception: raise InventoryFailure('INVALID_PDF') from None


def _bounded_text(value,limit=512):
    return str(value)[:limit]


def _inventory(reader, pdf):
    signatures=reader.embedded_regular_signatures
    if len(signatures)>MAX_SIGNATURES: raise InventoryFailure('SIGNATURE_LIMIT')
    records=[]; seen=set()
    for sig in signatures:
        try:
            br=list(sig.byte_range)
            if len(br)!=4 or any(not isinstance(x,generic.NumberObject) for x in br):
                raise InventoryFailure('INVALID_BYTE_RANGE')
            br=[int(x) for x in br]; zero,left,right,last=br
            if zero!=0 or left<=0 or right<=left or last<=0 or right+last>len(pdf):
                raise InventoryFailure('INVALID_BYTE_RANGE')
            gap=pdf[left:right]
            if not re.fullmatch(rb'<[0-9a-fA-F\s]+>',gap) or bytes.fromhex(gap[1:-1].decode('ascii'))!=sig.pkcs7_content:
                raise InventoryFailure('INVALID_BYTE_RANGE')
            if str(sig.sig_object.get('/SubFilter','')) not in ('/adbe.pkcs7.detached','/ETSI.CAdES.detached'):
                raise InventoryFailure('SIGNATURE_FORMAT_UNSUPPORTED')
            container=cms.ContentInfo.load(sig.pkcs7_content)
            encoded=container.dump()
            if any(sig.pkcs7_content[len(encoded):]) or container['content_type'].native!='signed_data':
                raise InventoryFailure('INVALID_CMS')
            if len(sig.signed_data['signer_infos'])!=1 or sig.signed_data['encap_content_info']['content_type'].native!='data':
                raise InventoryFailure('INVALID_CMS')
            if sig.signed_data['encap_content_info']['content'].native is not None:
                raise InventoryFailure('INVALID_CMS')
            identifier=sha256(container.dump(force=True)).hexdigest()
            if identifier in seen: raise InventoryFailure('DUPLICATE_SIGNATURE')
            seen.add(identifier)
            cert=sig.signer_cert
            intact,valid=validate_sig_integrity(sig.signer_info,cert,'data',sig.compute_digest(),
                algorithm_usage_policy=DEFAULT_ALGORITHM_USAGE_POLICY,time_indic=datetime.now(timezone.utc))
            coverage=sig.evaluate_signature_coverage()
            if coverage not in (SignatureCoverageLevel.ENTIRE_FILE,SignatureCoverageLevel.ENTIRE_REVISION):
                raise InventoryFailure('INCOMPLETE_SIGNATURE_COVERAGE')
            sig.compute_integrity_info()
            changes_ok=not isinstance(sig.diff_result,SuspiciousModification) and (
                sig.diff_result is None or sig.diff_result.modification_level<=ModificationLevel.FORM_FILLING)
            if sig.summarise_integrity_info().get('docmdp_ok') is False: changes_ok=False
            start=cert['tbs_certificate']['validity']['not_before'].native
            end=cert['tbs_certificate']['validity']['not_after'].native
            now=datetime.now(timezone.utc)
            declared=[]
            for attribute in sig.signer_info['signed_attrs']:
                if attribute['type'].native=='signing_time':
                    declared.extend(v.native for v in attribute['values'])
            if len(declared)>1: raise InventoryFailure('INVALID_CMS')
            records.append({'id':identifier,'field':_bounded_text(sig.field_name,256),'revision':sig.signed_revision,
                'byteRange':br,'declaredSigningTime':declared[0].isoformat() if declared else None,
                'certificate':{'subject':_bounded_text(cert.subject.human_friendly),'issuer':_bounded_text(cert.issuer.human_friendly),
                    'serial':format(cert.serial_number,'x'),'fingerprint':sha256(cert.dump()).hexdigest(),
                    'notBefore':start.isoformat(),'notAfter':end.isoformat()},
                'algorithms':{'digest':sig.md_algorithm,'signature':sig.signer_info['signature_algorithm']['algorithm'].native},
                'integrity':'valid' if intact and valid else 'invalid',
                'trust':'not_evaluated','revocation':'unknown',
                'certificateValidity':'not_yet_valid' if now<start else 'expired' if now>end else 'valid_now',
                'coverage':'entire_file' if coverage==SignatureCoverageLevel.ENTIRE_FILE else 'entire_revision',
                'subsequentChanges':'allowed' if changes_ok else 'not_allowed',
                'codes':[] if changes_ok else ['SUBSEQUENT_CHANGES_NOT_ALLOWED']})
        except InventoryFailure: raise
        except Exception: raise InventoryFailure('INVALID_SIGNATURE_STRUCTURE') from None
    return {'policy':POLICY,'sha256':sha256(pdf).hexdigest(),'byteSize':len(pdf),'signatures':records}


def inventory_pdf(pdf: bytes) -> dict:
    """Public metadata only. Unverifiable/malformed PDFs fail, never invent IDs."""
    try: return _inventory(_reader(pdf),pdf)
    except InventoryFailure: raise
    except Exception: raise InventoryFailure('INVALID_PDF') from None


def compare_signed_pdfs(previous: bytes,candidate: bytes,*,base_sha256: str) -> dict:
    if sha256(previous).hexdigest()!=base_sha256: raise InventoryFailure('PARENT_HASH_MISMATCH')
    if len(candidate)<=len(previous) or not candidate.startswith(previous): raise InventoryFailure('NOT_INCREMENTAL_UPDATE')
    before=_reader(previous); after=_reader(candidate)
    try:
        old=_inventory(before,previous); new=_inventory(after,candidate)
        if len(new['signatures'])!=len(old['signatures'])+1: raise InventoryFailure('ONE_NEW_SIGNATURE_REQUIRED')
        old_by_id={s['id']:s for s in old['signatures']}; new_by_id={s['id']:s for s in new['signatures']}
        for identifier,original in old_by_id.items():
            retained=new_by_id.get(identifier)
            if not retained or retained['byteRange']!=original['byteRange'] or retained['field']!=original['field']:
                raise InventoryFailure('PREVIOUS_SIGNATURE_CHANGED')
        added=[s for s in new['signatures'] if s['id'] not in old_by_id]
        if len(added)!=1: raise InventoryFailure('ONE_NEW_SIGNATURE_REQUIRED')
        if any(s['integrity']!='valid' for s in old['signatures']+new['signatures']): raise InventoryFailure('CRYPTOGRAPHIC_INTEGRITY_FAILED')
        if any(s['subsequentChanges']!='allowed' for s in new['signatures']): raise InventoryFailure('CONTENT_CHANGED')
        if added[0]['coverage']!='entire_file': raise InventoryFailure('INCOMPLETE_SIGNATURE_COVERAGE')
        # Compare against the EXACT unsigned/signed revision delivered, not only
        # against old signatures. This also protects the very first signer.
        base_revision=after.get_historical_resolver(before.xrefs.total_revisions-1)
        if '/AcroForm' not in base_revision.root:
            # pyHanko 0.29's form rule compares dicts and otherwise raises on
            # an absent old AcroForm. Supply an EMPTY form in this resolver's
            # private parsed cache, not in either PDF or the current revision.
            # All field, catalog, page and reference-diff rules still run.
            base_revision.root[generic.pdf_name('/AcroForm')]=generic.DictionaryObject({
                generic.pdf_name('/Fields'):generic.ArrayObject(),
                generic.pdf_name('/SigFlags'):generic.NumberObject(3)})
        diff=DEFAULT_DIFF_POLICY.review_file(after,base_revision)
        if isinstance(diff,SuspiciousModification) or diff.modification_level>ModificationLevel.FORM_FILLING:
            raise InventoryFailure('CONTENT_CHANGED')
        if diff.changed_form_fields-{added[0]['field']}: raise InventoryFailure('UNAUTHORIZED_FORM_CHANGES')
        if before.root['/Pages']['/Count']!=after.root['/Pages']['/Count']: raise InventoryFailure('CONTENT_CHANGED')
        return {'policy':POLICY,'accepted':True,'baseSha256':old['sha256'],'signedSha256':new['sha256'],
            'signatureCount':len(new['signatures']),'inheritedCount':len(old['signatures']),
            'addedSignatureIds':[s['id'] for s in added],'previousSignaturesIntact':True,'signatures':new['signatures']}
    except InventoryFailure: raise
    except Exception: raise InventoryFailure('COMPARISON_FAILED') from None
