-- Generates an internal scheduler credential without displaying it or asking the
-- operator to copy secrets. Never return this table to an API client.
create table if not exists public.security_internal_credentials (
  purpose text primary key,
  token text not null,
  created_at timestamptz not null default now()
);
alter table public.security_internal_credentials enable row level security;
revoke all on public.security_internal_credentials from public, anon, authenticated;
grant all on public.security_internal_credentials to service_role;
insert into public.security_internal_credentials(purpose,token)
  values('lifecycle',encode(extensions.gen_random_bytes(32),'hex')) on conflict do nothing;
create or replace function public.authorize_lifecycle_job(p_token_hash text)
returns boolean language sql security definer set search_path = public, pg_temp as $$
  select exists(select 1 from public.security_internal_credentials where purpose='lifecycle'
    and encode(extensions.digest(token,'sha256'),'hex')=p_token_hash);
$$;
revoke all on function public.authorize_lifecycle_job(text) from public, anon, authenticated;
grant execute on function public.authorize_lifecycle_job(text) to service_role;
create or replace function public.dispatch_lifecycle_maintenance()
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare credential text; request_id bigint;
begin
  select token into strict credential from public.security_internal_credentials where purpose='lifecycle';
  select net.http_post(
    url := 'https://lgsdoutarthfymbjgdrj.supabase.co/functions/v1/process-lifecycle-jobs',
    headers := jsonb_build_object('Content-Type','application/json','X-Lifecycle-Token',credential),
    body := '{"source":"pg_cron"}'::jsonb,
    timeout_milliseconds := 10000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.dispatch_lifecycle_maintenance() from public, anon, authenticated;
grant execute on function public.dispatch_lifecycle_maintenance() to service_role;
do $$
declare job bigint;
begin
  select jobid into job from cron.job where jobname='leapsign-lifecycle-jobs' limit 1;
  if job is not null then perform cron.unschedule(job); end if;
  perform cron.schedule('leapsign-lifecycle-jobs','*/15 * * * *','select public.dispatch_lifecycle_maintenance();');
end $$;
