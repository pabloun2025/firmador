-- Private super-administration control plane. Browser roles receive no table
-- policies: every operation is mediated by the superadmin-console Edge Function.
create table if not exists public.super_admins (
  email text primary key check (email = lower(email) and email ~* '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  user_id uuid unique references auth.users(id) on delete set null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

insert into public.super_admins(email, user_id)
select 'pabloun@gmail.com', id from auth.users where lower(email) = 'pabloun@gmail.com'
on conflict (email) do update set user_id = coalesce(public.super_admins.user_id, excluded.user_id);

create table if not exists public.system_settings (
  singleton boolean primary key default true check (singleton),
  email_master_enabled boolean not null default true,
  email_invitations_enabled boolean not null default true,
  email_queue_enabled boolean not null default true,
  email_turn_enabled boolean not null default true,
  automatic_cleanup_enabled boolean not null default true,
  maintenance_mode boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
insert into public.system_settings(singleton) values (true) on conflict (singleton) do nothing;

create table if not exists public.email_templates (
  template_key text primary key check (template_key in ('invitation','waitlisted','turn_ready')),
  label text not null,
  subject_template text not null check (char_length(subject_template) between 1 and 160),
  body_template text not null check (char_length(body_template) between 1 and 3000),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

insert into public.email_templates(template_key, label, subject_template, body_template) values
  ('invitation', 'Invitación a firmar', 'LeapSign · Invitación a firmar {{title}}', E'Hola {{name}},\n\nTe han invitado a participar en {{title}}. Al abrir el enlace entrarás en la cola. Cuando llegue tu turno podrás descargar, firmar y subir la versión siguiente.'),
  ('waitlisted', 'Confirmación de cola', 'LeapSign · Estás en la cola de firma', E'Hola {{name}},\n\nTu solicitud está registrada. Conservaremos tu posición y podrás consultar el estado desde tu enlace privado.'),
  ('turn_ready', 'Turno disponible', 'LeapSign · Ya puedes firmar', E'Hola {{name}},\n\nEl documento ha avanzado hasta ti. Tu acceso está activo durante 10 minutos para descargar, firmar y subir la versión siguiente.')
on conflict (template_key) do nothing;

create table if not exists public.superadmin_audit_log (
  id bigint generated always as identity primary key,
  admin_user_id uuid not null,
  admin_email text not null,
  action text not null check (char_length(action) between 1 and 100),
  target_type text not null check (char_length(target_type) between 1 and 60),
  target_id text,
  reason text check (reason is null or char_length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists superadmin_audit_recent_idx on public.superadmin_audit_log(created_at desc);

alter table public.super_admins enable row level security;
alter table public.system_settings enable row level security;
alter table public.email_templates enable row level security;
alter table public.superadmin_audit_log enable row level security;

revoke all on public.super_admins from public, anon, authenticated;
revoke all on public.system_settings from public, anon, authenticated;
revoke all on public.email_templates from public, anon, authenticated;
revoke all on public.superadmin_audit_log from public, anon, authenticated;

create or replace function public.superadmin_metrics()
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object(
    'workflows_total', (select count(*) from public.workflows),
    'workflows_active', (select count(*) from public.workflows where status = 'active'),
    'workflows_paused', (select count(*) from public.workflows where status = 'paused_error'),
    'workflows_completed', (select count(*) from public.workflows where status = 'completed'),
    'workflows_cancelled', (select count(*) from public.workflows where status = 'cancelled'),
    'active_turns', (select count(*) from public.open_round_locks where expires_at > now()),
    'waiting_people', (select count(*) from public.open_round_waitlist),
    'document_versions', (select count(*) from public.document_versions where discarded_at is null),
    'stored_bytes', (select coalesce(sum(byte_size),0) from public.document_versions where discarded_at is null),
    'invitations_total', (select count(*) from public.round_invitations),
    'invitations_failed', (select count(*) from public.round_invitations where email_error is not null),
    'cleanup_pending', (select count(*) from public.file_cleanup_jobs where status in ('pending','processing')),
    'cleanup_failed', (select count(*) from public.file_cleanup_jobs where status = 'failed'),
    'errors_last_24h', (select count(*) from public.error_reports where created_at >= now() - interval '24 hours')
  );
$$;
revoke all on function public.superadmin_metrics() from public, anon, authenticated;
grant execute on function public.superadmin_metrics() to service_role;

comment on table public.superadmin_audit_log is 'Append-only record of privileged operations. No browser role can alter it.';
