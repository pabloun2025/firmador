import { createClient, type SupabaseClient, type User } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://admin.veryfacil.org",
  "https://firma.veryfacil.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

const cors = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://admin.veryfacil.org",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};

class HttpError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "BAD_REQUEST") {
    super(message);
  }
}

type AdminContext = {
  user: User;
  db: SupabaseClient;
  email: string;
};

const decodeJwt = (authorization: string) => {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "=")));
  } catch {
    return {};
  }
};

async function authorize(request: Request): Promise<AdminContext> {
  const authorization = request.headers.get("Authorization");
  if (!authorization) throw new HttpError("Inicia sesión para continuar.", 401, "AUTH_REQUIRED");
  const url = Deno.env.get("SUPABASE_URL")!;
  const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authorization } },
  });
  const { data: { user }, error } = await userClient.auth.getUser();
  if (error || !user?.email) throw new HttpError("La sesión no es válida.", 401, "AUTH_REQUIRED");
  const claims = decodeJwt(authorization);
  if (claims.aal !== "aal2")
    throw new HttpError("Confirma el segundo factor para abrir el panel.", 403, "MFA_REQUIRED");
  const db = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const email = user.email.trim().toLowerCase();
  const { data: allowed } = await db
    .from("super_admins")
    .select("email,user_id,active")
    .eq("email", email)
    .eq("active", true)
    .maybeSingle();
  if (!allowed) throw new HttpError("Esta cuenta no tiene acceso administrativo.", 403, "NOT_ADMIN");
  if (allowed.user_id && allowed.user_id !== user.id)
    throw new HttpError("La cuenta administrativa está vinculada a otro usuario.", 403, "NOT_ADMIN");
  await db.from("super_admins").update({ user_id: user.id, last_login_at: new Date().toISOString() }).eq("email", email);
  return { user, db, email };
}

async function audit(
  context: AdminContext,
  action: string,
  targetType: string,
  targetId: string | null,
  reason: string | null,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await context.db.from("superadmin_audit_log").insert({
    admin_user_id: context.user.id,
    admin_email: context.email,
    action,
    target_type: targetType,
    target_id: targetId,
    reason,
    metadata,
  });
  if (error) throw new HttpError("No se pudo registrar la operación. No se aplicaron más cambios.", 500, "AUDIT_FAILED");
}

const text = (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : "";
const requireReason = (value: unknown) => {
  const reason = text(value);
  if (reason.length < 8) throw new HttpError("Escribe un motivo de al menos 8 caracteres.");
  return reason;
};
const escapeHtml = (value: string) => value.replace(/[&<>'"]/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
}[char]!));
const render = (template: string, variables: Record<string, string>) =>
  Object.entries(variables).reduce((result, [key, value]) => result.replaceAll(`{{${key}}}`, value), template);
const paragraphs = (value: string) => value.split(/\n{2,}/).map((part) => `<p style="line-height:1.65;color:#53665e">${escapeHtml(part).replaceAll("\n", "<br>")}</p>`).join("");
const emailFrame = (content: string) => `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p>${content}<hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Documento privado · No reenvíes este correo ni el enlace de acceso.</p></main></div>`;

async function removeWorkflowFiles(db: SupabaseClient, workflowId: string) {
  const paths: string[] = [];
  const root = await db.storage.from("firmador-documents").list(workflowId, { limit: 1000 });
  paths.push(...(root.data ?? []).filter((item) => item.name !== "submissions").map((item) => `${workflowId}/${item.name}`));
  const submissions = await db.storage.from("firmador-documents").list(`${workflowId}/submissions`, { limit: 1000 });
  paths.push(...(submissions.data ?? []).map((item) => `${workflowId}/submissions/${item.name}`));
  if (paths.length) {
    const { error } = await db.storage.from("firmador-documents").remove(paths);
    if (error) throw new HttpError("No se pudieron eliminar los archivos privados.", 500, "STORAGE_DELETE_FAILED");
  }
  return paths.length;
}

async function dashboard(context: AdminContext) {
  const [{ data: metrics, error: metricsError }, users, settings, templates, logs] = await Promise.all([
    context.db.rpc("superadmin_metrics"),
    context.db.auth.admin.listUsers({ page: 1, perPage: 1 }),
    context.db.from("system_settings").select("*").eq("singleton", true).single(),
    context.db.from("email_templates").select("template_key,label,subject_template,body_template,enabled,updated_at").in("template_key", ["invitation", "reminder_1h", "reminder_24h", "owner_completed"]).order("template_key"),
    context.db.from("superadmin_audit_log").select("id,admin_email,action,target_type,target_id,reason,metadata,created_at").order("created_at", { ascending: false }).limit(40),
  ]);
  if (metricsError) throw metricsError;
  return {
    metrics: { ...metrics, accounts_total: users.data?.total ?? 0 },
    settings: settings.data,
    templates: templates.data ?? [],
    audit: logs.data ?? [],
  };
}

