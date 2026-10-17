-- Prepared only: requires review before applying to a live database.
-- One ledger per database: applications on this database share account scopes.
create table if not exists public.security_budget_settings (
  singleton boolean primary key default true check (singleton),
  disabled_services text[] not null default '{}',
  limits jsonb not null default '{}'::jsonb,
  reason text,
  last_blocked_at timestamptz,
  last_blocked_reason text,
  updated_at timestamptz not null default now()
);
insert into public.security_budget_settings(singleton) values(true) on conflict do nothing;
create table if not exists public.security_budget_usage (
  scope text not null check(length(scope) between 1 and 200),
  period_seconds integer not null check(period_seconds between 60 and 2592000),
  window_start bigint not null,
  used bigint not null check(used >= 0),
  expires_at timestamptz not null,
  primary key(scope, period_seconds, window_start)
);
create index if not exists security_budget_expiry_idx on public.security_budget_usage(expires_at);
alter table public.security_budget_settings enable row level security;
alter table public.security_budget_usage enable row level security;
revoke all on public.security_budget_settings, public.security_budget_usage from public, anon, authenticated;
grant all on public.security_budget_settings, public.security_budget_usage to service_role;

create or replace function public.reserve_security_budget(p_service text, p_rules jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  item jsonb; settings public.security_budget_settings%rowtype;
  scope_key text; seconds integer; bucket bigint; quantity bigint; cap bigint; consumed bigint;
  timestamp_now timestamptz := clock_timestamp();
begin
  if p_service is null or p_rules is null or p_service not in ('requests','uploads','downloads','emails','creation','maintenance')
    or jsonb_typeof(p_rules) <> 'array' or jsonb_array_length(p_rules) not between 1 and 12 then
    raise exception 'invalid budget reservation';
  end if;
  -- Serializes check+reservation across all applications and dimensions.
  perform pg_advisory_xact_lock(17010000, 1);
  select * into strict settings from public.security_budget_settings where singleton;
  if p_service = any(settings.disabled_services) then
    update public.security_budget_settings set last_blocked_at=timestamp_now,last_blocked_reason=p_service||':protection_mode'
      where singleton and (last_blocked_at is null or last_blocked_at < timestamp_now-interval '15 minutes');
    return jsonb_build_object('allowed',false,'reason','protection_mode');
  end if;
  if (select count(*) from (select distinct value->>'scope', value->>'period' from jsonb_array_elements(p_rules)) s)
     <> jsonb_array_length(p_rules) then raise exception 'duplicate budget dimension'; end if;
  for item in select value from jsonb_array_elements(p_rules) loop
    scope_key := item->>'scope'; seconds := (item->>'period')::integer;
    quantity := (item->>'amount')::bigint;
    cap := coalesce((settings.limits->>(item->>'policy'))::bigint, (item->>'limit')::bigint);
    if scope_key is null or length(scope_key) not between 1 and 200 or seconds is null
      or seconds not between 60 and 2592000 or quantity is null or quantity <= 0
      or cap is null or cap < 0 then raise exception 'invalid budget rule'; end if;
    bucket := floor(extract(epoch from timestamp_now) / seconds)::bigint * seconds;
    select used into consumed from public.security_budget_usage
      where scope = scope_key and period_seconds = seconds and window_start = bucket;
    if quantity > cap - coalesce(consumed,0) then
      update public.security_budget_settings set last_blocked_at=timestamp_now,last_blocked_reason=p_service||':quota:'||(item->>'policy')
        where singleton and (last_blocked_at is null or last_blocked_at < timestamp_now-interval '15 minutes');
      return jsonb_build_object('allowed',false,'reason','quota');
    end if;
  end loop;
  -- A global live-storage check complements the daily byte reservation. Reservations
  -- are deliberately overcounted here to cover concurrent uploads not yet persisted.
  if p_service = 'uploads' and exists(select 1 from jsonb_array_elements(p_rules) r where r->>'scope' = 'shared:upload-bytes') then
    select coalesce(sum(coalesce((metadata->>'size')::bigint,0)),0) into consumed
      from storage.objects where bucket_id = 'firmador-documents';
    select coalesce(sum(used),0) + consumed into consumed from public.security_budget_usage
      where scope = 'shared:upload-bytes' and expires_at > timestamp_now;
    select (value->>'amount')::bigint into quantity from jsonb_array_elements(p_rules) where value->>'scope' = 'shared:upload-bytes';
    if consumed + quantity > coalesce((settings.limits->>'live_storage_bytes')::bigint,2147483648) then
      update public.security_budget_settings set last_blocked_at=timestamp_now,last_blocked_reason='uploads:storage'
        where singleton and (last_blocked_at is null or last_blocked_at < timestamp_now-interval '15 minutes');
      return jsonb_build_object('allowed',false,'reason','storage');
    end if;
  end if;
  -- Bounded cleanup of counters only; never deletes documents or audit history.
  delete from public.security_budget_usage where ctid in
    (select ctid from public.security_budget_usage where expires_at < timestamp_now limit 100);
  for item in select value from jsonb_array_elements(p_rules) loop
    seconds := (item->>'period')::integer;
    bucket := floor(extract(epoch from timestamp_now) / seconds)::bigint * seconds;
    insert into public.security_budget_usage(scope,period_seconds,window_start,used,expires_at)
      values(item->>'scope',seconds,bucket,(item->>'amount')::bigint,to_timestamp(bucket+seconds))
      on conflict(scope,period_seconds,window_start) do update
      set used = public.security_budget_usage.used + excluded.used;
  end loop;
  return jsonb_build_object('allowed',true);
end $$;
revoke all on function public.reserve_security_budget(text,jsonb) from public, anon, authenticated;
grant execute on function public.reserve_security_budget(text,jsonb) to service_role;

create or replace function public.enforce_workflow_security_budget()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare reservation jsonb; active_count bigint; cap bigint;
begin
  perform pg_advisory_xact_lock(17010000,1);
  select coalesce((limits->>'active_workflows_per_owner')::bigint,20) into strict cap
    from public.security_budget_settings where singleton;
  select count(*) into active_count from public.workflows
    where owner_id = new.owner_id and status in ('active','paused_error');
  if active_count >= cap then raise exception 'Límite de procesos activos alcanzado.'; end if;
  reservation := public.reserve_security_budget('creation',jsonb_build_array(
    jsonb_build_object('scope','shared:creation','period',86400,'amount',1,'policy','creation_daily','limit',100),
    jsonb_build_object('scope','owner-create:'||new.owner_id,'period',86400,'amount',1,'policy','owner_creation_daily','limit',20)
  ));
  if not (reservation->>'allowed')::boolean then raise exception 'Límite temporal de creación alcanzado.'; end if;
  return new;
end $$;
revoke all on function public.enforce_workflow_security_budget() from public, anon, authenticated;
drop trigger if exists workflow_security_budget on public.workflows;
create trigger workflow_security_budget before insert on public.workflows
  for each row execute function public.enforce_workflow_security_budget();
-- Close direct REST creation; server routes perform validation before service-role writes.
drop policy if exists "owners create workflows" on public.workflows;

create or replace function public.enforce_invitation_security_budget()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare target public.workflows%rowtype; occupied bigint; reservation jsonb;
begin
  -- Same lock order as creation/reservations, then the workflow row.
  perform pg_advisory_xact_lock(17010000,1);
  select * into strict target from public.workflows where id = new.workflow_id for update;
  if new.owner_id <> target.owner_id then raise exception 'Invalid invitation owner'; end if;
  if new.status in ('pending','opened') then
    if target.status <> 'active' then raise exception 'Este proceso ya no admite invitaciones.'; end if;
    select count(distinct email) into occupied from public.round_invitations
      where workflow_id = new.workflow_id and status in ('pending','opened')
      and expires_at > now() and id <> new.id;
    if target.expected_signature_count is not null
      and occupied + target.signature_count >= target.expected_signature_count then
      raise exception 'Ya están cubiertas todas las plazas de firma.';
    end if;
  end if;
  reservation := public.reserve_security_budget('emails',jsonb_build_array(
    jsonb_build_object('scope','owner-invite:'||new.owner_id,'period',86400,'amount',1,'policy','owner_invitations_daily','limit',100)
  ));
  if not (reservation->>'allowed')::boolean then raise exception 'Límite temporal de invitaciones alcanzado.'; end if;
  return new;
end $$;
revoke all on function public.enforce_invitation_security_budget() from public, anon, authenticated;
drop trigger if exists invitation_security_budget on public.round_invitations;
create trigger invitation_security_budget before insert or update of token_hash on public.round_invitations
  for each row execute function public.enforce_invitation_security_budget();

-- Protect direct REST address-book writes as well as the invitation route.
create or replace function public.enforce_contact_security_budget()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare reservation jsonb; contact_count bigint; cap bigint;
begin
  perform pg_advisory_xact_lock(17010000,1);
  if length(new.email) > 254 then raise exception 'Correo demasiado largo.'; end if;
  select coalesce((limits->>'contacts_per_owner')::bigint,2000) into strict cap
    from public.security_budget_settings where singleton;
  select count(*) into contact_count from public.owner_contacts where owner_id=new.owner_id;
  if contact_count >= cap and not exists(select 1 from public.owner_contacts where owner_id=new.owner_id and email=new.email) then
    raise exception 'Límite de contactos alcanzado.';
  end if;
  reservation := public.reserve_security_budget('creation',jsonb_build_array(
    jsonb_build_object('scope','owner-contacts:'||new.owner_id,'period',86400,'amount',1,'policy','contact_writes_daily','limit',200)
  ));
  if not (reservation->>'allowed')::boolean then raise exception 'Límite temporal de contactos alcanzado.'; end if;
  return new;
end $$;
revoke all on function public.enforce_contact_security_budget() from public, anon, authenticated;
drop trigger if exists contact_security_budget on public.owner_contacts;
create trigger contact_security_budget before insert or update on public.owner_contacts
  for each row execute function public.enforce_contact_security_budget();
