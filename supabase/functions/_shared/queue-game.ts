// Fixed-step simulation shared by the canvas and the score verifier (60 Hz).
export const MAX_GAME_TICKS = 18_000;
export type GameState = { tick: number; y: number; velocity: number; x: number; score: number; seed: number; over: boolean };
export function newGame(seed: number): GameState {
  return { tick: 0, y: 0, velocity: 0, x: 460, score: 0, seed: seed >>> 0, over: false };
}
export function stepGame(game: GameState, jump: boolean) {
  if (game.over) return;
  game.tick++;
  if (jump && game.y === 0) game.velocity = 9;
  game.velocity -= .42;
  game.y = Math.max(0, game.y + game.velocity);
  if (!game.y) game.velocity = 0;
  game.x -= 3 + Math.min(game.score * .09, 2.5);
  if (game.x < 58 && game.x + 26 > 24 && game.y < 30) game.over = true;
  if (game.x < -26) {
    game.score++;
    game.seed = (Math.imul(game.seed, 1664525) + 1013904223) >>> 0;
    game.x = 440 + game.seed % 125;
  }
  if (game.tick >= MAX_GAME_TICKS) game.over = true;
}
export function verifyGame(seed: number, ticks: unknown, jumps: unknown) {
  if (!Number.isInteger(ticks) || (ticks as number) < 1 || (ticks as number) > MAX_GAME_TICKS || !Array.isArray(jumps) || jumps.length > 1000) throw new Error('Partida inválida.');
  let previous = 0;
  for (const tick of jumps) {
    if (!Number.isInteger(tick) || tick <= previous || tick > (ticks as number)) throw new Error('Partida inválida.');
    previous = tick;
  }
  const game = newGame(seed);
  let index = 0;
  while (!game.over && game.tick < (ticks as number)) {
    const jump = jumps[index] === game.tick + 1;
    if (jump) index++;
    stepGame(game, jump);
  }
  if (!game.over || game.tick !== ticks) throw new Error('La partida no ha terminado.');
  return game.score;
}
export function publicAlias(value: unknown) {
  if (typeof value !== 'string') throw new Error('Escribe un alias de 2 a 24 caracteres.');
  const alias = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (!/^[\p{L}\p{N} _.-]{2,24}$/u.test(alias)) throw new Error('Usa de 2 a 24 letras o números, sin correos ni enlaces.');
  return alias;
}
