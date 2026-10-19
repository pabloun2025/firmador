import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { newGame, stepGame } from '../supabase/functions/_shared/queue-game';
const fixture = vi.hoisted(() => ({ client: null as any }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fixture.client }));
let handler: (request: Request) => Promise<Response>;
let finished: any, run: any, failed: boolean, budgets: string[];
const id = '22222222-2222-4222-8222-222222222222';
const request = (body: any) => new Request('https://local.test', { method: 'POST', body: JSON.stringify(body) });
beforeEach(async () => {
  vi.resetModules(); finished = null; failed = false; budgets = [];
  run = { seed: 42, created_at: new Date(Date.now() - 120000).toISOString(), expires_at: new Date(Date.now() + 600000).toISOString() };
  fixture.client = {
    rpc: async (name: string, args: any) => {
      budgets.push(name);
      if (name === 'reserve_security_budget') {
        if (!['requests','uploads','downloads','emails','creation','maintenance'].includes(args.p_service)) return { data: null, error: { message: 'invalid budget reservation' } };
        return { data: { allowed: !failed }, error: null };
      }
      if (name === 'start_queue_game') return { data: { id, seed: 42 }, error: null };
      finished = args; run = null; return { data: { ranked: true, records: [] }, error: null };
    },
    from: (table: string) => {
      const q: any = { select: () => q, order: () => q, limit: () => q, eq: () => q, maybeSingle: () => q,
        then: (resolve: any) => Promise.resolve({ data: table === 'queue_game_runs' ? run : [], error: null }).then(resolve) };
      return q;
    },
  };
  vi.stubGlobal('Deno', { env: { get: (name: string) => ({ SUPABASE_URL: 'https://local.test', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-only' })[name] }, serve: (h: typeof handler) => { handler = h; } });
  const edgeEntry = '../supabase/functions/queue-arcade/index.ts';
  await import(edgeEntry);
});
afterEach(() => vi.unstubAllGlobals());
it('lists only public ranking fields and reserves the shared request budget', async () => {
  const response = await handler(request({ action: 'list' }));
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ records: [] });
  expect(budgets).toContain('reserve_security_budget');
});
it('fails closed when the shared budget is unavailable', async () => {
  failed = true;
  expect((await handler(request({ action: 'start' }))).status).toBe(429);
  expect(budgets).not.toContain('start_queue_game');
});
it('starts a real ranking ticket using only budget services accepted by the database', async () => {
  const response = await handler(request({ action: 'start' }));
  expect(response.status).toBe(200);
  expect((await response.json()).id).toBe(id);
  expect(budgets).toContain('start_queue_game');
});
it('requires voluntary consent and a safe alias', async () => {
  expect((await handler(request({ action: 'finish', id, alias: 'Rana', consent: false }))).status).toBe(400);
  expect((await handler(request({ action: 'finish', id, alias: 'a@b.com', consent: true }))).status).toBe(400);
  expect(finished).toBeNull();
});
function proof() {
  const game = newGame(42), jumps: number[] = [];
  while (!game.over) {
    const jump = game.x < 112 && game.x > 104 && game.y === 0 && game.score < 2;
    if (jump) jumps.push(game.tick + 1); stepGame(game, jump);
  }
  return { action: 'finish', id, alias: 'Rana veloz', consent: true, ticks: game.tick, jumps, score: 999999 };
}
it('computes the score on the server and refuses replay of a submitted ticket', async () => {
  const response = await handler(request(proof()));
  expect(response.status).toBe(200); expect(finished.p_score).toBeGreaterThan(0); expect(finished.p_score).toBeLessThan(999999);
  expect((await handler(request(proof()))).status).toBe(400);
});
it('rejects expired runs and results submitted faster than real elapsed time', async () => {
  run.expires_at = '2000-01-01';
  expect((await handler(request(proof()))).status).toBe(400);
  run.expires_at = new Date(Date.now() + 600000).toISOString(); run.created_at = new Date().toISOString();
  expect((await handler(request(proof()))).status).toBe(400); expect(finished).toBeNull();
});
