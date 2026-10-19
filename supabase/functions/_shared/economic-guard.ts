// No external dependencies: also exercised by local security tests.
type Rule = { scope: string; period: number; amount: number; policy: string; limit: number };
export type BudgetClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
  auth: { getUser: (token: string) => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};
type ClientFactory = (url: string, key: string) => BudgetClient;
type Handler = (request: Request, context: { ownerId?: string }) => Response | Promise<Response>;
type Runtime = { env: { get: (name: string) => string | undefined } };
const env = (name: string) => (globalThis as unknown as { Deno: Runtime }).Deno.env.get(name);
const day = 86_400;
export class BudgetError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export async function reserveBudget(client: BudgetClient, service: string, rules: Rule[]) {
  try {
    const { data, error } = await client.rpc('reserve_security_budget', { p_service: service, p_rules: rules });
    if (error || !data || typeof data !== 'object') throw new Error('budget unavailable');
    const result = data as { allowed?: boolean; reason?: string };
    if (typeof result.allowed !== 'boolean') throw new Error('invalid budget response');
    if (result.allowed !== true) throw new BudgetError(429, 'BUDGET_EXHAUSTED', 'Se alcanzó el límite temporal de esta operación. Inténtalo más tarde.');
  } catch (error) {
    if (error instanceof BudgetError) throw error;
    throw new BudgetError(503, 'BUDGET_UNAVAILABLE', 'La operación está temporalmente suspendida. Inténtalo más tarde.');
  }
}
export async function boundedBody(request: Request, maxBytes: number): Promise<Request> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maxBytes)) {
    throw new BudgetError(413, 'BODY_TOO_LARGE', 'La solicitud supera el tamaño permitido.');
  }
  if (!request.body) return request;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => { reject(new BudgetError(408, 'BODY_TIMEOUT', 'La carga tardó demasiado.')); void reader.cancel().catch(() => {}); }, 15_000);
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), expired]);
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { void reader.cancel().catch(() => {}); throw new BudgetError(413, 'BODY_TOO_LARGE', 'La solicitud supera el tamaño permitido.'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new Request(request.url, { method: request.method, headers: request.headers, body: bytes });
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
const ownerEndpoints = new Set(['create-round', 'create-directed', 'send-round-invitations', 'get-owner-round', 'owner-round-action', 'owner-download-version', 'owner-final-share', 'superadmin-console', 'superadmin-recovery']);
const uploadEndpoints = new Set(['create-round', 'create-directed', 'submit-signed-version']);
export function protectEndpoint(endpoint: string, createClient: ClientFactory, handler: Handler): (request: Request) => Promise<Response> {
  return async request => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
    if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
    if (request.method !== 'POST') return Response.json({ error: 'Método no permitido.' }, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
    try {
      const key = env('SUPABASE_SERVICE_ROLE_KEY'); const url = env('SUPABASE_URL');
      if (!key || !url) throw new BudgetError(503, 'CONFIGURATION_REQUIRED', 'Servicio no disponible.');
      // An anon JWT is not sufficient for maintenance, even if the gateway accepts it.
      const client = createClient(url, key);
      if (endpoint === 'process-lifecycle-jobs' && request.headers.get('authorization') !== `Bearer ${key}`) {
        const token = request.headers.get('x-lifecycle-token') || '';
        if (!/^[a-f0-9]{64}$/.test(token)) throw new BudgetError(401, 'INTERNAL_ONLY', 'No autorizado.');
        const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
        const { data, error } = await client.rpc('authorize_lifecycle_job', { p_token_hash: digest });
        if (error || data !== true) throw new BudgetError(401, 'INTERNAL_ONLY', 'No autorizado.');
      }
      const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
      if (ownerEndpoints.has(endpoint) && !token) throw new BudgetError(401, 'AUTH_REQUIRED', 'Inicia sesión para continuar.');
      // Reserve the shared/source budget BEFORE remote authentication; otherwise
      // replaying a valid anon key at an owner route would bypass the ledger.
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)));
      let actor = `public-slot-${((bytes[0] << 8) | bytes[1]) % 1024}`;
      let ownerId: string | undefined;
      await reserveBudget(client, 'requests', [
        { scope: 'shared:requests', period: day, amount: 1, policy: 'requests_daily', limit: 50_000 },
        { scope: `endpoint:${endpoint}`, period: 3600, amount: 1, policy: 'endpoint_hourly', limit: 6_000 },
        { scope: `source:${actor}`, period: 3600, amount: 1, policy: 'source_hourly', limit: 1_200 },
      ]);
      if (ownerEndpoints.has(endpoint)) {
        const { data, error } = await client.auth.getUser(token!);
        if (error || !data.user) throw new BudgetError(401, 'AUTH_REQUIRED', 'La sesión no es válida.');
        actor = data.user.id;
        ownerId = data.user.id;
        await reserveBudget(client, 'requests', [
          { scope: `actor:${actor}`, period: 3600, amount: 1, policy: 'actor_hourly', limit: 1_200 },
        ]);
      }
      if (endpoint === 'process-lifecycle-jobs') await reserveBudget(client, 'maintenance', [
        { scope: 'shared:maintenance', period: 60, amount: 1, policy: 'maintenance_minute', limit: 1 },
      ]);
      if (uploadEndpoints.has(endpoint)) await reserveBudget(client, 'uploads', [
        { scope: 'shared:upload-attempts', period: day, amount: 1, policy: 'upload_attempts_daily', limit: 1_000 },
        { scope: `upload:${actor}`, period: 3600, amount: 1, policy: 'upload_actor_hourly', limit: 60 },
      ]);
      const bounded = await boundedBody(request, uploadEndpoints.has(endpoint) ? 11 * 1024 * 1024 : 64 * 1024);
      const response = await handler(bounded, { ownerId });
      response.headers.set('Cache-Control', 'no-store');
      return response;
    } catch (error) {
      const known = error instanceof BudgetError;
      return Response.json({ error: known ? error.message : 'Servicio temporalmente no disponible.', code: known ? error.code : 'SERVICE_UNAVAILABLE' }, {
        status: known ? error.status : 503,
        headers: { ...cors, ...(known && error.status === 429 ? { 'Retry-After': '60' } : {}) },
      });
    }
  };
}
export async function reserveUpload(client: BudgetClient, bytes: number, ownerId: string) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024) throw new BudgetError(413, 'FILE_TOO_LARGE', 'El PDF supera el tamaño permitido.');
  await reserveBudget(client, 'uploads', [
    { scope: 'shared:upload-bytes', period: day, amount: bytes, policy: 'upload_bytes_daily', limit: 500 * 1024 * 1024 },
    { scope: `owner-upload:${ownerId}`, period: day, amount: bytes, policy: 'owner_upload_bytes_daily', limit: 100 * 1024 * 1024 },
  ]);
}
export async function reserveDownload(client: BudgetClient, versionId: string, bytes: number) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 10 * 1024 * 1024) throw new BudgetError(503, 'INVALID_DOWNLOAD_SIZE', 'No pudimos preparar la descarga.');
  // Meter URL issuance, not actual transfer: replay remains an infrastructure risk.
  await reserveBudget(client, 'downloads', [
    { scope: 'shared:download-issuance-bytes', period: day, amount: bytes, policy: 'download_issuance_bytes_daily', limit: 2 * 1024 * 1024 * 1024 },
    { scope: `download-version:${versionId}`, period: day, amount: bytes, policy: 'version_download_issuance_bytes_daily', limit: 500 * 1024 * 1024 },
  ]);
}
export async function budgetedFetch(client: BudgetClient, url: string, init: RequestInit) {
  if (url !== 'https://api.resend.com/emails' || typeof init.body !== 'string') throw new Error('Unsupported billable service');
  const message = JSON.parse(init.body) as { to?: unknown; cc?: unknown; bcc?: unknown };
  const targets = [message.to, message.cc, message.bcc].flatMap(value => value == null ? [] : Array.isArray(value) ? value : [value]);
  if (!targets.length || targets.length > 25 || targets.some(value => typeof value !== 'string' || value.length > 254)) throw new Error('Invalid recipients');
  try { await reserveBudget(client, 'emails', [
    { scope: 'shared:emails', period: day, amount: targets.length, policy: 'emails_daily', limit: 500 },
    { scope: 'shared:emails', period: 30 * day, amount: targets.length, policy: 'emails_30day_window', limit: 5_000 },
  ]); } catch (error) {
    if (!(error instanceof BudgetError)) throw error;
    return Response.json({ code: error.code }, { status: error.status });
  }
  // Failed/uncertain sends still consume a reservation: never refund in a retry loop.
  try { return await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) }); }
  catch { return Response.json({ code: 'EMAIL_PROVIDER_UNAVAILABLE' }, { status: 502 }); }
}
