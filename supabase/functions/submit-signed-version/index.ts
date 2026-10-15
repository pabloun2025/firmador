import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const hash = async (bytes: ArrayBuffer) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const hashText = async (value: string) => hash(new TextEncoder().encode(value));
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ]!,
  );
const render = (template: string, variables: Record<string,string>) => Object.entries(variables).reduce((result,[key,value]) => result.replaceAll(`{{${key}}}`, value), template);
const paragraphs = (value: string) => value.split(/\n{2,}/).map(part => `<p style="line-height:1.65;color:#53665e">${escapeHtml(part).replaceAll('\n','<br>')}</p>`).join('');
async function notifyNext(
  admin: ReturnType<typeof createClient>,
  workflowId: string,
  next: { email?: string; holder_name?: string; token?: string } | null,
) {
  const [{ data: settings }, { data: template }] = await Promise.all([
    admin.from("system_settings").select("email_master_enabled,email_turn_enabled").eq("singleton", true).single(),
    admin.from("email_templates").select("subject_template,body_template,enabled").eq("template_key", "turn_ready").single(),
  ]);
  if (!settings?.email_master_enabled || !settings.email_turn_enabled || !template?.enabled) return;
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!next?.email || !next.token || !key || !from) return;
  const link = `https://firma.veryfacil.org/r/${workflowId}?turn=${encodeURIComponent(next.token)}`;
  const variables = { name: String(next.holder_name ?? "Participante"), title: "", link };
  const subject = render(template.subject_template, variables);
  const body = render(template.body_template, variables);
  const html = `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p><p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Turno disponible</p><h1 style="margin:10px 0 16px;font-size:28px">El documento ha avanzado hasta ti</h1>${paragraphs(body)}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Abrir mi documento</a></p><hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Documento privado · No reenvíes este correo ni el enlace de acceso.</p></main></div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [next.email],
      subject,
      html,
    }),
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  try {
    const form = await request.formData();
    const id = String(form.get("id") || "");
    const groupKey = String(form.get("groupKey") || "");
    const sessionId = String(form.get("sessionId") || "");
    const reviewedPrevious = form.get("reviewedPrevious") === "true";
    const document = form.get("document");
    if (
      !/^[0-9a-f-]{36}$/i.test(id) ||
      !sessionId ||
      !reviewedPrevious ||
      !(document instanceof File)
    )
      throw new Error("Completa la confirmación y adjunta el PDF firmado.");
    if (
      document.type !== "application/pdf" &&
      !document.name.toLowerCase().endsWith(".pdf")
    )
      throw new Error("El archivo debe ser un PDF.");
    if (!document.size || document.size > 10 * 1024 * 1024)
      throw new Error("El PDF debe pesar como máximo 10 MB.");
    const bytes = await document.arrayBuffer();
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw new Error("El archivo no parece ser un PDF válido.");

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const sessionHash = await hashText(sessionId);
    const { data: workflow } = await admin
      .from("workflows")
      .select("id,status,group_key_hash,current_version_id")
      .eq("id", id)
      .maybeSingle();
    if (
      !workflow ||
      workflow.status !== "active" ||
      !workflow.current_version_id
    )
      throw new Error("Esta ronda no está disponible.");
    if (workflow.group_key_hash && workflow.group_key_hash !== (await hashText(groupKey))) {
      const { data: invitation } = await admin.from("round_invitations").select("id").eq("workflow_id", id).eq("session_hash", sessionHash).eq("status", "opened").gt("expires_at", new Date().toISOString()).maybeSingle();
      if (!invitation) throw new Error("No se pudo acceder a esta ronda.");
    }
    const { data: parent } = await admin
      .from("document_versions")
      .select("sha256,byte_size")
      .eq("id", workflow.current_version_id)
      .maybeSingle();
    if (!parent)
      throw new Error("No encontramos la versión actual del documento.");
    const digest = await hash(bytes);
    if (digest === parent.sha256)
      throw new Error(
        "El archivo es igual a la versión anterior. Descarga el PDF, fírmalo y vuelve a cargar la copia resultante.",
      );
    if (document.size <= Number(parent.byte_size))
      throw new Error(
        `El PDF firmado debe pesar más que la versión anterior (${Math.ceil(Number(parent.byte_size) / 1024)} KB). Selecciona la copia que generó FirmaEC o Adobe.`,
      );
    const { data: lock } = await admin
      .from("open_round_locks")
      .select("version_id_at_claim,expires_at")
      .eq("workflow_id", id)
      .eq("holder_session_hash", sessionHash)
      .maybeSingle();
    if (!lock || new Date(lock.expires_at).getTime() <= Date.now())
      throw new Error("Tu turno ya no está activo.");
    if (lock.version_id_at_claim !== workflow.current_version_id)
      throw new Error(
        "Hay una versión más reciente del documento. Vuelve a abrir tu turno.",
      );
    let submissionId: string;
    const { data: existing } = await admin
      .from("signature_submissions")
      .select("id")
      .eq("workflow_id", id)
      .eq("submitted_by_session_hash", sessionHash)
      .eq("parent_version_id", workflow.current_version_id)
      .in("status", ["uploaded", "validating"])
      .maybeSingle();
    if (existing) submissionId = existing.id;
    else {
      submissionId = crypto.randomUUID();
      const path = `${id}/submissions/${submissionId}.pdf`;
      const { error: uploadError } = await admin.storage
        .from("firmador-documents")
        .upload(path, bytes, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error("No pudimos guardar el PDF firmado.");
      const { error: insertError } = await admin
        .from("signature_submissions")
        .insert({
          id: submissionId,
          workflow_id: id,
          parent_version_id: workflow.current_version_id,
          storage_path: path,
          sha256: digest,
          byte_size: document.size,
          submitted_by_session_hash: sessionHash,
          status: "uploaded",
        });
      if (insertError) {
        await admin.storage.from("firmador-documents").remove([path]);
        throw new Error("No pudimos registrar la entrega.");
      }
    }
    const { data: accepted, error: acceptError } = await admin.rpc(
      "accept_open_signed_submission",
      {
        p_workflow_id: id,
        p_session_hash: sessionHash,
        p_submission_id: submissionId,
      },
    );
    if (acceptError || !accepted?.ok)
      throw new Error("No pudimos incorporar el documento firmado.");
    await admin.from("round_invitations").update({ status: "completed", completed_at: new Date().toISOString() }).eq("workflow_id", id).eq("session_hash", sessionHash).in("status", ["pending", "opened"]);
    await notifyNext(admin, id, accepted.next ?? null);
    return Response.json({ state: "accepted" }, { headers: cors });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 400, headers: cors },
    );
  }
});
