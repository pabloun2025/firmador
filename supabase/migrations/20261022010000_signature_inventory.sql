-- Additive v1.1 inventory. Disabled until authenticated runtime and live gates pass.
create table public.signature_inventory_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false
);
insert into public.signature_inventory_settings(singleton) values(true);

create table public.signature_validation_receipts (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  parent_version_id uuid not null references public.document_versions(id) on delete restrict,
  session_hash text not null check (session_hash ~ '^[a-f0-9]{64}$'),
  base_sha256 text not null check (base_sha256 ~ '^[a-f0-9]{64}$'),
  signed_sha256 text not null check (signed_sha256 ~ '^[a-f0-9]{64}$'),
  byte_size integer not null check (byte_size between 5 and 10485760),
  state text not null default 'reserved' check (state in ('reserved','validating','accepted')),
  lease_token uuid not null default gen_random_uuid(),
  lease_expires_at timestamptz not null default now()+interval '120 seconds',
  attempts smallint not null default 1 check (attempts between 1 and 3),
  storage_path text not null unique,
  invitation_id uuid references public.round_invitations(id) on delete set null,
  report jsonb,
  version_id uuid unique references public.document_versions(id) on delete restrict,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique(workflow_id,parent_version_id),
  unique(workflow_id,session_hash,signed_sha256),
  check ((state='accepted') = (version_id is not null and accepted_at is not null))
);
create table public.version_signature_inventories (
  version_id uuid primary key references public.document_versions(id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  receipt_id uuid not null unique references public.signature_validation_receipts(id) on delete cascade,
  policy text not null check (policy='leapsign-v1.1-integrity-offline-1'),
  signature_count smallint not null check (signature_count between 1 and 64),
  inherited_count smallint not null check (inherited_count between 0 and 63),
  added_signature_id text not null check (added_signature_id ~ '^[a-f0-9]{64}$'),
  relationship text not null default 'verified_incremental' check (relationship='verified_incremental'),
  created_at timestamptz not null default now(),
  check (signature_count=inherited_count+1)
);
create table public.version_pdf_signatures (
  version_id uuid not null references public.version_signature_inventories(version_id) on delete cascade,
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  signature_id text not null check (signature_id ~ '^[a-f0-9]{64}$'),
  record jsonb not null check (jsonb_typeof(record)='object' and record->>'id'=signature_id),
  primary key(version_id,signature_id)
);
create index version_signature_inventory_workflow_idx on public.version_signature_inventories(workflow_id);
create index version_pdf_signatures_workflow_idx on public.version_pdf_signatures(workflow_id,version_id);

alter table public.signature_inventory_settings enable row level security;
alter table public.signature_validation_receipts enable row level security;
alter table public.version_signature_inventories enable row level security;
alter table public.version_pdf_signatures enable row level security;
revoke all on public.signature_inventory_settings,public.signature_validation_receipts,public.version_signature_inventories,public.version_pdf_signatures from public,anon,authenticated;
grant select on public.version_signature_inventories,public.version_pdf_signatures to authenticated;
grant all on public.signature_inventory_settings,public.signature_validation_receipts,public.version_signature_inventories,public.version_pdf_signatures to service_role;
create policy inventory_owner_read on public.version_signature_inventories for select to authenticated
  using(exists(select 1 from public.workflows w where w.id=workflow_id and w.owner_id=auth.uid()));
create policy pdf_signature_owner_read on public.version_pdf_signatures for select to authenticated
  using(exists(select 1 from public.workflows w where w.id=workflow_id and w.owner_id=auth.uid()));

create function public.prevent_signature_inventory_update() returns trigger
language plpgsql set search_path=public as $$
begin
  if tg_table_name<>'signature_validation_receipts' then
    raise exception 'SIGNATURE_INVENTORY_IMMUTABLE';
  end if;
  if old.state='accepted' then
    raise exception 'SIGNATURE_INVENTORY_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger inventory_immutable before update on public.version_signature_inventories
  for each row execute function public.prevent_signature_inventory_update();
create trigger signatures_immutable before update on public.version_pdf_signatures
  for each row execute function public.prevent_signature_inventory_update();
create trigger receipt_immutable before update on public.signature_validation_receipts
  for each row execute function public.prevent_signature_inventory_update();

-- A receipt can be recovered with the original session capability even after the
-- workflow is completed or its old turn expired. No certificate/actor data here.
create function public.get_signature_receipt(p_workflow_id uuid,p_session_hash text,p_signed_sha256 text)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('state','accepted','receipt_id',r.id,'version_id',r.version_id,
    'sha256',r.signed_sha256,'accepted_at',r.accepted_at,'policy',r.report->>'policy',
    'signature_count',(r.report->>'signatureCount')::integer)
  from public.signature_validation_receipts r where r.workflow_id=p_workflow_id
    and r.session_hash=p_session_hash and r.signed_sha256=p_signed_sha256 and r.state='accepted'
$$;

create function public.begin_signature_validation(p_workflow_id uuid,p_session_hash text,p_parent_id uuid,p_signed_sha256 text,p_byte_size integer)
returns jsonb language plpgsql security definer set search_path=public as $$
declare w public.workflows; l public.open_round_locks; r public.signature_validation_receipts;
  parent public.document_versions; invitation public.round_invitations; result jsonb; claim_id uuid; lease uuid;
begin
  select public.get_signature_receipt(p_workflow_id,p_session_hash,p_signed_sha256) into result;
  if result is not null then return result; end if;
  perform 1 from public.signature_inventory_settings where singleton and enabled for share;
  if not found then raise exception 'INVENTORY_DISABLED'; end if;
  if p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$'
    or p_signed_sha256 is null or p_signed_sha256 !~ '^[a-f0-9]{64}$'
    or p_byte_size is null or p_byte_size not between 5 and 10485760 then raise exception 'INVALID_SUBMISSION'; end if;
  select * into w from public.workflows where id=p_workflow_id for update;
  -- Recheck after acquiring workflow serialization (another transaction may have committed).
  select public.get_signature_receipt(p_workflow_id,p_session_hash,p_signed_sha256) into result;
  if result is not null then return result; end if;
  select * into l from public.open_round_locks where workflow_id=p_workflow_id for update;
  if w.id is null or w.status<>'active' or w.current_version_id is distinct from p_parent_id
    or l.workflow_id is null or l.holder_session_hash<>p_session_hash or l.expires_at<=now()
    or l.reviewed_version_at is null or l.version_id_at_claim is distinct from p_parent_id then raise exception 'TURN_UNAVAILABLE'; end if;
  select * into invitation from public.round_invitations where workflow_id=p_workflow_id and session_hash=p_session_hash for update;
  if invitation.id is not null and (invitation.status<>'opened' or invitation.expires_at<=now()) then raise exception 'INVITATION_UNAVAILABLE'; end if;
  select * into parent from public.document_versions where id=p_parent_id and workflow_id=p_workflow_id and discarded_at is null;
  if parent.id is null or parent.sha256=p_signed_sha256 then raise exception 'INVALID_PARENT'; end if;
  select * into r from public.signature_validation_receipts where workflow_id=p_workflow_id and parent_version_id=p_parent_id for update;
  claim_id:=coalesce(r.id,gen_random_uuid()); lease:=gen_random_uuid();
  if r.id is not null then
    if r.state='accepted' then raise exception 'TURN_UNAVAILABLE'; end if;
    if r.lease_expires_at>now() then raise exception 'VALIDATION_IN_PROGRESS'; end if;
    if r.attempts>=3 then raise exception 'VALIDATION_ATTEMPTS_EXHAUSTED'; end if;
    -- A previous path may contain an upload with uncertain outcome. Retain it in
    -- bounded cleanup, never overwrite or delete a possibly accepted object.
    insert into public.file_cleanup_jobs(workflow_id,storage_path,reason,scheduled_for)
      values(p_workflow_id,r.storage_path,'validation_lease_expired',now()+interval '48 hours') on conflict(storage_path) do nothing;
    update public.signature_validation_receipts set session_hash=p_session_hash,signed_sha256=p_signed_sha256,byte_size=p_byte_size,
      state='reserved',lease_token=lease,lease_expires_at=now()+interval '120 seconds',attempts=attempts+1,report=null,invitation_id=invitation.id,
      storage_path=p_workflow_id||'/submissions/'||claim_id||'/'||lease||'.pdf'
      where id=claim_id returning * into r;
  else
    insert into public.signature_validation_receipts(id,workflow_id,parent_version_id,session_hash,base_sha256,signed_sha256,byte_size,lease_token,storage_path,invitation_id)
      values(claim_id,p_workflow_id,p_parent_id,p_session_hash,parent.sha256,p_signed_sha256,p_byte_size,lease,
        p_workflow_id||'/submissions/'||claim_id||'/'||lease||'.pdf',invitation.id) returning * into r;
  end if;
  -- Bounded quarantine cleanup even if the uploader never retries. Commit removes
  -- this job atomically before the object becomes an accepted version.
  insert into public.file_cleanup_jobs(workflow_id,storage_path,reason,scheduled_for)
    values(r.workflow_id,r.storage_path,'uncommitted_validation',now()+interval '48 hours') on conflict(storage_path) do nothing;
  return jsonb_build_object('state','reserved','claim_id',r.id,'lease_token',r.lease_token,'storage_path',r.storage_path);
end $$;

-- Defense in depth: even the old acceptance RPC cannot create a new child when
-- enabled without a report staged by the service-only atomic commit below.
create function public.enforce_signature_inventory_acceptance() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  perform 1 from public.signature_inventory_settings where singleton and enabled for share;
  if not found or new.parent_version_id is null then return new; end if;
  if not exists(select 1 from public.signature_validation_receipts r
    where r.workflow_id=new.workflow_id and r.parent_version_id=new.parent_version_id
      and r.session_hash=new.submitted_by_session_hash and r.signed_sha256=new.sha256
      and r.storage_path=new.storage_path and r.byte_size=new.byte_size
      and r.state='validating' and r.report->>'accepted'='true') then
    raise exception 'SIGNATURE_INVENTORY_REQUIRED';
  end if;
  return new;
end $$;
create trigger require_signature_inventory before insert on public.document_versions
  for each row execute function public.enforce_signature_inventory_acceptance();

create function public.commit_signature_validation(p_claim_id uuid,p_lease_token uuid,p_report jsonb,p_page_count integer,p_page_dimensions jsonb)
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
    or p_report->>'policy' is distinct from 'leapsign-v1.1-integrity-offline-1'
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
      or item->>'integrity' is distinct from 'valid' or item->>'subsequentChanges' is distinct from 'allowed'
      or (item->>'id'=added and item->>'coverage' is distinct from 'entire_file') then raise exception 'INVALID_INVENTORY_REPORT'; end if;
    ids:=array_append(ids,item->>'id');
  end loop;
  if not(added=any(ids)) or (select count(distinct x) from unnest(ids) x)<>cardinality(ids) then raise exception 'INVALID_INVENTORY_REPORT'; end if;
  select array_agg(signature_id order by signature_id) into known_ids from public.version_pdf_signatures where version_id=r.parent_version_id;
  if known_ids is not null and (select array_agg(x order by x) from unnest(ids) x where x<>added) is distinct from known_ids then raise exception 'INHERITED_SIGNATURES_CHANGED'; end if;
  update public.signature_validation_receipts set state='validating',report=p_report where id=r.id;
  insert into public.signature_submissions(id,workflow_id,parent_version_id,storage_path,sha256,byte_size,submitted_by_session_hash,status,validation_summary,page_count,page_dimensions)
    values(r.id,r.workflow_id,r.parent_version_id,r.storage_path,r.signed_sha256,r.byte_size,r.session_hash,'uploaded',
      jsonb_build_object('mode','cryptographic_inventory','policy',p_report->>'policy','receipt_id',r.id),p_page_count,p_page_dimensions);
  accepted:=public.accept_open_signed_submission(r.workflow_id,r.session_hash,r.id);
  if accepted->>'ok' is distinct from 'true' or accepted->>'version_id' is null then raise exception 'ACCEPTANCE_UNAVAILABLE'; end if;
  version:=(accepted->>'version_id')::uuid;
  insert into public.version_signature_inventories(version_id,workflow_id,receipt_id,policy,signature_count,inherited_count,added_signature_id)
    values(version,r.workflow_id,r.id,p_report->>'policy',(p_report->>'signatureCount')::integer,(p_report->>'inheritedCount')::integer,added);
  insert into public.version_pdf_signatures(version_id,workflow_id,signature_id,record)
    select version,r.workflow_id,value->>'id',value from jsonb_array_elements(p_report->'signatures');
  if r.invitation_id is not null then
    update public.round_invitations set status='completed',completed_at=now() where id=r.invitation_id;
  end if;
  delete from public.file_cleanup_jobs where storage_path=r.storage_path and reason='uncommitted_validation';
  update public.signature_validation_receipts set state='accepted',version_id=version,accepted_at=now() where id=r.id;
  return public.get_signature_receipt(r.workflow_id,r.session_hash,r.signed_sha256);
end $$;

revoke all on function public.get_signature_receipt(uuid,text,text),public.begin_signature_validation(uuid,text,uuid,text,integer),public.commit_signature_validation(uuid,uuid,jsonb,integer,jsonb),public.prevent_signature_inventory_update(),public.enforce_signature_inventory_acceptance() from public,anon,authenticated;
grant execute on function public.get_signature_receipt(uuid,text,text),public.begin_signature_validation(uuid,text,uuid,text,integer),public.commit_signature_validation(uuid,uuid,jsonb,integer,jsonb) to service_role;
