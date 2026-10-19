// Run only against an explicitly named disposable local PostgreSQL container.
import { readFileSync } from 'node:fs';
import { spawnSync, spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const container = process.env.ARCADE_TEST_CONTAINER;
if (!container?.startsWith('codex-arcade-test-')) throw new Error('Set ARCADE_TEST_CONTAINER to a disposable local test container');
function sql(query) {
  const r = spawnSync('docker', ['exec','-i',container,'psql','-U','postgres','-d','arcade','-XAt','-v','ON_ERROR_STOP=1'], { input: query, encoding:'utf8' });
  if (r.status) throw new Error(r.stderr); return r.stdout.trim();
}
const created = spawnSync('docker',['exec',container,'createdb','-U','postgres','arcade']);
if (created.status) throw new Error('Use a fresh database; no reset is performed');
sql('create role anon; create role authenticated; create role service_role bypassrls;');
sql(readFileSync('supabase/migrations/20261019010000_queue_arcade.sql','utf8'));
const run = () => JSON.parse(sql('select public.start_queue_game(42);')).id;
const finish = (id, score, alias='Rana') => JSON.parse(sql(`select public.finish_queue_game('${id}','${alias}',${score});`));
for (const score of [4,12,7,3,20]) finish(run(), score);
assert.equal(sql('select string_agg(score::text,\',\' order by score desc) from public.queue_game_records;'), '20,12,7');
assert.equal(sql('select count(*) from public.queue_game_records;'), '3');
console.log('PASS persistent top 3 across separate sessions');
const duplicate = run(); finish(duplicate, 30);
assert.throws(() => finish(duplicate, 100));
console.log('PASS single-use result');
const expired = run(); sql(`update public.queue_game_runs set expires_at=now()-interval '1 second' where id='${expired}';`);
assert.throws(() => finish(expired, 100));
console.log('PASS expiry');
finish(run(), 30, 'Empate');
assert.equal(sql("select alias from public.queue_game_records order by score desc,achieved_at,id limit 1;"), 'Rana');
console.log('PASS stable ties');
for (const role of ['anon','authenticated']) {
  assert.throws(() => sql(`set role ${role}; select * from public.queue_game_records;`));
  assert.throws(() => sql(`set role ${role}; select public.start_queue_game(42);`));
  assert.throws(() => sql(`set role ${role}; select public.finish_queue_game('${run()}','Fake',500);`));
}
console.log('PASS direct writes and RPC denied to public roles');
const ids = Array.from({length:12}, () => run());
await Promise.all(ids.map((id,index) => new Promise((resolve,reject) => {
  const p = spawn('docker',['exec','-i',container,'psql','-U','postgres','-d','arcade','-v','ON_ERROR_STOP=1'],{stdio:['pipe','ignore','pipe']});
  let error='';p.stderr.on('data',d=>error+=d);p.on('close',c=>c?reject(new Error(error)):resolve());
  p.stdin.end(`select public.finish_queue_game('${id}','Concurrente',${50+index});`);
})));
assert.equal(sql('select string_agg(score::text,\',\' order by score desc) from public.queue_game_records;'), '61,60,59');
console.log('PASS concurrent results retain exactly the best three');
sql("update public.queue_game_runs set expires_at=now()-interval '1 second';"); run();
assert.equal(sql('select count(*) from public.queue_game_runs;'), '1');
sql('insert into public.queue_game_runs(seed) select 1 from generate_series(1,499);');
assert.throws(() => run());
console.log('PASS expired ticket cleanup and 500-ticket storage ceiling');
