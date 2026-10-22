import { protectEndpoint } from "../_shared/economic-guard.ts";
import { assertQuerySuccess, DataUnavailableError } from "../_shared/query-results.ts";
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(protectEndpoint("get-owner-round", createClient, async (request, context) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id } = await request.json();
    if (typeof id !== 'string') throw new Error('Ronda inválida.');
    // Context is produced by the guard after getUser(), never from request data.
    if (!context.ownerId) throw new Error('No autorizado.');
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const workflowResult = await admin.from('workflows').select('id,title,message,status,signature_count,expected_signature_count,created_at,last_activity_at,paused_at,paused_reason,current_version_id,completed_at,final_file_delete_at').eq('id', id).eq('owner_id', context.ownerId).maybeSingle();
    assertQuerySuccess([workflowResult]);
    const { data: workflow } = workflowResult;
    if (!workflow) throw new Error('No tienes acceso a esta ronda.');
    const results = await Promise.all([
      admin.from('document_versions').select('id,sequence,sha256,byte_size,created_at,accepted_at,validation_status,submitted_by_session_hash,submitted_by_name,submitted_by_email,delete_after').eq('workflow_id', id).is('discarded_at', null).order('sequence', { ascending: false }),
      admin.from('open_round_locks').select('holder_name,holder_email,expires_at,version_id_at_claim,reviewed_version_at').eq('workflow_id', id).maybeSingle(),
      admin.from('open_round_waitlist').select('holder_name,email,joined_at').eq('workflow_id', id).order('joined_at').limit(20),
      admin.from('error_reports').select('id,reason,detail,reporter_name,reporter_email,created_at').eq('workflow_id', id).order('created_at', { ascending: false }).limit(10),
      admin.from('workflow_audit_log').select('action,created_at,metadata').eq('workflow_id', id).order('id', { ascending: false }).limit(20),
      admin.from('signature_submissions').select('id,status,byte_size,created_at,rejection_reason,validation_summary').eq('workflow_id', id).order('created_at', { ascending: false }).limit(20),
      admin.from('owner_contacts').select('id,email,display_name,last_used_at').eq('owner_id', context.ownerId).order('last_used_at', { ascending: false }).limit(100),
      admin.from('round_invitations').select('id,email,holder_name,status,created_at,email_sent_at,opened_at,completed_at,expires_at,reminder_1h_sent_at,reminder_24h_sent_at,email_error').eq('workflow_id', id).order('created_at', { ascending: false }).limit(100),
    ]);
    assertQuerySuccess(results);
    const [{ data: versions }, { data: lock }, { data: queue }, { data: reports }, { data: events }, { data: submissions }, { data: contacts }, { data: invitations }] = results;
    return Response.json({ workflow, activeTurn: lock ?? null, queue: queue ?? [], versions: versions ?? [], reports: reports ?? [], events: events ?? [], submissions: submissions ?? [], contacts: contacts ?? [], invitations: invitations ?? [] }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Error inesperado.' }, { status: error instanceof DataUnavailableError ? error.status : 400, headers: cors });
  }
}));