async function listUsers(context: AdminContext, payload: Record<string, unknown>) {
  const page = Math.max(1, Math.min(1000, Number(payload.page) || 1));
  const result = await context.db.auth.admin.listUsers({ page, perPage: 25 });
  if (result.error) throw result.error;
  const ids = result.data.users.map((user) => user.id);
  const { data: workflows } = ids.length
    ? await context.db.from("workflows").select("owner_id,status").in("owner_id", ids)
    : { data: [] as { owner_id: string; status: string }[] };
  const counts = new Map<string, { total: number; active: number }>();
  for (const workflow of workflows ?? []) {
    const current = counts.get(workflow.owner_id) ?? { total: 0, active: 0 };
    current.total += 1;
    if (workflow.status === "active") current.active += 1;
    counts.set(workflow.owner_id, current);
  }
  return {
    page,
    total: result.data.total,
    users: result.data.users.map((user) => ({
      id: user.id,
      email: user.email,
      name: user.user_metadata?.full_name || [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" "),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      confirmed_at: user.confirmed_at,
      banned_until: user.banned_until,
      workflows: counts.get(user.id) ?? { total: 0, active: 0 },
    })),
  };
}

async function listWorkflows(context: AdminContext, payload: Record<string, unknown>) {
  const page = Math.max(1, Number(payload.page) || 1);
  const from = (page - 1) * 30;
  const { data, error, count } = await context.db
    .from("workflows")
    .select("id,owner_id,title,status,signature_count,created_at,last_activity_at,paused_reason,current_version_id", { count: "exact" })
    .order("last_activity_at", { ascending: false })
    .range(from, from + 29);
  if (error) throw error;
  const ownerIds = [...new Set((data ?? []).map((workflow) => workflow.owner_id))];
  const owners = new Map<string, string>();
  await Promise.all(ownerIds.map(async (id) => {
    const { data: owner } = await context.db.auth.admin.getUserById(id);
    owners.set(id, owner.user?.email || id);
  }));
  return {
    page,
    total: count ?? 0,
    workflows: (data ?? []).map((workflow) => ({ ...workflow, owner_email: owners.get(workflow.owner_id) })),
  };
}

async function updateSettings(context: AdminContext, payload: Record<string, unknown>) {
  const allowed = ["email_master_enabled", "email_invitations_enabled", "email_reminders_enabled", "email_completion_enabled", "automatic_cleanup_enabled", "maintenance_mode"];
  const changes: Record<string, boolean | string> = { updated_at: new Date().toISOString() };
  for (const key of allowed) if (typeof payload[key] === "boolean") changes[key] = payload[key] as boolean;
  if (Object.keys(changes).length === 1) throw new HttpError("No hay cambios válidos.");
  const reason = requireReason(payload.reason);
  await audit(context, "settings_update_requested", "system", "global", reason, changes);
  const { data, error } = await context.db.from("system_settings").update({ ...changes, updated_by: context.user.id }).eq("singleton", true).select().single();
  if (error) throw error;
  return { settings: data };
}

async function updateTemplate(context: AdminContext, payload: Record<string, unknown>) {
  const key = text(payload.template_key, 40);
  if (!(["invitation", "reminder_1h", "reminder_24h", "owner_completed"] as string[]).includes(key)) throw new HttpError("Plantilla no válida.");
  const subject = text(payload.subject_template, 160);
  const body = text(payload.body_template, 3000);
  if (!subject || !body) throw new HttpError("Completa el asunto y el mensaje.");
  const reason = requireReason(payload.reason);
  await audit(context, "template_update_requested", "email_template", key, reason, { enabled: payload.enabled !== false });
  const { data, error } = await context.db.from("email_templates").update({
    subject_template: subject,
    body_template: body,
    enabled: payload.enabled !== false,
    updated_at: new Date().toISOString(),
    updated_by: context.user.id,
  }).eq("template_key", key).select().single();
  if (error) throw error;
  return { template: data };
}

async function accountAction(context: AdminContext, payload: Record<string, unknown>) {
  const userId = text(payload.user_id, 64);
  const action = text(payload.account_action, 30);
  const reason = requireReason(payload.reason);
  if (!userId || !["disable", "enable", "delete"].includes(action)) throw new HttpError("Acción de cuenta no válida.");
  if (userId === context.user.id) throw new HttpError("No puedes modificar tu propia cuenta desde este panel.");
  const { data: target, error: targetError } = await context.db.auth.admin.getUserById(userId);
  if (targetError || !target.user?.email) throw new HttpError("La cuenta ya no existe.", 404, "NOT_FOUND");
  if (action === "delete" && text(payload.confirm_email, 320).toLowerCase() !== target.user.email.toLowerCase())
    throw new HttpError("Escribe el correo completo de la cuenta para confirmar su eliminación.");
  await audit(context, `account_${action}_requested`, "account", userId, reason, { email: target.user.email });
  if (action === "disable" || action === "enable") {
    const { error } = await context.db.auth.admin.updateUserById(userId, { ban_duration: action === "disable" ? "876000h" : "none" });
    if (error) throw error;
    return { ok: true };
  }
  const { data: workflows } = await context.db.from("workflows").select("id").eq("owner_id", userId);
  let filesRemoved = 0;
  for (const workflow of workflows ?? []) {
    filesRemoved += await removeWorkflowFiles(context.db, workflow.id);
    const { error } = await context.db.from("workflows").delete().eq("id", workflow.id);
    if (error) throw error;
  }
  const { error } = await context.db.auth.admin.deleteUser(userId, false);
  if (error) throw error;
  return { ok: true, workflows_removed: workflows?.length ?? 0, files_removed: filesRemoved };
}

