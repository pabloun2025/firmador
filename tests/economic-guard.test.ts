import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { boundedBody, budgetedFetch, protectEndpoint, reserveBudget, reserveDownload, reserveUpload, type BudgetClient } from '../supabase/functions/_shared/economic-guard';

const request = (body = '{}', headers: Record<string,string> = {}) => new Request('https://local.test/endpoint', { method: 'POST', body, headers });
function client(allowed = true): BudgetClient {
  return { rpc: vi.fn(async () => ({ data: { allowed }, error: null })), auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'verified-owner' } }, error: null })) } };
}
beforeEach(() => vi.stubGlobal('Deno', { env: { get: (name: string) => ({ SUPABASE_URL: 'https://local.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' } as Record<string,string>)[name] } }));
afterEach(() => vi.unstubAllGlobals());
describe('server economic controls', () => {
  it('times out a stalled upload rather than accepting an incomplete body', async () => {
    vi.useFakeTimers();
    try {
      const body = new ReadableStream<Uint8Array>({ start() {} });
      const incoming = new Request('https://local.test', { method: 'POST', body, duplex: 'half' } as RequestInit);
      const pending = expect(boundedBody(incoming, 100)).rejects.toMatchObject({ status: 408 });
      await vi.advanceTimersByTimeAsync(15_000); await pending;
    } finally { vi.useRealTimers(); }
  });
  it('limits authenticated routes before a remote auth lookup can amplify requests', async () => {
    const db = client(false); const action = vi.fn(() => new Response('unexpected'));
    const response = await protectEndpoint('create-round', () => db, action)(request('{}', { authorization: 'Bearer synthetic-anon-key' }));
    expect(response.status).toBe(429); expect(db.auth.getUser).not.toHaveBeenCalled(); expect(action).not.toHaveBeenCalled();
  });
  it('keeps every deployed endpoint behind the guard and all email calls metered', () => {
    for (const dir of readdirSync('supabase/functions').filter(name => !name.startsWith('_'))) {
      const source = readFileSync(`supabase/functions/${dir}/index.ts`, 'utf8');
      expect(source, dir).toContain('Deno.serve(protectEndpoint(');
      expect(source, dir).not.toMatch(/\bfetch\(/);
    }
  });
  it('meters signed download issuance separately from actual provider egress', async () => {
    const db = client(); await reserveDownload(db, 'synthetic-version', 1024);
    expect(vi.mocked(db.rpc).mock.calls[0][1]).toMatchObject({ p_service: 'downloads', p_rules: [{ amount: 1024 }, { amount: 1024 }] });
  });

  it('never invokes the operation when a shared quota is exhausted', async () => {
    const action = vi.fn(() => new Response('unexpected')); const db = client(false);
    const result = await protectEndpoint('get-round', () => db, action)(request());
    expect(result.status).toBe(429); expect(result.headers.get('retry-after')).toBe('60'); expect(action).not.toHaveBeenCalled();
  });
  it('fails closed on a database error or invalid quota response', async () => {
    for (const rpc of [async () => ({ data: null, error: new Error('offline') }), async () => ({ data: {}, error: null }), async () => { throw new Error('network'); }]) {
      const action = vi.fn(() => new Response('unexpected')); const db = { ...client(), rpc };
      const result = await protectEndpoint('get-round', () => db, action)(request());
      expect(result.status).toBe(503); expect(action).not.toHaveBeenCalled();
    }
  });
  it('requires the internal credential before any maintenance database access', async () => {
    const create = vi.fn(() => client()); const action = vi.fn(() => new Response('ok'));
    const handle = protectEndpoint('process-lifecycle-jobs', create, action);
    for (const authorization of ['', 'Bearer synthetic-anon-key', 'Bearer synthetic-user-jwt']) {
      expect((await handle(request('{}', { authorization }))).status).toBe(401);
    }
    expect(action).not.toHaveBeenCalled();
    expect((await handle(request('{}', { authorization: 'Bearer synthetic-service-key' }))).status).toBe(200);
    expect(create).toHaveBeenCalledTimes(4);
  });
  it('rejects a fabricated scheduler credential before executing maintenance', async () => {
    const db = client(); db.rpc = vi.fn(async () => ({ data: false, error: null }));
    const action = vi.fn(() => new Response('unexpected'));
    const result = await protectEndpoint('process-lifecycle-jobs', () => db, action)(request('{}', { 'x-lifecycle-token': '0'.repeat(64) }));
    expect(result.status).toBe(401); expect(action).not.toHaveBeenCalled();
  });
  it('authenticates an owner instead of trusting a supplied session ID', async () => {
    const db = client(); const action = vi.fn(() => new Response('ok'));
    const handle = protectEndpoint('create-round', () => db, action);
    expect((await handle(request())).status).toBe(401);
    expect(db.rpc).not.toHaveBeenCalled();
    expect((await handle(request('{}', { authorization: 'Bearer synthetic-user-jwt' }))).status).toBe(200);
    expect(JSON.stringify(vi.mocked(db.rpc).mock.calls)).toContain('verified-owner');
  });
  it('does not trust content-length to enforce the actual body size', async () => {
    await expect(boundedBody(request('too large'), 3)).rejects.toMatchObject({ status: 413 });
    await expect(boundedBody(request('small', { 'content-length': '99999' }), 30)).rejects.toMatchObject({ status: 413 });
    expect(await (await boundedBody(request('valid'), 5)).text()).toBe('valid');
  });
  it('rejects oversized streaming bodies without a content-length header', async () => {
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(50)); controller.enqueue(new Uint8Array(50)); controller.close(); } });
    const streamed = new Request('https://local.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
    await expect(boundedBody(streamed, 60)).rejects.toMatchObject({ status: 413 });
  });
  it('passes a valid body and leaves existing successful behavior intact', async () => {
    const result = await protectEndpoint('get-round', () => client(), async req => Response.json(await req.json()))(request('{"id":"synthetic"}'));
    expect(result.status).toBe(200); expect(await result.json()).toEqual({ id: 'synthetic' }); expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('rejects unsupported methods before authentication and budget work', async () => {
    const create = vi.fn(() => client()); const handler = protectEndpoint('get-round', create, () => new Response('ok'));
    expect((await handler(new Request('https://local.test'))).status).toBe(405);
    expect((await handler(new Request('https://local.test', { method: 'OPTIONS' }))).status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
  it('reserves actual upload bytes before storage and rejects oversize files', async () => {
    const db = client(); await reserveUpload(db, 1024, 'synthetic-owner');
    expect(vi.mocked(db.rpc).mock.calls[0][1]).toMatchObject({ p_service: 'uploads', p_rules: [{ amount: 1024 }, { amount: 1024 }] });
    await expect(reserveUpload(db, 11 * 1024 * 1024, 'owner')).rejects.toMatchObject({ status: 413 });
  });
  it('never contacts the email provider after email budget exhaustion', async () => {
    const send = vi.fn(); vi.stubGlobal('fetch', send);
    const result = await budgetedFetch(client(false), 'https://api.resend.com/emails', { method: 'POST', body: JSON.stringify({ to: ['synthetic@example.test'] }) });
    expect(result.status).toBe(429); expect(send).not.toHaveBeenCalled();
  });
  it('counts recipients rather than API calls and bounds provider time', async () => {
    const db = client(); const send = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}')); vi.stubGlobal('fetch', send);
    await budgetedFetch(db, 'https://api.resend.com/emails', { method: 'POST', body: JSON.stringify({ to: ['a@example.test', 'b@example.test'], cc: ['c@example.test'] }) });
    expect(vi.mocked(db.rpc).mock.calls[0][1]).toMatchObject({ p_rules: [{ amount: 3 }, { amount: 3 }] });
    expect(send.mock.calls[0][1]).toHaveProperty('signal');
  });
  it('does not refund uncertain sends or fail an already accepted signature', async () => {
    const db = client(); vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout'); }));
    expect((await budgetedFetch(db, 'https://api.resend.com/emails', { body: JSON.stringify({ to: ['a@example.test'] }) })).status).toBe(502);
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });
  it('uses one shared account counter, independent of application-supplied identity', async () => {
    const db = client(); const handler = protectEndpoint('get-round', () => db, () => new Response('ok'));
    await handler(request('{"sessionId":"one"}')); await handler(request('{"sessionId":"two"}'));
    const [one, two] = vi.mocked(db.rpc).mock.calls;
    expect(one[1]).toEqual(two[1]); expect(JSON.stringify(one[1])).toContain('shared:requests');
  });
  it('reports budget exhaustion for direct callers', async () => {
    await expect(reserveBudget(client(false), 'emails', [])).rejects.toMatchObject({ status: 429 });
  });
});
