// Real PostgreSQL, synthetic data only. Never connects to Supabase or resets a DB.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const container = process.env.INVENTORY_TEST_CONTAINER;
if (!container?.startsWith('codex-v11-inventory-')) throw new Error('Specify a disposable local inventory container');
const db = `inventory_${Date.now()}`;
function sql(query) {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', db, '-XAt', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' });
  if (result.status) throw new Error(result.stderr);
  return result.stdout.trim();
}
const created = spawnSync('docker', ['exec', container, 'createdb', '-U', 'postgres', db]);
assert.equal(created.status, 0);
sql(`do $$ begin
  if not exists(select from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select from pg_roles where rolname='authenticated') then create role authenticated; end if;
  if not exists(select from pg_roles where rolname='service_role') then create role service_role bypassrls; end if;
end $$;
create schema auth; create schema storage;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
sql(readFileSync('supabase/migrations/20261013000000_mass_signing.sql', 'utf8'));
// Minimal synthetic additions matching the columns used by the existing acceptance RPC.
sql(`create table public.open_round_waitlist(workflow_id uuid references workflows,session_hash text,holder_name text,email text,joined_at timestamptz default now(),primary key(workflow_id,session_hash));
alter table workflow_audit_log add column actor_session_hash text,add column metadata jsonb;
create table public.round_invitations(id uuid primary key default gen_random_uuid(),workflow_id uuid references workflows on delete cascade,session_hash text,status text default 'opened',expires_at timestamptz default now()+interval '48 hours',completed_at timestamptz);
create table public.file_cleanup_jobs(workflow_id uuid references workflows,storage_path text unique,reason text,scheduled_for timestamptz,status text default 'pending',completed_at timestamptz);`);
sql(readFileSync('supabase/migrations/20261014060000_signed_chain_foundation.sql', 'utf8'));
sql(`alter table document_versions add column submitted_by_name text,add column submitted_by_email text,add column page_count integer,add column page_dimensions jsonb default '[]',add column delete_after timestamptz,add column discarded_at timestamptz;
alter table signature_submissions add column page_count integer,add column page_dimensions jsonb default '[]';
alter table open_round_locks add column holder_email text;`);
const lifecycle = readFileSync('supabase/migrations/20261016020000_coherent_lifecycle_and_validation.sql', 'utf8');
sql(lifecycle.slice(lifecycle.indexOf('create or replace function public.accept_open_signed_submission('), lifecycle.indexOf('create or replace function public.owner_discard_versions(')));
const migration = 'supabase/migrations/20261022010000_signature_inventory.sql';
assert.ok(existsSync(migration), 'signature inventory migration must be implemented');
sql(readFileSync(migration, 'utf8'));
const owner = randomUUID(), other = randomUUID();
sql(`insert into auth.users values('${owner}'),('${other}');`);
const a = 'a'.repeat(64), b = 'b'.repeat(64), sid = 'c'.repeat(64), session = 'd'.repeat(64);
function fixture() {
  const id = randomUUID(), parent = randomUUID();
  sql(`insert into workflows(id,owner_id,title) values('${id}','${owner}','Synthetic');
  insert into document_versions(id,workflow_id,sequence,storage_path,sha256,byte_size) values('${parent}','${id}',0,'${id}/original.pdf','${a}',100);
  update workflows set current_version_id='${parent}' where id='${id}';
  insert into open_round_locks(workflow_id,holder_name,holder_session_hash,expires_at,version_id_at_claim,reviewed_version_at) values('${id}','Synthetic','${session}',now()+interval '10 minutes','${parent}',now());
  insert into round_invitations(workflow_id,session_hash) values('${id}','${session}');`);
  return { id, parent };
}
const call = (fn, args) => JSON.parse(sql(`select public.${fn}(${args});`) || 'null');
const begin = f => call('begin_signature_validation', `'${f.id}','${session}','${f.parent}','${b}',150`);
function report() {
  return { policy:'leapsign-v1.1-integrity-offline-1',accepted:true,baseSha256:a,signedSha256:b,signatureCount:1,inheritedCount:0,addedSignatureIds:[sid],previousSignaturesIntact:true,signatures:[{
    id:sid,field:'Sig1',revision:1,byteRange:[0,10,100,50],declaredSigningTime:null,
    certificate:{subject:'Synthetic',issuer:'Synthetic CA',serial:'1',fingerprint:'e'.repeat(64),notBefore:'2026-01-01T00:00:00Z',notAfter:'2027-01-01T00:00:00Z'},
    algorithms:{digest:'sha256',signature:'ecdsa'},integrity:'valid',trust:'not_evaluated',revocation:'unknown',certificateValidity:'valid_now',coverage:'entire_file',subsequentChanges:'allowed',codes:[] }] };
}
const commitSql = (c, r=report()) => `select public.commit_signature_validation('${c.claim_id}','${c.lease_token}','${JSON.stringify(r)}'::jsonb,1,'[[595,842]]'::jsonb);`;
const f = fixture();
assert.throws(() => begin(f), /INVENTORY_DISABLED/);
console.log('PASS server feature defaults off');
sql('update signature_inventory_settings set enabled=true;');
const c = begin(f);
assert.equal(c.state, 'reserved');
assert.throws(() => begin(f), /VALIDATION_IN_PROGRESS/);
assert.throws(() => sql(commitSql(c,{...report(),signedSha256:a})), /INVALID_INVENTORY_REPORT/);
assert.equal(sql(`select signature_count from workflows where id='${f.id}';`), '0');
assert.equal(sql('select count(*) from version_signature_inventories;'), '0');
console.log('PASS claim fences concurrent validation and invalid report cannot advance');
const received = JSON.parse(sql(commitSql(c)));
assert.equal(received.state, 'accepted');
assert.equal(sql(`select signature_count from workflows where id='${f.id}';`), '1');
assert.equal(sql(`select status from round_invitations where workflow_id='${f.id}';`), 'completed');
assert.equal(sql(`select count(*) from open_round_locks where workflow_id='${f.id}';`), '0');
assert.equal(sql('select count(*) from version_pdf_signatures;'), '1');
assert.equal(sql(`select count(*) from file_cleanup_jobs where storage_path='${c.storage_path}';`),'0');
assert.deepEqual(JSON.parse(sql(commitSql(c))), received);
sql(`update workflows set status='completed' where id='${f.id}';`);
assert.deepEqual(call('get_signature_receipt', `'${f.id}','${session}','${b}'`), received);
assert.equal(call('get_signature_receipt', `'${f.id}','${'f'.repeat(64)}','${b}'`), null);
assert.throws(() => sql(`update version_pdf_signatures set signature_id='${a}';`), /IMMUTABLE/);
assert.throws(() => sql(`update signature_validation_receipts set signed_sha256='${a}' where id='${c.claim_id}';`), /IMMUTABLE/);
console.log('PASS atomic inventory/version/invitation, immutable receipt and recovery after lost reply');
for (const role of ['anon','authenticated']) {
  assert.throws(() => sql(`set role ${role}; select public.begin_signature_validation('${f.id}','${session}','${f.parent}','${b}',150);`), /permission denied/);
  assert.throws(() => sql(`set role ${role}; select * from signature_validation_receipts;`), /permission denied/);
}
sql('grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated; grant select on workflows to authenticated;');
assert.equal(sql(`set role authenticated; set test.user_id='${owner}'; select count(*) from version_pdf_signatures;`), 'SET\nSET\n1');
assert.equal(sql(`set role authenticated; set test.user_id='${other}'; select count(*) from version_pdf_signatures;`), 'SET\nSET\n0');
assert.throws(() => sql(`set role authenticated; insert into version_pdf_signatures select * from version_pdf_signatures;`), /permission denied/);
console.log('PASS owner-only RLS and no direct participant reads/writes/RPC');
for (const reason of ['expired','unreviewed','wrong_session','expired_invite']) {
  const x = fixture();
  if(reason==='expired') sql(`update open_round_locks set expires_at=now()-interval '1 second' where workflow_id='${x.id}';`);
  if(reason==='unreviewed') sql(`update open_round_locks set reviewed_version_at=null where workflow_id='${x.id}';`);
  if(reason==='wrong_session') sql(`update open_round_locks set holder_session_hash='${a}' where workflow_id='${x.id}';`);
  if(reason==='expired_invite') sql(`update round_invitations set expires_at=now()-interval '1 second' where workflow_id='${x.id}';`);
  assert.throws(() => begin(x), /TURN_UNAVAILABLE|INVITATION_UNAVAILABLE/);
}
console.log('PASS expired/unreviewed/wrong turn and expired invitation');
const x = fixture(), old = begin(x);
sql(`update signature_validation_receipts set lease_expires_at=now()-interval '1 second' where id='${old.claim_id}';`);
const renewed = begin(x);
assert.notEqual(renewed.lease_token,old.lease_token);
assert.notEqual(renewed.storage_path,old.storage_path);
assert.throws(() => sql(commitSql(old)), /VALIDATION_LEASE_EXPIRED/);
assert.equal(JSON.parse(sql(commitSql(renewed))).state,'accepted');
console.log('PASS expired lease fencing and immutable storage path per attempt');
const interrupted=fixture(), interruptedTicket=begin(interrupted);
sql(`create function test_inventory_failure() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_PERSISTENCE_FAILURE'; end $$;
create trigger test_failure before insert on version_pdf_signatures for each row execute function test_inventory_failure();`);
assert.throws(()=>sql(commitSql(interruptedTicket)),/SYNTHETIC_PERSISTENCE_FAILURE/);
assert.equal(sql(`select count(*) from document_versions where workflow_id='${interrupted.id}';`),'1');
assert.equal(sql(`select status from round_invitations where workflow_id='${interrupted.id}';`),'opened');
assert.equal(sql(`select count(*) from open_round_locks where workflow_id='${interrupted.id}';`),'1');
assert.equal(sql(`select state from signature_validation_receipts where id='${interruptedTicket.claim_id}';`),'reserved');
sql('drop trigger test_failure on version_pdf_signatures; drop function test_inventory_failure();');
assert.equal(JSON.parse(sql(commitSql(interruptedTicket))).state,'accepted');
console.log('PASS persistence failure rolls back version, invitation and turn together; same receipt can retry');
const expiring=fixture(), expiringTicket=begin(expiring);
sql(`update round_invitations set expires_at=now()-interval '1 second' where workflow_id='${expiring.id}';`);
assert.throws(()=>sql(commitSql(expiringTicket)),/INVITATION_UNAVAILABLE/);
assert.equal(sql(`select signature_count from workflows where id='${expiring.id}';`),'0');
console.log('PASS invitation expiry is rechecked during atomic commit');
const inherited=fixture(), inheritedTicket=begin(inherited), inheritedReport=report();
inheritedReport.signatureCount=3;inheritedReport.inheritedCount=2;
inheritedReport.signatures.unshift(...['1','2'].map(char=>({...report().signatures[0],id:char.repeat(64),field:`Inherited${char}`,coverage:'entire_revision'})));
const inheritedReceipt=JSON.parse(sql(commitSql(inheritedTicket,inheritedReport)));
assert.equal(inheritedReceipt.signature_count,3);
assert.equal(sql(`select signature_count from workflows where id='${inherited.id}';`),'1');
console.log('PASS signatures inherited from original do not count as completed participant turns');
const bypass = fixture(), submission = randomUUID();
sql(`insert into signature_submissions(id,workflow_id,parent_version_id,storage_path,sha256,byte_size,submitted_by_session_hash) values('${submission}','${bypass.id}','${bypass.parent}','${bypass.id}/legacy.pdf','${b}',150,'${session}');`);
assert.throws(() => sql(`select accept_open_signed_submission('${bypass.id}','${session}','${submission}');`), /SIGNATURE_INVENTORY_REQUIRED/);
assert.equal(sql(`select signature_count from workflows where id='${bypass.id}';`),'0');
console.log('PASS database gate prevents legacy acceptance bypass when enabled');
const concurrent = fixture(), ticket = begin(concurrent);
const outputs = await Promise.all(Array.from({length:6},()=>new Promise((resolve,reject)=>{
  const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-XAt','-v','ON_ERROR_STOP=1']);
  let out='',err=''; child.stdout.on('data',v=>out+=v);child.stderr.on('data',v=>err+=v);
  child.on('error',reject);child.on('close',code=>code?reject(new Error(err)):resolve(JSON.parse(out.trim())));child.stdin.end(commitSql(ticket));
})));
assert.ok(outputs.every(out=>out.receipt_id===outputs[0].receipt_id));
assert.equal(sql(`select count(*) from document_versions where workflow_id='${concurrent.id}';`),'2');
console.log('PASS six real concurrent PostgreSQL commits produce one version and one stable receipt');
sql('update signature_inventory_settings set enabled=false;');
assert.equal(call('accept_open_signed_submission', `'${bypass.id}','${session}','${submission}'`).ok,true);
console.log('PASS feature disabled preserves existing v1 acceptance');
