import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const encoder = new TextEncoder();
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id, groupKey = '', inviteToken = '' } = await request.json();
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id) || typeof groupKey !== 'string' || typeof inviteToken !== 'string') throw new Error('Enlace inválido.');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: round } = await admin.from('workflows').select('id,title,message,status,group_key_hash').eq('id', id).maybeSingle();
    if (!round || round.status !== 'active') throw new Error('Esta ronda no está disponible.');
    let privateInvite = false;
    if (inviteToken) {
      const tokenHash = await hash(inviteToken);
      let { data: invitation } = await admin.from('round_invitations').select('id,status,expires_at').eq('workflow_id', id).eq('token_hash', tokenHash).maybeSingle();
      if (!invitation) {
        const { data: reminderToken } = await admin.from('round_invitation_tokens')
          .select('invitation:round_invitations!inner(id,status,expires_at,workflow_id)')
          .eq('token_hash', tokenHash).eq('invitation.workflow_id', id).gt('expires_at', new Date().toISOString()).maybeSingle();
        invitation = (Array.isArray(reminderToken?.invitation) ? reminderToken.invitation[0] : reminderToken?.invitation) ?? null;
      }
      if (!invitation) throw new Error('La invitación no es válida.');
      if (invitation.status === 'completed') throw new Error('Esta invitación ya fue completada. No es posible firmar dos veces con el mismo enlace.');
      if (new Date(invitation.expires_at).getTime() <= Date.now()) throw new Error('La invitación ha caducado. Solicita una nueva al creador.');
      privateInvite = ['pending', 'opened', 'cancelled'].includes(invitation.status);
      if (!privateInvite) throw new Error('Esta invitación ya no está disponible.');
    }
    if (!privateInvite && round.group_key_hash && !groupKey) return Response.json({ needsKey: true }, { headers: cors });
    if (!privateInvite && round.group_key_hash && round.group_key_hash !== await hash(groupKey)) throw new Error('La clave no es correcta.');
    return Response.json({ title: round.title, message: round.message, needsKey: false }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 400, headers: cors });
  }
});
