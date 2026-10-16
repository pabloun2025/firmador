import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const fileName = (title: string) => `${title.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || "documento"}.pdf`;

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { id, sessionId } = await request.json();
    if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof sessionId !== "string" || !sessionId) {
      throw new Error("No pudimos identificar tu turno.");
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const sessionHash = await hash(sessionId);
    const { data: workflow } = await admin.from("workflows").select("title,status,current_version_id")
      .eq("id", id).eq("status", "active").maybeSingle();
    if (!workflow?.current_version_id) throw new Error("Este proceso ya no está disponible.");
    const { data: lock } = await admin.from("open_round_locks").select("version_id_at_claim,expires_at")
      .eq("workflow_id", id).eq("holder_session_hash", sessionHash).maybeSingle();
    if (!lock || new Date(lock.expires_at).getTime() <= Date.now() || lock.version_id_at_claim !== workflow.current_version_id) {
      throw new Error("Tu turno ya no está activo o el documento cambió.");
    }
    const { data: version } = await admin.from("document_versions").select("storage_path,byte_size")
      .eq("id", workflow.current_version_id).is("discarded_at", null).maybeSingle();
    if (!version) throw new Error("No encontramos el documento vigente.");
    const { data: signed, error } = await admin.storage.from("firmador-documents")
      .createSignedUrl(version.storage_path, 600, { download: fileName(workflow.title) });
    if (error || !signed?.signedUrl) throw new Error("No pudimos preparar la descarga.");
    await admin.from("open_round_locks").update({ reviewed_version_at: new Date().toISOString() })
      .eq("workflow_id", id).eq("holder_session_hash", sessionHash).eq("version_id_at_claim", workflow.current_version_id);
    return Response.json({ url: signed.signedUrl, parentByteSize: version.byte_size }, { headers: cors });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error inesperado." }, { status: 400, headers: cors });
  }
});
