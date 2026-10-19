-- Separate from documents and identities. Only the three historic winners persist.
create table public.queue_game_runs (
  id uuid primary key default gen_random_uuid(),
  seed bigint not null check (seed between 0 and 4294967295),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default clock_timestamp() + interval '10 minutes'
);
create index queue_game_runs_expiry on public.queue_game_runs(expires_at);
create table public.queue_game_records (
  id uuid primary key,
  alias text not null check (char_length(alias) between 2 and 24),
  score integer not null check (score between 1 and 500),
  achieved_at timestamptz not null default clock_timestamp()
);
alter table public.queue_game_runs enable row level security;
alter table public.queue_game_records enable row level security;
revoke all on public.queue_game_runs, public.queue_game_records from anon, authenticated;
grant select on public.queue_game_runs, public.queue_game_records to service_role;

create function public.start_queue_game(p_seed bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result public.queue_game_runs;
begin
  perform pg_advisory_xact_lock(1900261019);
  delete from public.queue_game_runs where expires_at <= clock_timestamp();
  if (select count(*) from public.queue_game_runs) >= 500 then
    raise exception 'Game temporarily unavailable';
  end if;
  insert into public.queue_game_runs(seed) values(p_seed) returning * into result;
  return jsonb_build_object('id',result.id,'seed',result.seed);
end; $$;

create function public.finish_queue_game(p_run uuid, p_alias text, p_score integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare ticket public.queue_game_runs; leaders jsonb;
begin
  perform pg_advisory_xact_lock(1900261019);
  delete from public.queue_game_runs where id=p_run and expires_at > clock_timestamp() returning * into ticket;
  if ticket.id is null then raise exception 'Game expired or already submitted'; end if;
  insert into public.queue_game_records(id,alias,score) values(p_run,p_alias,p_score);
  delete from public.queue_game_records where id not in (
    select id from public.queue_game_records order by score desc, achieved_at, id limit 3
  );
  select coalesce(jsonb_agg(row_to_json(r) order by r.score desc,r.achieved_at,r.id),'[]'::jsonb)
    into leaders from (select id,alias,score,achieved_at from public.queue_game_records order by score desc,achieved_at,id) r;
  return jsonb_build_object('records',leaders,'ranked',exists(select 1 from public.queue_game_records where id=p_run));
end; $$;
revoke all on function public.start_queue_game(bigint), public.finish_queue_game(uuid,text,integer) from public, anon, authenticated;
grant execute on function public.start_queue_game(bigint), public.finish_queue_game(uuid,text,integer) to service_role;