async function workflowAction(context: AdminContext, payload: Record<string, unknown>) {
  const workflowId = text(payload.workflow_id, 64);
  const action = text(payload.workflow_action, 30);
  const reason = requireReason(payload.reason);
  if (!/^[0-9a-f-]{36}$/i.test(workflowId) || !["pause", "resume", "release_turn", "cancel", "purge"].includes(action))
    throw new HttpError("Acción de proceso no válida.");
  const { data: workflow } = await context.db.from("workflows").select("id,owner_id,title,status").eq("id", workflowId).maybeSingle();
  if (!workflow) throw new HttpError("El proceso ya no existe.", 404, "NOT_FOUND");
  await audit(context, `workflow_${action}_requested`, "workflow", workflowId, reason, { owner_id: workflow.owner_id, previous_status: workflow.status });
  if (["pause", "resume", "release_turn"].includes(action)) {
    const { data, error } = await context.db.rpc("owner_manage_open_round", {
      p_workflow_id: workflowId,
      p_owner_id: workflow.owner_id,
      p_action: action,
    });
    if (error) throw error;
    return { ok: true, result: data };
  }
  if (action === "cancel") {
    const { error } = await context.db.from("workflows").update({ status: "cancelled", cancelled_at: new Date().toISOString(), last_activity_at: new Date().toISOString() }).eq("id", workflowId);
    if (error) throw error;
    await Promise.all([
      context.db.from("open_round_locks").delete().eq("workflow_id", workflowId),
      context.db.from("open_round_waitlist").delete().eq("workflow_id", workflowId),
      context.db.from("round_invitations").update({ status: "cancelled" }).eq("workflow_id", workflowId).in("status", ["pending", "opened"]),
    ]);
    const { data: versions } = await context.db.from("document_versions").select("id,storage_path").eq("workflow_id", workflowId).is("discarded_at", null);
    const deleteAfter = new Date(Date.now() + 60 * 60_000).toISOString();
    for (const version of versions ?? []) {
      await context.db.from("document_versions").update({ delete_after: deleteAfter }).eq("id", version.id);
      await context.db.from("file_cleanup_jobs").upsert({ workflow_id: workflowId, storage_path: version.storage_path, reason: "cancelled", scheduled_for: deleteAfter, status: "pending" }, { onConflict: "storage_path" });
    }
    return { ok: true };
  }
  const filesRemoved = await removeWorkflowFiles(context.db, workflowId);
  const { error } = await context.db.from("workflows").delete().eq("id", workflowId);
  if (error) throw error;
  return { ok: true, files_removed: filesRemoved };
}

async function runCleanup(context: AdminContext, payload: Record<string, unknown>) {
  const reason = requireReason(payload.reason);
  const { data: settings } = await context.db.from("system_settings").select("automatic_cleanup_enabled").eq("singleton", true).single();
  if (!settings?.automatic_cleanup_enabled) throw new HttpError("El procesamiento de purgas está desactivado.");
  await audit(context, "cleanup_run_requested", "cleanup", "pending", reason);
  const { data: jobs, error } = await context.db.from("file_cleanup_jobs").select("id,storage_path").in("status", ["pending", "failed"]).lte("scheduled_for", new Date().toISOString()).order("scheduled_for").limit(100);
  if (error) throw error;
  let removed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    await context.db.from("file_cleanup_jobs").update({ status: "processing" }).eq("id", job.id);
    const result = await context.db.storage.from("firmador-documents").remove([job.storage_path]);
    await context.db.rpc("finish_file_cleanup", { p_path: job.storage_path, p_error: result.error?.message ?? null });
    if (result.error) failed += 1;
    else removed += 1;
  }
  return { ok: true, removed, failed };
}

Deno.serve(async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const context = await authorize(request);
    const payload = await request.json() as Record<string, unknown>;
    const action = text(payload.action, 40);
    let data: unknown;
    if (action === "dashboard") data = await dashboard(context);
    else if (action === "users") data = await listUsers(context, payload);
    else if (action === "workflows") data = await listWorkflows(context, payload);
    else if (action === "update_settings") data = await updateSettings(context, payload);
    else if (action === "update_template") data = await updateTemplate(context, payload);
    else if (action === "account_action") data = await accountAction(context, payload);
    else if (action === "workflow_action") data = await workflowAction(context, payload);
    else if (action === "run_cleanup") data = await runCleanup(context, payload);
    else throw new HttpError("Acción administrativa no válida.");
    return Response.json(data, { headers });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof HttpError ? error.message : "No pudimos completar la operación administrativa.";
    console.error("superadmin-console", code, error instanceof Error ? error.message : error);
    return Response.json({ error: message, code }, { status, headers });
  }
});
