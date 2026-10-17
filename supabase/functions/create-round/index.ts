import { protectEndpoint, reserveUpload } from "../_shared/economic-guard.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { inspectPdf } from '../_shared/pdf-validation.ts';
import { safeDocumentName } from '../_shared/document-name.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const encoder = new TextEncoder();
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const hashBytes = async (value: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', value))].map(x => x.toString(16).padStart(2, '0')).join('');

Deno.serve(protectEndpoint("create-round", createClient, async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = request.headers.get('Authorization');
    if (!auth) throw new Error('No autorizado.');
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error('No autorizado.');
    const form = await request.formData();
    const title = String(form.get('title') ?? '').trim(); const message = String(form.get('message') ?? '').trim(); const groupKey = String(form.get('groupKey') ?? '');
    const expectedRaw = String(form.get('expectedSignatures') ?? '').trim();
    const expectedSignatureCount = expectedRaw ? Number(expectedRaw) : null;
    const document = form.get('document');
    if (!title || title.length > 80 || message.length > 500 || !(document instanceof File)) throw new Error('El nombre debe tener entre 1 y 80 caracteres.');
    if (expectedSignatureCount !== null && (!Number.isInteger(expectedSignatureCount) || expectedSignatureCount < 1 || expectedSignatureCount > 20)) throw new Error('La cantidad prevista debe estar entre 1 y 20.');
    if (document.size === 0 || document.size > 10 * 1024 * 1024) throw new Error('El PDF debe pesar como máximo 10 MB.');
    const bytes = new Uint8Array(await document.arrayBuffer());
    const profile = await inspectPdf(bytes);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: settings } = await admin.from('system_settings').select('maintenance_mode').eq('singleton', true).single();
    if (settings?.maintenance_mode) throw new Error('LeapSign está en mantenimiento. Inténtalo más tarde.');
    await reserveUpload(admin, document.size, user.id);
    const { data: workflow, error: workflowError } = await admin.from('workflows').insert({ owner_id: user.id, title, message, group_key_hash: groupKey ? await hash(groupKey) : null, expected_signature_count: expectedSignatureCount, original_filename: safeDocumentName(title) }).select('id').single();
    if (workflowError) {
      console.error('create-round: workflow insert failed', workflowError.code, workflowError.message);
      throw new Error('No se pudo crear el proceso. Inténtalo de nuevo.');
    }
    const path = `${workflow.id}/0.pdf`; const digest = await hashBytes(bytes);
    const { error: uploadError } = await admin.storage.from('firmador-documents').upload(path, bytes, { contentType: 'application/pdf', upsert: false });
    if (uploadError) {
      console.error('create-round: PDF upload failed', uploadError.message);
      await admin.from('workflows').delete().eq('id', workflow.id);
      throw new Error('No se pudo guardar el PDF. Inténtalo de nuevo.');
    }
    const creatorName = ([user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(' ').trim() || user.user_metadata?.full_name || user.email || 'Creador del proceso').slice(0, 120);
    const { data: version, error: versionError } = await admin.from('document_versions').insert({ workflow_id: workflow.id, sequence: 0, storage_path: path, sha256: digest, byte_size: document.size, page_count: profile.pageCount, page_dimensions: profile.pageDimensions, validation_summary: { mode: 'structural_profile', pageCount: profile.pageCount }, submitted_by_name: creatorName, submitted_by_email: user.email ?? null }).select('id').single();
    if (versionError || !version) {
      console.error('create-round: version insert failed', versionError?.code, versionError?.message);
      await admin.storage.from('firmador-documents').remove([path]);
      await admin.from('workflows').delete().eq('id', workflow.id);
      throw new Error('No se pudo registrar el PDF. Inténtalo de nuevo.');
    }
    const { error: currentVersionError } = await admin.from('workflows').update({ current_version_id: version.id }).eq('id', workflow.id).eq('owner_id', user.id);
    if (currentVersionError) {
      console.error('create-round: current version update failed', currentVersionError.code, currentVersionError.message);
      await admin.storage.from('firmador-documents').remove([path]);
      await admin.from('workflows').delete().eq('id', workflow.id);
      throw new Error('No se pudo preparar el documento. Inténtalo de nuevo.');
    }
    return Response.json({ id: workflow.id }, { headers: cors });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: 400, headers: cors }); }
}));
