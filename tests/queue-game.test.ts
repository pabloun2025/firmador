import { describe, expect, it } from 'vitest';
import { newGame, stepGame, verifyGame, publicAlias, MAX_GAME_TICKS } from '../supabase/functions/_shared/queue-game';
describe('queue arcade verification', () => {
  it('replays exactly the same deterministic game, not a supplied score', () => {
    const game = newGame(42); const jumps: number[] = [];
    while (!game.over) {
      const jump = game.x < 112 && game.x > 104 && game.y === 0 && game.score < 3;
      if (jump) jumps.push(game.tick + 1);
      stepGame(game, jump);
    }
    expect(game.score).toBeGreaterThan(0);
    expect(verifyGame(42, game.tick, jumps)).toBe(game.score);
  });
  it('rejects incomplete games, duplicate inputs and oversized proofs', () => {
    expect(() => verifyGame(1, 10, [])).toThrow();
    expect(() => verifyGame(1, 100, [2, 2])).toThrow();
    expect(() => verifyGame(1, MAX_GAME_TICKS + 1, [])).toThrow();
    expect(() => verifyGame(1, 200, new Array(1001).fill(1))).toThrow();
    expect(() => verifyGame(1, 200, [201])).toThrow();
  });
  it('stops at a collision and cannot append extra scoring frames', () => {
    const game = newGame(1); while (!game.over) stepGame(game, false);
    expect(verifyGame(1, game.tick, [])).toBe(0);
    expect(() => verifyGame(1, game.tick + 1, [])).toThrow();
    const tick = game.tick; stepGame(game, true); expect(game.tick).toBe(tick);
  });
  it('accepts a short public alias, not an email, URL or HTML', () => {
    expect(publicAlias('  Rana  Azul  ')).toBe('Rana Azul');
    expect(publicAlias('José')).toBe('José');
    for (const value of ['a', '', 'x'.repeat(25), 'a@b.com', 'https://web.com', '<script>', null]) expect(() => publicAlias(value)).toThrow();
  });
});
