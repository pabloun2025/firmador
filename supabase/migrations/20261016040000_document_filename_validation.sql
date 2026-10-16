-- Preserve the creator's original filename so each later upload can be checked
-- against the same document identity without exposing file contents.
alter table public.workflows
  add column if not exists original_filename text
  check (original_filename is null or char_length(original_filename) between 1 and 180);

comment on column public.workflows.original_filename is
  'Original PDF filename, used as an operational continuity check for signed uploads.';
