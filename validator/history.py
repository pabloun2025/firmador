"""Historical analysis only: no persistence, mail, turn or PDF mutation."""
from hashlib import sha256
from validator.inventory import inventory_pdf, compare_signed_pdfs, InventoryFailure


def inspect_historical_version(*, version_id, expected_hash, pdf, parent=None):
    result={'versionId':version_id,'sha256':expected_hash,'status':'file_unavailable',
            'relationship':'not_proven','reason':'FILE_UNAVAILABLE','inventory':None}
    if pdf is None:
        return result
    if sha256(pdf).hexdigest()!=expected_hash:
        result['reason']='STORED_HASH_MISMATCH'
        return result
    try:
        result['inventory']=inventory_pdf(pdf)
        result['status']='inventoried'
        result['reason']='PARENT_UNAVAILABLE'
        if parent is not None:
            try:
                compare_signed_pdfs(parent,pdf,base_sha256=sha256(parent).hexdigest())
                result['relationship']='verified_incremental'
                result['reason']=None
            except InventoryFailure as error:
                result['reason']=str(error)
    except InventoryFailure as error:
        result['status']='unverifiable'
        result['reason']=str(error)
    return result
