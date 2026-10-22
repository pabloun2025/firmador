import { afterEach, beforeEach, expect, it, vi } from 'vitest';

// Only the external Supabase client is substituted. The actual Edge handler,
// authentication/quotas wrapper, hashing and response logic run unchanged.
const fixture = vi.hoisted(() => ({ client: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fixture.client }));
const id = '22222222-2222-4222-8222-222222222222';
const versionId = '33333333-3333-4333-8333-333333333333';
let tables, handler, failingTable, reviewFailure, signedCalls, userId, authCalls;

beforeEach(async () => {
  vi.resetModules();
  failingTable = ''; reviewFailure = false; signedCalls = 0; authCalls = 0; userId = 'owner-a';
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('synthetic-session'));
  const sessionHash = [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  tables = {
    workflows: [{ id, owner_id: 'owner-a', title: 'Contrato', status: 'active', current_version_id: versionId }],
    document_versions: [{ id: versionId, workflow_id: id, storage_path: `${id}/0.pdf`, byte_size: 500, sequence: 0, discarded_at: null }],
    open_round_locks: [{ workflow_id: id, holder_session_hash: sessionHash, version_id_at_claim: versionId, expires_at: new Date(Date.now() + 600000).toISOString() }],
  };
  fixture.client = {
    rpc: async () => ({ data: { allowed: true }, error: null }),
    auth: { getUser: async () => { authCalls++; return { data: { user: { id: userId } }, error: null }; } },
    from(table) {
      let single = false, updating = false;
      const filters = [];
      const query = {
        select() { return query; }, order() { return query; }, limit() { return query; },
        eq(key, value) { filters.push(row => row[key] === value); return query; },
        in(key, values) { filters.push(row => values.includes(row[key])); return query; },
        is(key, value) { filters.push(row => row[key] === value); return query; },
        update() { updating = true; return query; },
        maybeSingle() { single = true; return query; },
        then(resolve, reject) {
          const error = table === failingTable || (updating && reviewFailure) ? { message: 'private diagnostic', code: '57014' } : null;
          const rows = (tables[table] || []).filter(row => filters.every(filter => filter(row)));
          return Promise.resolve({ data: error ? null : single ? rows[0] || null : rows, error }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: async () => { signedCalls++; return { data: { signedUrl: 'https://files.example.test/synthetic.pdf' }, error: null }; } }) },
  };
  vi.stubGlobal('Deno', {
    env: { get: name => ({ SUPABASE_URL: 'https://local.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', SUPABASE_ANON_KEY: 'synthetic-anon' })[name] },
    serve: callback => { handler = callback; },
  });
});
afterEach(() => vi.unstubAllGlobals());
const request = body => new Request('https://local.test/edge', { method: 'POST', headers: { authorization: 'Bearer synthetic-user', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

it('does not expose another owner workflow or its versions', async () => {
  userId = 'owner-b';
  await import('../supabase/functions/get-owner-round/index.ts');
  const response = await handler(request({ id }));
  expect(response.status).toBe(400);
  expect(await response.json()).not.toHaveProperty('workflow');
});
it('requires an authenticated owner before querying tracking data', async () => {
  await import('../supabase/functions/get-owner-round/index.ts');
  const incoming = request({ id }); incoming.headers.delete('authorization');
  expect((await handler(incoming)).status).toBe(401);
});
it('returns a temporary error rather than pretending a failed queue is empty', async () => {
  failingTable = 'open_round_waitlist';
  await import('../supabase/functions/get-owner-round/index.ts');
  const response = await handler(request({ id }));
  expect(response.status).toBe(503);
  const data = await response.json();
  expect(data).not.toHaveProperty('queue');
  expect(data.error).not.toContain('private diagnostic');
});
it('returns the current versions for the authenticated owner', async () => {
  await import('../supabase/functions/get-owner-round/index.ts');
  const response = await handler(request({ id }));
  expect(response.status).toBe(200);
  expect((await response.json()).versions[0].id).toBe(versionId);
});
it('verifies the owner once per tracking refresh instead of duplicating Auth traffic', async () => {
  await import('../supabase/functions/get-owner-round/index.ts');
  const response = await handler(request({ id }));
  expect(response.status).toBe(200);
  expect(authCalls).toBe(1);
});
it('returns only the authenticated workflow retained signature inventories', async()=>{
  tables.version_signature_inventories=[{workflow_id:id,version_id:versionId,signature_count:1},{workflow_id:'other-round',version_id:versionId,signature_count:99}];
  tables.version_pdf_signatures=[{workflow_id:id,version_id:versionId,signature_id:'a'.repeat(64),record:{integrity:'valid'}},{workflow_id:id,version_id:'discarded-version',signature_id:'b'.repeat(64),record:{integrity:'valid'}}];
  await import('../supabase/functions/get-owner-round/index.ts');
  const response=await handler(request({id}));const data=await response.json();
  expect(response.status).toBe(200);expect(data.signatureInventories).toHaveLength(1);expect(data.pdfSignatures).toHaveLength(1);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
it('does not label an unavailable inventory as an empty signature list',async()=>{
  failingTable='version_pdf_signatures';await import('../supabase/functions/get-owner-round/index.ts');
  const response=await handler(request({id}));expect(response.status).toBe(503);expect(await response.json()).not.toHaveProperty('pdfSignatures');
});
it('does not issue a PDF URL outside an active turn', async () => {
  tables.open_round_locks[0].expires_at = '2020-01-01T00:00:00Z';
  await import('../supabase/functions/participant-download-version/index.ts');
  const response = await handler(request({ id, sessionId: 'synthetic-session' }));
  expect(response.status).toBe(400);
  expect(signedCalls).toBe(0);
});
it('does not return a document belonging to another workflow', async () => {
  tables.document_versions[0].workflow_id = '44444444-4444-4444-8444-444444444444';
  await import('../supabase/functions/participant-download-version/index.ts');
  const response = await handler(request({ id, sessionId: 'synthetic-session' }));
  expect(response.status).toBe(400);
  expect(signedCalls).toBe(0);
});
it('does not claim a successful download when the review marker cannot be saved', async () => {
  reviewFailure = true;
  await import('../supabase/functions/participant-download-version/index.ts');
  const response = await handler(request({ id, sessionId: 'synthetic-session' }));
  expect(response.status).toBe(503);
  expect(await response.json()).not.toHaveProperty('url');
});
it('issues a short-lived URL and readable filename for a valid turn', async () => {
  await import('../supabase/functions/participant-download-version/index.ts');
  const response = await handler(request({ id, sessionId: 'synthetic-session' }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ url: 'https://files.example.test/synthetic.pdf', parentByteSize: 500, expectedFilename: 'Contrato.pdf' });
  expect(response.headers.get('cache-control')).toBe('no-store');
});
