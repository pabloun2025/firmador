import { reserveDownload, protectEndpoint } from "../_shared/economic-guard.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { safeDocumentName } from "../_shared/document-name.ts";
import { assertQuerySuccess, DataUnavailableError } from "../_shared/query-results.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");

Deno.serve(protectEndpoint("participant-download-version", createClient, async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { id, sessionId } = await request.json();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof sessionId !== "string" || !sessionId) {
      throw new Error("No pudimos identificar tu turno.");
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const sessionHash = await hash(sessionId);
    const workflowResult = await admin.from("workflows").select("title,status,current_version_id,original_filename")
      .eq("id", id).eq("status", "active").maybeSingle();
    assertQuerySuccess([workflowResult]);
    const { data: workflow } = workflowResult;
    if (!workflow?.current_version_id) throw new Error("Este proceso ya no está disponible.");
    const lockResult = await admin.from("open_round_locks").select("version_id_at_claim,expires_at")
      .eq("workflow_id", id).eq("holder_session_hash", sessionHash).maybeSingle();
    assertQuerySuccess([lockResult]);
    const { data: lock } = lockResult;
    if (!lock || new Date(lock.expires_at).getTime() <= Date.now() || lock.version_id_at_claim !== workflow.current_version_id) {
      throw new Error("Tu turno ya no está activo o el documento cambió.");
    }
    const versionResult = await admin.from("document_versions").select("id,storage_path,byte_size")
      .eq("id", workflow.current_version_id).eq("workflow_id", id).is("discarded_at", null).maybeSingle();
    assertQuerySuccess([versionResult]);
    const { data: version } = versionResult;
    if (!version) throw new Error("No encontramos el documento vigente.");
    const expectedFilename = safeDocumentName(workflow.original_filename || `${workflow.title}.pdf`);
    await reserveDownload(admin, version.id, Number(version.byte_size));
    const { data: signed, error } = await admin.storage.from("firmador-documents")
      .createSignedUrl(version.storage_path, 60, { download: expectedFilename });
    if (error || !signed?.signedUrl) throw new Error("No pudimos preparar la descarga.");
    const reviewResult = await admin.from("open_round_locks").update({ reviewed_version_at: new Date().toISOString() })
      .eq("workflow_id", id).eq("holder_session_hash", sessionHash).eq("version_id_at_claim", workflow.current_version_id);
    assertQuerySuccess([reviewResult]);
    return Response.json({ url: signed.signedUrl, parentByteSize: version.byte_size, expectedFilename }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error inesperado." }, { status: error instanceof DataUnavailableError ? error.status : 400, headers: cors });
  }
}));
