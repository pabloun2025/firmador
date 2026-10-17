import { protectEndpoint, budgetedFetch } from "../_shared/economic-guard.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const reasons = new Set(['La firma está en un lugar incorrecto', 'El archivo no corresponde a este proceso', 'El PDF no se puede abrir o parece corrupto', 'Otro problema']);
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]!));
const appUrl = 'https://firma.veryfacil.org';

Deno.serve(protectEndpoint("report-open-error", createClient, async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id, groupKey = '', sessionId, reason, detail = '', reporterName = '', reporterEmail = '', inviteToken = '' } = await request.json();
    if (typeof id !== 'string' || typeof sessionId !== 'string' || typeof reason !== 'string' || !reasons.has(reason) || typeof detail !== 'string' || detail.trim().length > 500) throw new Error('Selecciona un motivo válido para detener el proceso.');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: workflow } = await admin.from('workflows').select('group_key_hash,status,owner_id,title').eq('id', id).maybeSingle();
    const sessionHash = await hash(sessionId);
    const { data: invitation } = inviteToken ? await admin.from('round_invitations').select('id').eq('workflow_id', id).eq('session_hash', sessionHash).eq('status', 'opened').gt('expires_at', new Date().toISOString()).maybeSingle() : { data: null };
    if (!workflow || workflow.status !== 'active' || (!invitation && workflow.group_key_hash && workflow.group_key_hash !== await hash(groupKey))) throw new Error('No se pudo acceder a esta ronda.');
    const { data: lock } = await admin.from('open_round_locks').select('holder_session_hash').eq('workflow_id', id).maybeSingle();
    if (!lock || lock.holder_session_hash !== sessionHash) throw new Error('Solo la persona con el turno activo puede informar un problema.');
    const { error: updateError } = await admin.from('workflows').update({ status: 'paused_error', paused_at: new Date().toISOString(), paused_reason: reason }).eq('id', id).eq('status', 'active');
    if (updateError) throw updateError;
    const { data: waiter } = await admin.from('open_round_waitlist').select('holder_name,email').eq('workflow_id', id).eq('session_hash', sessionHash).maybeSingle();
    const reporter = { name: String(waiter?.holder_name ?? reporterName).trim().slice(0, 120) || null, email: String(waiter?.email ?? reporterEmail).trim().toLowerCase() || null };
    await admin.from('error_reports').insert({ workflow_id: id, reporter_session_hash: sessionHash, comment: reason, reason, detail: detail.trim() || null, reporter_name: reporter.name, reporter_email: reporter.email });
    await admin.from('open_round_locks').delete().eq('workflow_id', id).eq('holder_session_hash', sessionHash);
    await admin.from('workflow_audit_log').insert({ workflow_id: id, actor_type: 'participant', actor_session_hash: sessionHash, action: 'round_paused_by_report', metadata: { reason } });
    const key = Deno.env.get('RESEND_API_KEY'); const from = Deno.env.get('RESEND_FROM_EMAIL');
    if (key && from) {
      const { data: owner } = await admin.auth.admin.getUserById(workflow.owner_id);
      if (owner.user?.email) {
        const info = [reporter.name && `Nombre: ${escapeHtml(reporter.name)}`, reporter.email && `Correo: ${escapeHtml(reporter.email)}`, `Motivo: ${escapeHtml(reason)}`, detail.trim() && `Observación: ${escapeHtml(detail.trim())}`].filter(Boolean).map(line => `<li>${line}</li>`).join('');
        const response = await budgetedFetch(admin, 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [owner.user.email], subject: `Acción requerida: incidencia en ${workflow.title}`, html: `<main style="font-family:Arial,sans-serif;color:#183e35"><h1>LeapSign</h1><p>El proceso <strong>${escapeHtml(workflow.title)}</strong> se detuvo para evitar que continúe con un documento posiblemente incorrecto.</p><ul>${info}</ul><p><a href="${appUrl}" style="display:inline-block;background:#1d5749;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Abrir seguimiento del proceso</a></p></main>` }) });
        if (!response.ok) console.error('No se pudo enviar el aviso de incidencia', response.status);
      }
    }
    return Response.json({ ok: true }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 400, headers: cors });
  }
}));
