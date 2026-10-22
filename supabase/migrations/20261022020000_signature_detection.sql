-- Detection-only policy; retain original integrity reports and rollback compatibility.
alter table public.version_signature_inventories drop constraint version_signature_inventories_policy_check;
alter table public.version_signature_inventories add constraint version_signature_inventories_policy_check
  check (policy in ('leapsign-v1.1-integrity-offline-1','leapsign-v1.1-signature-detection-1'));
alter table public.version_signature_inventories drop constraint version_signature_inventories_relationship_check;
alter table public.version_signature_inventories add constraint version_signature_inventories_relationship_check
  check ((policy='leapsign-v1.1-integrity-offline-1' and relationship='verified_incremental')
    or (policy='leapsign-v1.1-signature-detection-1' and relationship='signatures_detected'));

create or replace function public.commit_signature_validation(p_claim_id uuid,p_lease_token uuid,p_report jsonb,p_page_count integer,p_page_dimensions jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r public.signature_validation_receipts; w public.workflows; i public.round_invitations;
  accepted jsonb; version uuid; item jsonb; added text; ids text[]; known_ids text[];
begin
  -- Lock order is settings -> workflow -> receipt -> invitation, like begin.
  select * into r from public.signature_validation_receipts where id=p_claim_id;
  if r.id is null or r.lease_token is distinct from p_lease_token then raise exception 'VALIDATION_LEASE_EXPIRED'; end if;
  if r.state='accepted' then return public.get_signature_receipt(r.workflow_id,r.session_hash,r.signed_sha256); end if;
  perform 1 from public.signature_inventory_settings where singleton and enabled for share;
  if not found then raise exception 'INVENTORY_DISABLED'; end if;
  select * into w from public.workflows where id=r.workflow_id for update;
  select * into r from public.signature_validation_receipts where id=p_claim_id for update;
  if r.lease_token is distinct from p_lease_token then raise exception 'VALIDATION_LEASE_EXPIRED'; end if;
  if r.state='accepted' then return public.get_signature_receipt(r.workflow_id,r.session_hash,r.signed_sha256); end if;
  if r.lease_expires_at<=now() then raise exception 'VALIDATION_LEASE_EXPIRED'; end if;
  if w.status<>'active' or w.current_version_id is distinct from r.parent_version_id then raise exception 'TURN_UNAVAILABLE'; end if;
  if r.invitation_id is not null then
    select * into i from public.round_invitations where id=r.invitation_id for update;
    if i.status<>'opened' or i.expires_at<=now() or i.session_hash is distinct from r.session_hash then raise exception 'INVITATION_UNAVAILABLE'; end if;
  end if;
  if p_report is null or jsonb_typeof(p_report)<>'object' or octet_length(p_report::text)>262144
    or coalesce(p_report->>'policy','') not in ('leapsign-v1.1-integrity-offline-1','leapsign-v1.1-signature-detection-1')
    or p_report->'accepted' is distinct from 'true'::jsonb or p_report->'previousSignaturesIntact' is distinct from 'true'::jsonb
    or p_report->>'baseSha256' is distinct from r.base_sha256 or p_report->>'signedSha256' is distinct from r.signed_sha256
    or jsonb_typeof(p_report->'signatures') is distinct from 'array'
    or jsonb_typeof(p_report->'addedSignatureIds') is distinct from 'array'
    or (p_report->>'signatureCount') !~ '^[0-9]+$' or (p_report->>'inheritedCount') !~ '^[0-9]+$'
    or p_page_count is null or p_page_count not between 1 and 500 or jsonb_typeof(p_page_dimensions) is distinct from 'array'
    then raise exception 'INVALID_INVENTORY_REPORT'; end if;
  if (p_report->>'signatureCount')::integer not between 1 and 64
    or (p_report->>'inheritedCount')::integer not between 0 and 63
    or (p_report->>'signatureCount')::integer<>(p_report->>'inheritedCount')::integer+1
    or jsonb_array_length(p_report->'signatures')<>(p_report->>'signatureCount')::integer
    or jsonb_array_length(p_report->'addedSignatureIds')<>1
    or jsonb_array_length(p_page_dimensions)<>p_page_count then raise exception 'INVALID_INVENTORY_REPORT'; end if;
  added:=p_report->'addedSignatureIds'->>0;
  if added is null or added !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_INVENTORY_REPORT'; end if;
  for item in select value from jsonb_array_elements(p_report->'signatures') loop
    if item->>'id' is null or item->>'id' !~ '^[a-f0-9]{64}$'
      or (p_report->>'policy'='leapsign-v1.1-integrity-offline-1' and
        (item->>'integrity' is distinct from 'valid' or item->>'subsequentChanges' is distinct from 'allowed'
          or (item->>'id'=added and item->>'coverage' is distinct from 'entire_file')))
      or (p_report->>'policy'='leapsign-v1.1-signature-detection-1' and
        (item->>'integrity' is distinct from 'not_evaluated'
          or item->>'subsequentChanges' is distinct from 'not_evaluated'
          or item->>'coverage' is distinct from 'not_evaluated')) then raise exception 'INVALID_INVENTORY_REPORT'; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  if not(added=any(ids)) or (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'INVALID_INVENTORY_REPORT'; end if;
  select array_agg(signature_id order by signature_id) into known_ids from public.version_pdf_signatures where version_id=r.parent_version_id;
  if known_ids is not null and (select array_agg(x order by x) from unnest(ids) x where x<>added) is distinct from known_ids then raise exception 'INHERITED_SIGNATURES_CHANGED'; end if;
  update public.signature_validation_receipts set state='validating',report=p_report where id=r.id;
  insert into public.signature_submissions(id,workflow_id,parent_version_id,storage_path,sha256,byte_size,submitted_by_session_hash,status,validation_summary,page_count,page_dimensions)
    values(r.id,r.workflow_id,r.parent_version_id,r.storage_path,r.signed_sha256,r.byte_size,r.session_hash,'uploaded',
      jsonb_build_object('mode',case when p_report->>'policy'='leapsign-v1.1-signature-detection-1' then 'signature_detection' else 'cryptographic_inventory' end,'policy',p_report->>'policy','receipt_id',r.id),p_page_count,p_page_dimensions);
  accepted:=public.accept_open_signed_submission(r.workflow_id,r.session_hash,r.id);
  if accepted->>'ok' is distinct from 'true' or accepted->>'version_id' is null then raise exception 'ACCEPTANCE_UNAVAILABLE'; end if;
  version:=(accepted->>'version_id')::uuid;
  insert into public.version_signature_inventories(version_id,workflow_id,receipt_id,policy,signature_count,inherited_count,added_signature_id,relationship)
    values(version,r.workflow_id,r.id,p_report->>'policy',(p_report->>'signatureCount')::integer,(p_report->>'inheritedCount')::integer,added,case when p_report->>'policy'='leapsign-v1.1-signature-detection-1' then 'signatures_detected' else 'verified_incremental' end);
  insert into public.version_pdf_signatures(version_id,workflow_id,signature_id,record)
    select version,r.workflow_id,value->>'id',value from jsonb_array_elements(p_report->'signatures');
  if r.invitation_id is not null then
    update public.round_invitations set status='completed',completed_at=now() where id=r.invitation_id;
  end if;
  delete from public.file_cleanup_jobs where storage_path=r.storage_path and reason='uncommitted_validation';
  update public.signature_validation_receipts set state='accepted',version_id=version,accepted_at=now() where id=r.id;
  return public.get_signature_receipt(r.workflow_id,r.session_hash,r.signed_sha256);
end $$;

-- Only before upload. Never release a committing or accepted receipt.
create function public.release_signature_validation(p_claim_id uuid,p_lease_token uuid)
returns void language sql security definer set search_path=public as $$
  update public.signature_validation_receipts set lease_expires_at=now()
    where id=p_claim_id and lease_token=p_lease_token and state='reserved'
$$;
revoke all on function public.release_signature_validation(uuid,uuid) from public,anon,authenticated;
grant execute on function public.release_signature_validation(uuid,uuid) to service_role;
