-- Service-only recovery verification: row lock prevents parallel code guesses
-- from bypassing the five-attempt limit or consuming a code twice.
create or replace function public.consume_superadmin_recovery(p_user_id uuid, p_code_hash text)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare recovery public.superadmin_recovery_codes%rowtype;
begin
  select * into recovery from public.superadmin_recovery_codes
    where user_id = p_user_id and used_at is null order by created_at desc limit 1 for update;
  if not found or recovery.expires_at <= now() or recovery.attempts >= 5 then return false; end if;
  if recovery.code_hash <> p_code_hash then
    update public.superadmin_recovery_codes set attempts = attempts + 1 where id = recovery.id;
    return false;
  end if;
  update public.superadmin_recovery_codes set used_at = now() where id = recovery.id;
  return true;
end $$;
revoke all on function public.consume_superadmin_recovery(uuid,text) from public, anon, authenticated;
grant execute on function public.consume_superadmin_recovery(uuid,text) to service_role;
