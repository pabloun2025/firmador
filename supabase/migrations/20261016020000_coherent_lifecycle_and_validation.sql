-- Coherent participant access, reminder and private-file retention policy.
-- Invitations live for 48 hours. Superseded PDFs remain available to the owner
-- for 48 hours and the accepted final PDF for five days.
alter table public.round_invitations
  alter column expires_at set default (now() + interval '48 hours'),
  add column if not exists reminder_1h_sent_at timestamptz,
  add column if not exists reminder_24h_sent_at timestamptz;

update public.round_invitations
set expires_at = least(expires_at, created_at + interval '48 hours')
where status in ('pending', 'opened', 'cancelled');

create table if not exists public.round_invitation_tokens (
  id uuid primary key default gen_random_uuid(),
  invitation_id uuid not null references public.round_invitations(id) on delete cascade,
  token_hash text not null unique,
  kind text not null check (kind in ('initial', 'reminder_1h', 'reminder_24h')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists round_invitation_tokens_invitation_idx
  on public.round_invitation_tokens(invitation_id, expires_at);
alter table public.round_invitation_tokens enable row level security;
revoke all on public.round_invitation_tokens from public, anon, authenticated;

alter table public.system_settings
  add column if not exists email_reminders_enabled boolean not null default true;

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates
  add constraint email_templates_template_key_check
  check (template_key in ('invitation','waitlisted','turn_ready','owner_completed','reminder_1h','reminder_24h'));

insert into public.email_templates(template_key, label, subject_template, body_template) values
  ('reminder_1h', 'Firma pendiente · 1 hora', 'LeapSign · Tienes pendiente firmar {{title}}', E'Hola {{name}},\n\nHace una hora recibiste una invitación para firmar {{title}}. Tu acceso privado continúa disponible. Abre el enlace cuando puedas para entrar en la cola y completar la firma.'),
  ('reminder_24h', 'Firma pendiente · último recordatorio', 'LeapSign · Último recordatorio para firmar {{title}}', E'Hola {{name}},\n\nAún tienes pendiente firmar {{title}}. Este es el último recordatorio: tu invitación privada caducará en aproximadamente 24 horas. Si necesitas participar, completa la firma antes de ese momento.')
on conflict (template_key) do nothing;

update public.email_templates set enabled=false where template_key in ('waitlisted','turn_ready');
update public.system_settings set email_queue_enabled=false, email_turn_enabled=false where singleton=true;

alter table public.document_versions
  add column if not exists page_count integer check (page_count is null or page_count between 1 and 500),
  add column if not exists page_dimensions jsonb not null default '[]'::jsonb,
  add column if not exists delete_after timestamptz;

alter table public.signature_submissions
  add column if not exists page_count integer check (page_count is null or page_count between 1 and 500),
  add column if not exists page_dimensions jsonb not null default '[]'::jsonb;

alter table public.file_cleanup_jobs
  add column if not exists scheduled_for timestamptz not null default now();
create index if not exists file_cleanup_jobs_due_idx
  on public.file_cleanup_jobs(status, scheduled_for);

alter table public.workflows
  add column if not exists completed_at timestamptz,
  add column if not exists final_file_delete_at timestamptz;

create or replace function public.restore_round_invitation_access(
  p_workflow_id uuid,
  p_token_hash text,
  p_new_session_hash text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare invitation public.round_invitations; has_turn boolean;
begin
  select i.* into invitation
  from public.round_invitations i
  left join public.round_invitation_tokens t
    on t.invitation_id = i.id and t.token_hash = p_token_hash and t.expires_at > now()
  where i.workflow_id = p_workflow_id
    and (i.token_hash = p_token_hash or t.id is not null)
  for update of i;
  if invitation.id is null then raise exception 'La invitación no es válida'; end if;
  if invitation.status = 'completed' then
    raise exception 'Esta invitación ya fue completada. No es posible firmar dos veces con el mismo enlace';
  end if;
  if invitation.expires_at <= now() then
    raise exception 'La invitación ha caducado. Solicita una nueva al creador';
  end if;
  if invitation.status not in ('pending','opened','cancelled') then
    raise exception 'Esta invitación ya no está disponible';
  end if;
  if invitation.session_hash is not null and invitation.session_hash <> p_new_session_hash then
    if exists(select 1 from public.open_round_waitlist where workflow_id=p_workflow_id and session_hash=p_new_session_hash)
       or exists(select 1 from public.open_round_locks where workflow_id=p_workflow_id and holder_session_hash=p_new_session_hash) then
      raise exception 'Este dispositivo ya tiene otra solicitud en el proceso';
    end if;
    select exists(select 1 from public.open_round_waitlist where workflow_id=p_workflow_id and session_hash=invitation.session_hash)
      or exists(select 1 from public.open_round_locks where workflow_id=p_workflow_id and holder_session_hash=invitation.session_hash and expires_at > now()) into has_turn;
    if has_turn then raise exception 'Esta invitación ya está en uso'; end if;
  end if;
  update public.round_invitations
  set session_hash=p_new_session_hash, status='opened', opened_at=coalesce(opened_at,now())
  where id=invitation.id;
  return jsonb_build_object('holder_name', invitation.holder_name, 'email', invitation.email);
end $$;
revoke all on function public.restore_round_invitation_access(uuid,text,text) from public, anon, authenticated;
grant execute on function public.restore_round_invitation_access(uuid,text,text) to service_role;

create or replace function public.accept_open_signed_submission(
  p_workflow_id uuid, p_session_hash text, p_submission_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare workflow_row public.workflows; lock_row public.open_round_locks; submission_row public.signature_submissions; next_signer record; new_version uuid; next_sequence smallint; old_path text;
begin
  select * into workflow_row from public.workflows where id = p_workflow_id and status = 'active' for update;
  if workflow_row.id is null or workflow_row.current_version_id is null then raise exception 'Este proceso ya no está disponible para firmar'; end if;
  select * into lock_row from public.open_round_locks where workflow_id = p_workflow_id for update;
  if lock_row.workflow_id is null or lock_row.holder_session_hash <> p_session_hash or lock_row.expires_at <= now() or lock_row.version_id_at_claim <> workflow_row.current_version_id then raise exception 'Tu turno ya no está activo o el documento cambió'; end if;
  if lock_row.reviewed_version_at is null then raise exception 'Descarga el documento vigente antes de incorporar la copia firmada'; end if;
  select * into submission_row from public.signature_submissions where id = p_submission_id and workflow_id = p_workflow_id and submitted_by_session_hash = p_session_hash and parent_version_id = workflow_row.current_version_id for update;
  if submission_row.id is null then raise exception 'No encontramos tu documento firmado'; end if;
  if submission_row.status = 'accepted' then return jsonb_build_object('ok', true, 'already_accepted', true); end if;
  select storage_path into old_path from public.document_versions where id = workflow_row.current_version_id;
  select coalesce(max(sequence), -1) + 1 into next_sequence from public.document_versions where workflow_id = p_workflow_id and discarded_at is null;
  insert into public.document_versions(workflow_id, sequence, storage_path, sha256, byte_size, parent_version_id, submitted_by_session_hash, submitted_by_name, submitted_by_email, validation_status, validation_summary, page_count, page_dimensions, accepted_at)
  values (p_workflow_id, next_sequence, submission_row.storage_path, submission_row.sha256, submission_row.byte_size, workflow_row.current_version_id, p_session_hash, lock_row.holder_name, lock_row.holder_email, 'accepted', submission_row.validation_summary, submission_row.page_count, submission_row.page_dimensions, now()) returning id into new_version;
  update public.signature_submissions set status = 'accepted', validated_at = now(), accepted_version_id = new_version where id = submission_row.id;
  update public.document_versions set delete_after = now() + interval '48 hours' where id = workflow_row.current_version_id;
  insert into public.file_cleanup_jobs(workflow_id, storage_path, reason, scheduled_for)
  values (p_workflow_id, old_path, 'superseded', now() + interval '48 hours')
  on conflict (storage_path) do update set scheduled_for=excluded.scheduled_for, reason=excluded.reason, status='pending', completed_at=null;
  update public.workflows set current_version_id = new_version, signature_count = least(next_sequence, 20), last_activity_at = now() where id = p_workflow_id;
  delete from public.open_round_locks where workflow_id = p_workflow_id;
  select holder_name, email, session_hash into next_signer from public.open_round_waitlist where workflow_id = p_workflow_id order by joined_at for update limit 1;
  insert into public.workflow_audit_log(workflow_id, actor_type, actor_session_hash, action, metadata) values (p_workflow_id, 'participant', p_session_hash, 'signed_version_accepted', jsonb_build_object('version_id', new_version, 'sequence', next_sequence));
  return jsonb_build_object('ok', true, 'version_id', new_version, 'next_waiting', next_signer.session_hash is not null);
end $$;
revoke all on function public.accept_open_signed_submission(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.accept_open_signed_submission(uuid,text,uuid) to service_role;

create or replace function public.owner_discard_versions(
  p_workflow_id uuid, p_owner_id uuid, p_version_id uuid, p_action text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare target public.document_versions; path_row record; due_at timestamptz;
begin
  perform 1 from public.workflows where id = p_workflow_id and owner_id = p_owner_id for update;
  if not found then raise exception 'No tienes acceso a este proceso'; end if;
  select * into target from public.document_versions where id = p_version_id and workflow_id = p_workflow_id and discarded_at is null for update;
  if target.id is null then raise exception 'La versión no está disponible'; end if;
  if p_action not in ('rollback','finalize') then raise exception 'Acción no válida'; end if;
  delete from public.open_round_locks where workflow_id = p_workflow_id;
  if p_action = 'rollback' then
    due_at := now() + interval '15 minutes';
    delete from public.file_cleanup_jobs where storage_path=target.storage_path and status in ('pending','failed');
    update public.document_versions set delete_after=null where id=target.id;
    for path_row in select id,storage_path from public.document_versions where workflow_id = p_workflow_id and sequence > target.sequence and discarded_at is null loop
      insert into public.file_cleanup_jobs(workflow_id, storage_path, reason, scheduled_for) values (p_workflow_id, path_row.storage_path, 'rollback', due_at) on conflict (storage_path) do update set scheduled_for=excluded.scheduled_for,status='pending';
      update public.document_versions set delete_after=due_at where id=path_row.id;
    end loop;
    update public.document_versions set discarded_at=now(), discarded_reason='rollback' where workflow_id=p_workflow_id and sequence > target.sequence and discarded_at is null;
    update public.workflows set current_version_id = target.id, signature_count = target.sequence, status = 'active', paused_at = null, paused_reason = null, last_activity_at = now(), completed_at=null, final_file_delete_at=null where id = p_workflow_id;
  else
    delete from public.file_cleanup_jobs where storage_path=target.storage_path and status in ('pending','failed');
    for path_row in select id,storage_path from public.document_versions where workflow_id = p_workflow_id and id <> target.id and discarded_at is null loop
      due_at := now() + interval '48 hours';
      insert into public.file_cleanup_jobs(workflow_id, storage_path, reason, scheduled_for) values (p_workflow_id, path_row.storage_path, 'finalized_history', due_at) on conflict (storage_path) do update set scheduled_for=least(public.file_cleanup_jobs.scheduled_for,excluded.scheduled_for),status='pending';
      update public.document_versions set delete_after=least(coalesce(delete_after,due_at),due_at) where id=path_row.id;
    end loop;
    due_at := now() + interval '5 days';
    insert into public.file_cleanup_jobs(workflow_id, storage_path, reason, scheduled_for) values (p_workflow_id, target.storage_path, 'final_document', due_at) on conflict (storage_path) do update set scheduled_for=excluded.scheduled_for,reason=excluded.reason,status='pending';
    update public.document_versions set delete_after=due_at where id=target.id;
    update public.workflows set current_version_id = target.id, status = 'completed', paused_at = null, paused_reason = null, last_activity_at = now(), completed_at=now(), final_file_delete_at=due_at where id = p_workflow_id;
    update public.round_invitations set status='cancelled' where workflow_id=p_workflow_id and status in ('pending','opened');
  end if;
  insert into public.workflow_audit_log(workflow_id, actor_type, actor_user_id, action, metadata) values (p_workflow_id, 'owner', p_owner_id, case when p_action='rollback' then 'owner_rolled_back_version' else 'owner_accepted_final_version' end, jsonb_build_object('version_id', target.id, 'sequence', target.sequence));
  return jsonb_build_object('ok', true, 'sequence', target.sequence, 'delete_after', due_at);
end $$;
revoke all on function public.owner_discard_versions(uuid,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.owner_discard_versions(uuid,uuid,uuid,text) to service_role;

create or replace function public.finish_file_cleanup(p_path text, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.file_cleanup_jobs set status = case when p_error is null then 'done' else 'failed' end, attempts = attempts + 1, last_error = p_error, completed_at = case when p_error is null then now() else null end where storage_path = p_path;
  if p_error is null then
    update public.document_versions set discarded_at=coalesce(discarded_at,now()), discarded_reason=coalesce(discarded_reason,'retention_expired') where storage_path=p_path;
  end if;
end $$;
revoke all on function public.finish_file_cleanup(text,text) from public, anon, authenticated;
grant execute on function public.finish_file_cleanup(text,text) to service_role;

-- Supabase runs this idempotent maintenance endpoint every fifteen minutes.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;
do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='leapsign-lifecycle-jobs' limit 1;
  if existing_job is not null then perform cron.unschedule(existing_job); end if;
  perform cron.schedule(
    'leapsign-lifecycle-jobs',
    '*/15 * * * *',
    $job$select net.http_post(
      url := 'https://lgsdoutarthfymbjgdrj.supabase.co/functions/v1/process-lifecycle-jobs',
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body := '{"source":"pg_cron"}'::jsonb
    );$job$
  );
end $$;
