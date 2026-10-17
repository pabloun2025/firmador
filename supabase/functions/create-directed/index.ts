import { protectEndpoint, reserveUpload } from "../_shared/economic-guard.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { safeDocumentName } from '../_shared/document-name.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const encoder = new TextEncoder();
const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const allowedDeadlines = new Set([30, 60, 120, 300, 720, 1440, 2880]);

type ParticipantInput = { name: string; email: string; deadlineMinutes: number };

Deno.serve(protectEndpoint("create-directed", createClient, async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization) throw new Error('No autorizado.');
    const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await client.auth.getUser();
    if (userError || !user) throw new Error('No autorizado.');

    const form = await request.formData();
    const title = String(form.get('title') ?? '').trim();
    const message = String(form.get('message') ?? '').trim();
    const document = form.get('document');
    let participants: ParticipantInput[];
    try { participants = JSON.parse(String(form.get('participants') ?? '[]')); } catch { throw new Error('La lista de firmantes no es válida.'); }
    if (!title || title.length > 120 || message.length > 500 || !(document instanceof File)) throw new Error('Datos de flujo inválidos.');
    if (!Array.isArray(participants) || participants.length < 1 || participants.length > 20) throw new Error('Añade entre 1 y 20 firmantes.');
    const emails = new Set<string>();
    for (const participant of participants) {
      const email = String(participant.email ?? '').trim().toLowerCase();
      if (!String(participant.name ?? '').trim() || !/^\S+@\S+\.\S+$/.test(email) || !allowedDeadlines.has(Number(participant.deadlineMinutes)) || emails.has(email)) throw new Error('Los firmantes o sus plazos no son válidos.');
      emails.add(email);
    }
    if (document.size === 0 || document.size > 10 * 1024 * 1024) throw new Error('El PDF debe pesar como máximo 10 MB.');
    const bytes = new Uint8Array(await document.arrayBuffer());
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new Error('El archivo no es un PDF legible.');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    await reserveUpload(admin, document.size, user.id);
    const { data: workflow, error: workflowError } = await admin.from('workflows').insert({ owner_id: user.id, title, message, mode: 'directed', original_filename: safeDocumentName(title) }).select('id').single();
    if (workflowError || !workflow) throw new Error('No se pudo crear el flujo.');
    const path = `${workflow.id}/0.pdf`;
    const rollback = async () => { await admin.storage.from('firmador-documents').remove([path]); await admin.from('workflows').delete().eq('id', workflow.id); };
    const { error: uploadError } = await admin.storage.from('firmador-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (uploadError) { await admin.from('workflows').delete().eq('id', workflow.id); throw new Error('No se pudo guardar el PDF.'); }
    const creatorName = ([user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(' ').trim() || user.user_metadata?.full_name || user.email || 'Creador del proceso').slice(0, 120);
    const { data: version, error: versionError } = await admin.from('document_versions').insert({ workflow_id: workflow.id, sequence: 0, storage_path: path, sha256: await digest(bytes), byte_size: document.size, submitted_by_name: creatorName, submitted_by_email: user.email ?? null }).select('id').single();
    if (versionError || !version) { await rollback(); throw new Error('No se pudo registrar el PDF.'); }
    const { error: currentVersionError } = await admin.from('workflows').update({ current_version_id: version.id }).eq('id', workflow.id).eq('owner_id', user.id);
    if (currentVersionError) { await rollback(); throw new Error('No se pudo preparar el documento.'); }
    const rows = participants.map((participant, index) => ({ workflow_id: workflow.id, position: index + 1, name: participant.name.trim(), email: participant.email.trim().toLowerCase(), deadline_minutes: Number(participant.deadlineMinutes) }));
    const { error: participantsError } = await admin.from('workflow_participants').insert(rows);
    if (participantsError) { await rollback(); throw new Error('No se pudieron guardar los firmantes.'); }
    await admin.from('workflow_audit_log').insert({ workflow_id: workflow.id, actor_type: 'owner', actor_user_id: user.id, action: 'directed_created', metadata: { participant_count: participants.length } });
    return Response.json({ id: workflow.id }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 400, headers: cors });
  }
}));
