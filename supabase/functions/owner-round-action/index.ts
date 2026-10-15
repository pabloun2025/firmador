import { createClient } from "jsr:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
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

async function owner(request: Request) {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new Error("No autorizado.");
  const client = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error("No autorizado.");
  return user;
}

async function flushCleanupJobs(admin: any, workflowId: string) {
  const { data: jobs, error: listError } = await admin
    .from("file_cleanup_jobs")
    .select("storage_path")
    .eq("workflow_id", workflowId)
    .in("status", ["pending", "failed"])
    .order("created_at")
    .limit(100);
  if (listError) return { removed: 0, pending: true };
  let removed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    await admin
      .from("file_cleanup_jobs")
      .update({ status: "processing" })
      .eq("storage_path", job.storage_path);
    const { error } = await admin.storage
      .from("firmador-documents")
      .remove([job.storage_path]);
    await admin.rpc("finish_file_cleanup", {
      p_path: job.storage_path,
      p_error: error ? error.message : null,
    });
    if (error) failed += 1;
    else removed += 1;
  }
  return { removed, pending: failed > 0 };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: cors });
  try {
    const { id, action, versionId, confirmPurge, confirmIrreversible } =
      await request.json();
    if (
      typeof id !== "string" ||
      ![
        "pause",
        "resume",
        "release_turn",
        "skip_next",
        "rollback",
        "finalize",
        "purge",
      ].includes(action)
    )
      throw new Error("Acción no válida.");
    const user = await owner(request);
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (action === "rollback" || action === "finalize") {
      if (typeof versionId !== "string" || confirmIrreversible !== true)
        throw new Error("Confirma la acción irreversible para continuar.");
      const { data, error } = await admin.rpc("owner_discard_versions", {
        p_workflow_id: id,
        p_owner_id: user.id,
        p_version_id: versionId,
        p_action: action,
      });
      if (error || !data?.ok)
        throw new Error(
          action === "rollback"
            ? "No pudimos volver a la versión seleccionada."
            : "No pudimos aceptar la versión final.",
        );
      const cleanup = await flushCleanupJobs(admin, id);
      return Response.json({ ok: true, cleanup }, { headers: cors });
    }
    if (action === "purge") {
      if (confirmPurge !== true)
        throw new Error("Confirma la purga para continuar.");
      const { data: workflow } = await admin
        .from("workflows")
        .select("id")
        .eq("id", id)
        .eq("owner_id", user.id)
        .maybeSingle();
      if (!workflow) throw new Error("No tienes acceso a esta ronda.");
      const root = await admin.storage
        .from("firmador-documents")
        .list(id, { limit: 1000 });
      const paths = (root.data ?? [])
        .filter((item) => item.name !== "submissions")
        .map((item) => `${id}/${item.name}`);
      const submissions = await admin.storage
        .from("firmador-documents")
        .list(`${id}/submissions`, { limit: 1000 });
      paths.push(
        ...(submissions.data ?? []).map(
          (item) => `${id}/submissions/${item.name}`,
        ),
      );
      if (paths.length) {
        const { error } = await admin.storage
          .from("firmador-documents")
          .remove(paths);
        if (error) throw new Error("No pudimos borrar los archivos privados.");
      }
      const { error } = await admin
        .from("workflows")
        .delete()
        .eq("id", id)
        .eq("owner_id", user.id);
      if (error) throw new Error("No pudimos purgar el proceso.");
      return Response.json({ ok: true, purged: true }, { headers: cors });
    }
    const { data, error } = await admin.rpc("owner_manage_open_round", {
      p_workflow_id: id,
      p_owner_id: user.id,
      p_action: action,
    });
    if (error) throw error;
    if (action === "release_turn" && data?.next?.email && data.next.token) {
      const [{ data: settings }, { data: template }] = await Promise.all([
        admin.from("system_settings").select("email_master_enabled,email_turn_enabled").eq("singleton", true).single(),
        admin.from("email_templates").select("subject_template,body_template,enabled").eq("template_key", "turn_ready").single(),
      ]);
      const key = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("RESEND_FROM_EMAIL");
      if (settings?.email_master_enabled && settings.email_turn_enabled && template?.enabled && key && from) {
        const link = `https://firma.veryfacil.org/r/${id}?turn=${encodeURIComponent(data.next.token)}`;
        const variables = { name: String(data.next.holder_name ?? "Participante"), title: "", link };
        const subject = render(template.subject_template, variables);
        const body = render(template.body_template, variables);
        const html = `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p><p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Turno disponible</p><h1 style="margin:10px 0 16px;font-size:28px">Ya puedes continuar</h1>${paragraphs(body)}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Abrir mi documento</a></p><hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Documento privado · No reenvíes este correo ni el enlace de acceso.</p></main></div>`;
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: [data.next.email],
            subject,
            html,
          }),
        });
      }
    }
    return Response.json(
      { ok: Boolean(data?.ok), skipped: data?.skipped ?? null },
      { headers: cors },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Error inesperado." },
      { status: 400, headers: cors },
    );
  }
});
