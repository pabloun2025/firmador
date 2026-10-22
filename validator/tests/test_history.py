import importlib
import importlib.util
from hashlib import sha256
import pytest
from validator.tests.test_inventory import sample

def inspect(pdf, parent=None):
    assert importlib.util.find_spec('validator.history'), 'historical dry-run analysis is not implemented'
    return importlib.import_module('validator.history').inspect_historical_version(
        version_id='synthetic-version', expected_hash=sha256(pdf).hexdigest() if pdf else 'a'*64,
        pdf=pdf, parent=parent)

def test_missing_file_is_not_a_validated_unsigned_document():
    result=inspect(None)
    assert result['relationship']=='not_proven'
    assert result['inventory'] is None
    assert result['status']=='file_unavailable'

def test_unsigned_original_can_be_inventoried_without_claiming_a_parent(sample):
    result=inspect(sample['base'])
    assert result['inventory']['signatures']==[]
    assert result['relationship']=='not_proven'

def test_missing_parent_does_not_hide_existing_signatures(sample):
    result=inspect(sample['one'])
    assert len(result['inventory']['signatures'])==1
    assert result['relationship']=='not_proven'

def test_available_incremental_parent_is_proven(sample):
    assert inspect(sample['two'],sample['one'])['relationship']=='verified_incremental'

def test_unrelated_parent_is_reported_without_rewriting_or_advancing(sample):
    result=inspect(sample['one'],sample['two'])
    assert result['relationship']=='not_proven'
    assert result['reason']=='NOT_INCREMENTAL_UPDATE'

def test_mismatched_stored_hash_is_never_backfilled_as_valid(sample):
    assert importlib.util.find_spec('validator.history')
    result=importlib.import_module('validator.history').inspect_historical_version(
        version_id='synthetic',expected_hash='a'*64,pdf=sample['one'],parent=None)
    assert result['inventory'] is None
    assert result['reason']=='STORED_HASH_MISMATCH'
