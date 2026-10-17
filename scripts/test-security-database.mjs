import { spawnSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const container = process.env.SECURITY_TEST_CONTAINER || 'codex-security-postgres-20261017';
const db = process.argv[2] === 'cadenapdf' ? 'cadenapdf' : 'firmador';
const candidateRoot = resolve(import.meta.dirname,'..');
const root = existsSync(`${candidateRoot}/supabase`) ? candidateRoot : `/workspace/${db}`;
function sql(query) {
  const result = spawnSync('docker', ['exec','-i',container,'psql','-U','postgres','-d',db,'-XAt','-v','ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if(result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}
const create = spawnSync('docker',['exec',container,'createdb','-U','postgres',db],{encoding:'utf8'});
if(create.status !== 0) throw new Error('Use a fresh isolated test database; refusing to reset an existing database.');
sql(`do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth; create schema storage; create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table storage.buckets(id text primary key,name text, public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(), bucket_id text,metadata jsonb);
-- Local-only substitutes: test schedule and credential wiring without HTTP calls.
create schema cron; create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text);
create function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid=id returning true $$;
create function cron.schedule(name text,spec text,cmd text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(name,spec,cmd) returning jobid $$;
create schema net;
create function net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer default 10000) returns bigint language sql as $$ select 1::bigint $$;`);
// Minimal synthetic baseline matching the deployed tables used by these changes.
// Historical migrations cannot be replayed unchanged: an older migration changes
// release_open_turn's return type without dropping it. Do not hide that defect.
sql(`create table public.workflows(
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references auth.users,
  title text not null,status text not null default 'active',signature_count integer not null default 0
  ${db === 'firmador' ? ',expected_signature_count integer' : ''}
);
create table public.round_invitations(
  id uuid primary key default gen_random_uuid(),workflow_id uuid not null references public.workflows,
  owner_id uuid not null references auth.users,email text not null,status text not null default 'pending',
  token_hash text not null,expires_at timestamptz not null default now()+interval '48 hours'
);
create table public.owner_contacts(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users,email text not null,display_name text);
${db === 'firmador' ? `create table public.superadmin_recovery_codes(
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users,
  code_hash text not null,attempts integer not null default 0,expires_at timestamptz not null,
  used_at timestamptz,created_at timestamptz not null default now()
);` : ''}`);
for(const file of readdirSync(`${root}/supabase/migrations`).sort().filter(file=>file.startsWith('20261017'))) {
  let source=readFileSync(`${root}/supabase/migrations/${file}`,'utf8');
  // PostgreSQL itself is real; only unavailable Supabase extension installation
  // statements are excluded. Their callable interfaces are the local stubs above.
  source=source.replace(/^create extension if not exists pg_(cron|net) with schema extensions;$/gm,'');
  sql(source);
}
console.log(db, 'new security migrations applied to a synthetic baseline in real PostgreSQL');
const rule = (scope,limit=5,amount=1) => JSON.stringify([{scope,period:86400,amount,policy:'test_cap',limit}]);
const reserve = (scope,limit=5,amount=1) => `select public.reserve_security_budget('requests','${rule(scope,limit,amount)}'::jsonb)->>'allowed';`;
sql("update public.security_budget_settings set limits='{}',disabled_services='{}';");
const jobs=Array.from({length:30},()=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-XAt','-v','ON_ERROR_STOP=1']);let output='';let error='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);
  child.on('error',reject);child.on('close',code=>code===0?resolve(output.trim()):reject(new Error(error)));
  child.stdin.end(reserve('concurrency'));
}));
const concurrent=await Promise.all(jobs);
assert.equal(concurrent.filter(value=>value==='true').length,5);
assert.equal(sql("select used from public.security_budget_usage where scope='concurrency';"),'5');
console.log(db,'PASS: 30 simultaneous requests, exactly 5 reservations, no overshoot');
const rules=JSON.stringify([{scope:'app-a',period:86400,amount:1,policy:'test_cap',limit:5},{scope:'concurrency',period:86400,amount:1,policy:'test_cap',limit:5}]);
assert.equal(sql(`select public.reserve_security_budget('requests','${rules}'::jsonb)->>'allowed';`),'false');
assert.equal(sql("select count(*) from public.security_budget_usage where scope='app-a';"),'0');
console.log(db,'PASS: multidimensional reservation rolls back all dimensions on exhaustion');
assert.equal(sql(reserve('shared:multi-app',3)), 'true');
assert.equal(sql(reserve('shared:multi-app',3)), 'true');
assert.equal(sql(reserve('shared:multi-app',3)), 'true');
assert.equal(sql(reserve('shared:multi-app',3)), 'false');
console.log(db,'PASS: shared account counter cannot be duplicated by two app callers on the same database');
sql("update public.security_budget_settings set disabled_services='{uploads}';");
assert.equal(sql(`select public.reserve_security_budget('uploads','${rule('upload')}'::jsonb)->>'allowed';`),'false');
assert.equal(sql(reserve('read-still-available')),'true');
sql("update public.security_budget_settings set disabled_services='{}';");
console.log(db,'PASS: emergency switch blocks uploads while safe reads remain available');
sql("insert into storage.objects(bucket_id,metadata) values('firmador-documents','{\"size\":2147483648}');");
assert.equal(sql(`select public.reserve_security_budget('uploads','${rule('shared:upload-bytes',999999)}'::jsonb)->>'allowed';`),'false');
sql('delete from storage.objects;');
console.log(db,'PASS: live storage ceiling blocks new upload reservations');
const owner='00000000-0000-4000-8000-000000000001';
sql(`insert into auth.users(id,email) values('${owner}','synthetic@example.test');
update public.security_budget_settings set limits='{"active_workflows_per_owner":1}';
insert into public.workflows(id,owner_id,title) values('00000000-0000-4000-8000-000000000002','${owner}','Synthetic workflow');`);
assert.throws(()=>sql(`insert into public.workflows(owner_id,title) values('${owner}','Over quota');`),/Límite de procesos activos/);
assert.equal(sql("select count(*) from public.workflows;"),'1');
console.log(db,'PASS: workflow creation trigger enforces active limit, including direct SQL writes');
assert.equal(sql("select has_function_privilege('anon','public.reserve_security_budget(text,jsonb)','execute');"),'f');
assert.equal(sql("select has_function_privilege('authenticated','public.reserve_security_budget(text,jsonb)','execute');"),'f');
assert.equal(sql("select has_function_privilege('service_role','public.reserve_security_budget(text,jsonb)','execute');"),'t');
console.log(db,'PASS: quota RPC restricted to service_role');
sql(`update public.security_budget_settings set limits='{"contacts_per_owner":1}';
insert into public.owner_contacts(owner_id,email) values('${owner}','one@example.test');`);
assert.throws(()=>sql(`insert into public.owner_contacts(owner_id,email) values('${owner}','two@example.test');`),/Límite de contactos/);
console.log(db,'PASS: address-book quota also applies to direct database writes');
if(db==='firmador') {
  sql("update public.workflows set expected_signature_count=2 where id='00000000-0000-4000-8000-000000000002';");
  const inviteJobs=Array.from({length:12},(_,index)=>new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-XAt','-v','ON_ERROR_STOP=1']);
    let output=''; child.stdout.on('data',chunk=>output+=chunk); child.stderr.on('data',()=>{});
    child.on('error',reject); child.on('close',code=>resolve(code===0));
    child.stdin.end(`insert into public.round_invitations(workflow_id,owner_id,email,token_hash) values('00000000-0000-4000-8000-000000000002','${owner}','synthetic-${index}@example.test','synthetic-${index}');`);
  }));
  assert.equal((await Promise.all(inviteJobs)).filter(Boolean).length,2);
  assert.equal(sql('select count(*) from public.round_invitations;'),'2');
  console.log(db,'PASS: 12 concurrent invitations cannot exceed two signer slots');
  assert.equal(sql("select public.authorize_lifecycle_job(repeat('0',64));"),'f');
  assert.equal(sql("select public.authorize_lifecycle_job(encode(extensions.digest(token,'sha256'),'hex')) from public.security_internal_credentials where purpose='lifecycle';"),'t');
  assert.equal(sql("select command='select public.dispatch_lifecycle_maintenance();' from cron.job where jobname='leapsign-lifecycle-jobs';"),'t');
  sql(`insert into public.superadmin_recovery_codes(user_id,code_hash,expires_at) values('${owner}','synthetic-correct-hash',now()+interval '10 minutes');`);
  for(let i=0;i<5;i++) assert.equal(sql(`select public.consume_superadmin_recovery('${owner}','wrong');`),'f');
  assert.equal(sql(`select public.consume_superadmin_recovery('${owner}','synthetic-correct-hash');`),'f');
  sql(`update public.superadmin_recovery_codes set used_at=now() where user_id='${owner}';
    insert into public.superadmin_recovery_codes(user_id,code_hash,expires_at) values('${owner}','synthetic-new-hash',now()+interval '10 minutes');`);
  assert.equal(sql(`select public.consume_superadmin_recovery('${owner}','synthetic-new-hash');`),'t');
  assert.equal(sql(`select public.consume_superadmin_recovery('${owner}','synthetic-new-hash');`),'f');
  console.log(db,'PASS: internal maintenance credential/schedule and atomic recovery attempt limit');
}
console.log(db,'ALL LOCAL DATABASE SECURITY CHECKS PASSED');
