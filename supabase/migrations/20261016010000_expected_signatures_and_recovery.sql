-- Expected signer count, completion notices, and protected superadmin MFA recovery.
alter table public.workflows
  add column if not exists expected_signature_count smallint
    check (expected_signature_count between 1 and 20),
  add column if not exists owner_completion_notified_at timestamptz;

alter table public.system_settings
  add column if not exists email_completion_enabled boolean not null default true;

alter table public.email_templates drop constraint if exists email_templates_template_key_check;
alter table public.email_templates
  add constraint email_templates_template_key_check
  check (template_key in ('invitation','waitlisted','turn_ready','owner_completed'));

insert into public.email_templates(template_key, label, subject_template, body_template) values
  ('owner_completed', 'Objetivo de firmas alcanzado', 'LeapSign · {{title}} alcanzó el número de firmas previsto', E'Hola {{name}},\n\nEl documento {{title}} ya tiene todas las firmas que indicaste. Entra en tu espacio para revisar la versión vigente y, si corresponde, aceptarla como versión final.')
on conflict (template_key) do nothing;

create table if not exists public.superadmin_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists superadmin_recovery_codes_user_idx
  on public.superadmin_recovery_codes(user_id, created_at desc);
alter table public.superadmin_recovery_codes enable row level security;
revoke all on public.superadmin_recovery_codes from public, anon, authenticated;

comment on column public.workflows.expected_signature_count is 'Null means that the owner does not know or has not limited the signer count.';
comment on table public.superadmin_recovery_codes is 'Short-lived, hashed recovery codes used only by the superadmin recovery Edge Function.';
