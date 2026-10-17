-- The first natural run exceeded the previous 10-second HTTP client timeout.
-- Keep the scheduled behavior and offer a service-only, side-effect-free probe.
create or replace function public.dispatch_lifecycle_maintenance(p_health_check boolean)
returns bigint language plpgsql security definer set search_path = public, pg_temp as $$
declare credential text; request_id bigint;
begin
  select token into strict credential from public.security_internal_credentials where purpose='lifecycle';
  select net.http_post(
    url := 'https://lgsdoutarthfymbjgdrj.supabase.co/functions/v1/process-lifecycle-jobs',
    headers := jsonb_build_object('Content-Type','application/json','X-Lifecycle-Token',credential),
    body := jsonb_build_object('source','pg_cron','healthCheck',p_health_check),
    timeout_milliseconds := 120000
  ) into request_id;
  return request_id;
end $$;
revoke all on function public.dispatch_lifecycle_maintenance(boolean) from public, anon, authenticated;
grant execute on function public.dispatch_lifecycle_maintenance(boolean) to service_role;
create or replace function public.dispatch_lifecycle_maintenance()
returns bigint language sql security definer set search_path = public, pg_temp as $$
  select public.dispatch_lifecycle_maintenance(false);
$$;
revoke all on function public.dispatch_lifecycle_maintenance() from public, anon, authenticated;
grant execute on function public.dispatch_lifecycle_maintenance() to service_role;
