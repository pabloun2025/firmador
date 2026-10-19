export class DataUnavailableError extends Error {
  readonly status = 503;
  constructor() { super('No pudimos consultar los datos en este momento. Inténtalo de nuevo.'); }
}
/** An unavailable query must not masquerade as an empty list or missing row. */
export function assertQuerySuccess(results: readonly { error: unknown }[]) {
  if (results.some(result => result.error)) throw new DataUnavailableError();
}
