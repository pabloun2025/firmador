import { createClient } from "jsr:@supabase/supabase-js@2";

const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[character]!));
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
  .map((byte) => byte.toString(16).padStart(2, "0")).join("");
const render = (template: string, values: Record<string, string>) => Object.entries(values)
  .reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template);
const paragraphs = (value: string) => value.split(/\n{2,}/)
  .map((part) => `<p style="line-height:1.65;color:#53665e">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`).join("");

function emailHtml(kind: "reminder_1h" | "reminder_24h", body: string, link: string) {
  const label = kind === "reminder_1h" ? "Firma pendiente" : "Último recordatorio";
  const heading = kind === "reminder_1h" ? "Tu documento sigue esperando" : "Tu invitación caduca mañana";
  return `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p><p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">${label}</p><h1 style="margin:10px 0 16px;font-size:28px">${heading}</h1>${paragraphs(body)}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Abrir invitación</a></p><p style="overflow-wrap:anywhere;font-size:12px;color:#53665e">Si el botón no funciona, copia este enlace:<br><a href="${link}" style="color:#124d40">${link}</a></p><hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Enlace personal y de un solo uso. Se consume únicamente al incorporar correctamente el PDF firmado.</p></main></div>`;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const now = new Date();
  const result = { reminders: 0, expired: 0, cleaned: 0, cleanupFailed: 0 };
  try {
    const { data: settings } = await admin.from("system_settings")
      .select("email_master_enabled,email_reminders_enabled,automatic_cleanup_enabled").eq("singleton", true).single();
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("RESEND_FROM_EMAIL");
    if (settings?.email_master_enabled && settings.email_reminders_enabled && resendKey && from) {
      const { data: invitations } = await admin.from("round_invitations")
        .select("id,workflow_id,email,holder_name,created_at,expires_at,reminder_1h_sent_at,reminder_24h_sent_at,workflow:workflows!inner(title,status)")
        .in("status", ["pending", "opened"]).gt("expires_at", now.toISOString()).limit(100);
      const { data: templates } = await admin.from("email_templates")
        .select("template_key,subject_template,body_template,enabled").in("template_key", ["reminder_1h", "reminder_24h"]);
      const templateMap = new Map((templates ?? []).map((template) => [template.template_key, template]));
      for (const invitation of invitations ?? []) {
        const workflow = Array.isArray(invitation.workflow) ? invitation.workflow[0] : invitation.workflow;
        if (!workflow || workflow.status !== "active") continue;
        const age = now.getTime() - new Date(invitation.created_at).getTime();
        const kind: "reminder_1h" | "reminder_24h" | null = age >= 24 * 60 * 60_000 && !invitation.reminder_24h_sent_at
          ? "reminder_24h" : age >= 60 * 60_000 && !invitation.reminder_1h_sent_at ? "reminder_1h" : null;
        if (!kind) continue;
        const column = kind === "reminder_1h" ? "reminder_1h_sent_at" : "reminder_24h_sent_at";
        const claimedAt = now.toISOString();
        const { data: claimed } = await admin.from("round_invitations").update({ [column]: claimedAt })
          .eq("id", invitation.id).is(column, null).select("id").maybeSingle();
        if (!claimed) continue;
        try {
          const template = templateMap.get(kind);
          if (!template?.enabled) continue;
          const rawToken = crypto.randomUUID();
          await admin.from("round_invitation_tokens").insert({
            invitation_id: invitation.id, token_hash: await hash(rawToken), kind, expires_at: invitation.expires_at,
          });
          const link = `https://firma.veryfacil.org/r/${invitation.workflow_id}?invite=${encodeURIComponent(rawToken)}`;
          const values = { name: invitation.holder_name, title: workflow.title, link };
          const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `leapsign-${kind}-${invitation.id}` },
            body: JSON.stringify({ from, to: [invitation.email], subject: render(template.subject_template, values), html: emailHtml(kind, render(template.body_template, values), link) }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          result.reminders += 1;
        } catch (error) {
          await admin.from("round_invitations").update({ [column]: null, email_error: error instanceof Error ? error.message : "No se pudo enviar el recordatorio" }).eq("id", invitation.id).eq(column, claimedAt);
        }
      }
    }
    const { data: expired } = await admin.from("round_invitations").update({ status: "cancelled" })
      .in("status", ["pending", "opened"]).lte("expires_at", now.toISOString()).select("id");
    result.expired = expired?.length ?? 0;
    if (settings?.automatic_cleanup_enabled) {
      const { data: jobs } = await admin.from("file_cleanup_jobs").select("id,storage_path,attempts")
        .in("status", ["pending", "failed"]).lte("scheduled_for", now.toISOString()).lt("attempts", 10).order("scheduled_for").limit(100);
      for (const job of jobs ?? []) {
        const { data: claimed } = await admin.from("file_cleanup_jobs").update({ status: "processing" })
          .eq("id", job.id).in("status", ["pending", "failed"]).select("id").maybeSingle();
        if (!claimed) continue;
        const { error } = await admin.storage.from("firmador-documents").remove([job.storage_path]);
        await admin.rpc("finish_file_cleanup", { p_path: job.storage_path, p_error: error?.message ?? null });
        if (error) result.cleanupFailed += 1;
        else result.cleaned += 1;
      }
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Error de mantenimiento" }, { status: 500 });
  }
});
