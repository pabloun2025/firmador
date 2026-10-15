import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const hash = async (v: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const downloadName = (title: string, sequence: number) =>
  `${
    title
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "documento"
  }_${String(sequence).padStart(2, "0")}.pdf`;
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ]!,
  );
const emailFrame = (content: string) =>
  `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p>${content}<hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Documento privado · No reenvíes este correo ni el enlace de acceso.</p></main></div>`;
const render = (template: string, variables: Record<string,string>) => Object.entries(variables).reduce((result,[key,value]) => result.replaceAll(`{{${key}}}`, value), template);
const paragraphs = (value: string) => value.split(/\n{2,}/).map(part => `<p style="line-height:1.65;color:#53665e">${escapeHtml(part).replaceAll('\n','<br>')}</p>`).join('');
async function notifyWaitlisted(
  admin: ReturnType<typeof createClient>,
  workflowId: string,
  sessionHash: string,
  email: string,
  name: string,
) {
  const [{ data: settings }, { data: template }] = await Promise.all([
    admin.from("system_settings").select("email_master_enabled,email_queue_enabled").eq("singleton", true).single(),
    admin.from("email_templates").select("subject_template,body_template,enabled").eq("template_key", "waitlisted").single(),
  ]);
  if (!settings?.email_master_enabled || !settings.email_queue_enabled || !template?.enabled) return;
  const dedupeKey = `waitlisted:${workflowId}:${sessionHash}`;
  const { data: existing } = await admin
    .from("open_round_notifications")
    .select("id,status,attempts")
    .eq("dedupe_key", dedupeKey)
    .maybeSingle();
  const { data: savedAccess } = await admin
    .from("open_round_access_links")
    .select("access_token_hash")
    .eq("workflow_id", workflowId)
    .eq("session_hash", sessionHash)
    .maybeSingle();
  if (existing?.status === "sent" && savedAccess) return;
  const notification =
    existing ??
    (
      await admin
        .from("open_round_notifications")
        .insert({
          workflow_id: workflowId,
          session_hash: sessionHash,
          email,
          kind: "waitlisted",
          dedupe_key: dedupeKey,
        })
        .select("id,status,attempts")
        .single()
    ).data;
  if (!notification) return;
  const key = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!key || !from) return;
  const accessToken = crypto.randomUUID();
  const { error: accessError } = await admin
    .from("open_round_access_links")
    .upsert(
      {
        workflow_id: workflowId,
        session_hash: sessionHash,
        access_token_hash: await hash(accessToken),
        holder_name: name,
        email,
        expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { onConflict: "workflow_id,session_hash" },
    );
  if (accessError) throw accessError;
  const link = `https://firma.veryfacil.org/r/${workflowId}?queue=${encodeURIComponent(accessToken)}`;
  const variables = { name, title: "", link };
  const subject = render(template.subject_template, variables);
  const body = render(template.body_template, variables);
  const html = emailFrame(
    `<p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Solicitud recibida</p><h1 style="margin:10px 0 16px;font-size:28px">Estás en la cola de firma</h1>${paragraphs(body)}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Consultar mi turno</a></p>`,
  );
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `firmador-waitlisted-${notification.id}-${(notification.attempts ?? 0) + 1}`,
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject,
      html,
    }),
  });
  const attempts = (notification.attempts ?? 0) + 1;
  await admin
    .from("open_round_notifications")
    .update(
      response.ok
        ? {
            status: "sent",
            sent_at: new Date().toISOString(),
            attempts,
            error_code: null,
          }
        : { status: "failed", error_code: String(response.status), attempts },
    )
    .eq("id", notification.id);
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const {
      id,
      groupKey = "",
      name = "",
      email = "",
      sessionId,
      turnToken = "",
      queueToken = "",
      inviteToken = "",
    } = await req.json();
    if (!id || !sessionId || (!name?.trim() && !turnToken && !queueToken && !inviteToken))
      throw new Error("Datos inválidos.");
    if (email && (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)))
      throw new Error("El correo no es válido.");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: settings } = await admin.from("system_settings").select("maintenance_mode").eq("singleton", true).single();
    if (settings?.maintenance_mode) throw new Error("LeapSign está en mantenimiento. Inténtalo más tarde.");
    const { data: round } = await admin
      .from("workflows")
      .select("group_key_hash,title")
      .eq("id", id)
      .maybeSingle();
    if (!inviteToken && (
      !round ||
      (round.group_key_hash && round.group_key_hash !== (await hash(groupKey)))
    ))
      throw new Error("No se pudo acceder a esta ronda.");
    const sessionHash = await hash(sessionId);
    let holderName = name.trim();
    let normalizedEmail = email.trim().toLowerCase();
    let invitedSessionHash = "";
    if (inviteToken) {
      const { data: invited, error: invitationError } = await admin.rpc("restore_round_invitation_access", {
        p_workflow_id: id, p_token_hash: await hash(inviteToken), p_new_session_hash: sessionHash,
      });
      if (invitationError) throw new Error(invitationError.message);
      if (!invited) throw new Error("No pudimos abrir la invitación.");
      holderName = String(invited.holder_name || "").trim();
      normalizedEmail = String(invited.email || "").trim().toLowerCase();
    } else if (queueToken) {
      const { data: restored, error: restoreError } = await admin.rpc(
        "restore_open_turn_access",
        {
          p_workflow_id: id,
          p_access_token_hash: await hash(queueToken),
          p_new_session_hash: sessionHash,
        },
      );
      if (restoreError) throw new Error(restoreError.message);
      if (!restored) throw new Error("No pudimos recuperar tu turno.");
      holderName = String(restored.holder_name || "").trim();
      normalizedEmail = String(restored.email || "").trim().toLowerCase();
    } else if (turnToken && !holderName) {
      const { data: invited } = await admin
        .from("open_round_waitlist")
        .select("holder_name,email,session_hash")
        .eq("workflow_id", id)
        .eq("turn_token_hash", await hash(turnToken))
        .gt("turn_token_expires_at", new Date().toISOString())
        .maybeSingle();
      if (!invited) throw new Error("El enlace de turno no es válido o ha caducado.");
      holderName = invited.holder_name;
      normalizedEmail = invited.email || "";
      invitedSessionHash = invited.session_hash;
    }
    const { data: turn, error } = await admin.rpc("claim_open_turn", {
      p_workflow_id: id,
      p_holder_name: holderName,
      p_session_hash: sessionHash,
      p_email: normalizedEmail || null,
      p_turn_token_hash: turnToken ? await hash(turnToken) : null,
    });
    if (error) throw new Error(error.message);
    if (
      turn.state === "active" &&
      invitedSessionHash &&
      invitedSessionHash !== sessionHash
    ) {
      const { error: transferError } = await admin
        .from("open_round_access_links")
        .update({ session_hash: sessionHash })
        .eq("workflow_id", id)
        .eq("session_hash", invitedSessionHash);
      if (transferError)
        console.error("No se pudo transferir el enlace de consulta", transferError.code);
    }
    if (turn.state === "waiting" && normalizedEmail)
      await notifyWaitlisted(
        admin,
        id,
        sessionHash,
        normalizedEmail,
        holderName,
      );
    if (turn.state === "active") {
      const { data: v, error: e } = await admin
        .from("document_versions")
        .select("storage_path,sequence")
        .eq("workflow_id", id)
        .order("sequence", { ascending: false })
        .limit(1)
        .single();
      if (e) throw new Error(e.message);
      const { data: l, error: le } = await admin.storage
        .from("firmador-documents")
        .createSignedUrl(v.storage_path, 600, {
          download: downloadName(round.title, v.sequence),
        });
      if (le) throw new Error(le.message);
      turn.pdfUrl = l.signedUrl;
    }
    turn.holder_name = holderName;
    turn.email = normalizedEmail;
    return Response.json(turn, { headers: cors });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400, headers: cors },
    );
  }
});
