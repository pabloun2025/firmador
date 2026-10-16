-- The creator's process title is the public filename. Storage paths remain
-- opaque and must never leak names such as 0.pdf into participant downloads.
update public.workflows
set original_filename = case
  when title ~* '\.pdf$' then title
  else title || '.pdf'
end;

comment on column public.workflows.original_filename is
  'Public PDF filename chosen through the workflow title; internal storage paths stay private.';
