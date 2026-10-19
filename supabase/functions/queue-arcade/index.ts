import { createClient } from 'jsr:@supabase/supabase-js@2';
import { protectEndpoint, reserveBudget } from '../_shared/economic-guard.ts';
import { publicAlias, verifyGame } from '../_shared/queue-game.ts';
const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };
Deno.serve(protectEndpoint('queue-arcade', createClient, async request => {
  try {
    const body = await request.json();
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const records = async () => {
      const result = await admin.from('queue_game_records').select('id,alias,score,achieved_at').order('score', { ascending: false }).order('achieved_at').order('id').limit(3);
      if (result.error) throw new Error('Ranking no disponible. Puedes seguir jugando.');
      return result.data;
    };
    if (body.action === 'list') return Response.json({ records: await records() }, { headers });
    if (body.action === 'start') {
      const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip)));
      const slot = ((digest[0] << 8) | digest[1]) % 1024;
      // The shared ledger accepts a fixed service list. Keep arcade-specific
      // scopes and caps under requests, not an unsupported service category.
      await reserveBudget(admin, 'requests', [
        { scope:'shared:arcade-start',period:86400,amount:1,policy:'arcade_daily',limit:300 },
        { scope:`arcade:${slot}`,period:3600,amount:1,policy:'arcade_source_hourly',limit:10 },
      ]);
      const seed = crypto.getRandomValues(new Uint32Array(1))[0];
      const { data, error } = await admin.rpc('start_queue_game', { p_seed: seed });
      if (error || !data) throw new Error('Ranking no disponible. Puedes jugar sin guardar el resultado.');
      return Response.json({ ...data, records: await records() }, { headers });
    }
    if (body.action !== 'finish' || typeof body.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.id) || body.consent !== true) throw new Error('Solicitud inválida.');
    const alias = publicAlias(body.alias);
    const { data: run, error: runError } = await admin.from('queue_game_runs').select('seed,created_at,expires_at').eq('id', body.id).maybeSingle();
    if (runError || !run || Date.parse(run.expires_at) <= Date.now()) throw new Error('La partida ha caducado o ya se guardó.');
    const score = verifyGame(Number(run.seed), body.ticks, body.jumps);
    if (!score || body.ticks / 60 * 1000 > Date.now() - Date.parse(run.created_at) + 2000) throw new Error('No se pudo validar la partida.');
    const { data, error } = await admin.rpc('finish_queue_game', { p_run: body.id, p_alias: alias, p_score: score });
    if (error || !data) throw new Error('No se pudo guardar. La partida puede haber caducado o haberse guardado ya.');
    return Response.json(data, { headers });
  } catch (error) {
    // Preserve quota/availability errors without exposing provider diagnostics.
    return Response.json({ error: error instanceof Error ? error.message : 'Juego no disponible.' }, { status: typeof (error as {status?:unknown})?.status === 'number' ? (error as {status:number}).status : 400, headers });
  }
}));
