import { expect, it } from 'vitest';
import { assertQuerySuccess, DataUnavailableError } from '../supabase/functions/_shared/query-results';

it('does not turn database failures into a successful empty tracking response', () => {
  expect(() => assertQuerySuccess([{ error: null }, { error: { code: '57014', message: 'private diagnostic' } }]))
    .toThrow(DataUnavailableError);
});
it('does not expose private database diagnostics in the user-facing error', () => {
  try { assertQuerySuccess([{ error: { message: 'private diagnostic' } }]); }
  catch (error) {
    expect((error as Error).message).not.toContain('private diagnostic');
    expect((error as DataUnavailableError).status).toBe(503);
    return;
  }
  throw new Error('Expected failure');
});
it('accepts successful queries including empty optional rows', () => {
  expect(() => assertQuerySuccess([{ error: null }, { error: null }])).not.toThrow();
});
