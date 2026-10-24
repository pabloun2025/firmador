import { budgetedFetch, protectEndpoint } from "../_shared/economic-guard.ts";
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
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const likeQuery = (value: string) => value.replace(/[%_\\]/g, "").slice(0, 80);
const sha256 = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const pausableServices = ["creation", "emails"] as const;
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
    metrics: { ...metrics, accounts_total: (users.data && 'total' in users.data ? users.data.total : 0) },
    settings: settings.data,
    templates: templates.data ?? [],
    audit: logs.data ?? [],
  };
}

function publicUser(user: User, workflows: { total: number; active: number }) {
  return {
    id: user.id,
    email: user.email,
    name: user.user_metadata?.full_name || [user.user_metadata?.first_name, user.user_metadata?.last_name].filter(Boolean).join(" "),
    created_at: user.created_at,
    last_sign_in_at: user.last_sign_in_at,
    confirmed_at: user.confirmed_at,
    banned_until: user.banned_until,
    workflows,
  };
}

async function workflowCounts(context: AdminContext, ids: string[]) {
  const counts = new Map<string, { total: number; active: number }>();
  const { data: workflows } = ids.length
    ? await context.db.from("workflows").select("owner_id,status").in("owner_id", ids)
    : { data: [] as { owner_id: string; status: string }[] };
  for (const workflow of workflows ?? []) {
    const current = counts.get(workflow.owner_id) ?? { total: 0, active: 0 };
    current.total += 1;
    if (workflow.status === "active") current.active += 1;
    counts.set(workflow.owner_id, current);
  }
  return counts;
}

async function usersMatching(context: AdminContext, query: string) {
  const needle = query.toLowerCase();
  const found: User[] = [];
  for (let page = 1; page <= 2 && found.length < 25; page += 1) {
    const listed = await context.db.auth.admin.listUsers({ page, perPage: 1000 });
    if (listed.error) throw listed.error;
    found.push(...listed.data.users.filter((user) => user.id === query || (user.email ?? "").toLowerCase().includes(needle)));
    if (listed.data.users.length < 1000) break;
  }
  return found.slice(0, 25);
}

async function listUsers(context: AdminContext, payload: Record<string, unknown>) {
  const query = likeQuery(text(payload.query, 80));
  if (query) {
    const matched = uuid(query)
      ? [await context.db.auth.admin.getUserById(query)].flatMap((result) => result.data?.user ? [result.data.user] : [])
      : await usersMatching(context, query);
    const counts = await workflowCounts(context, matched.map((user) => user.id));
    return {
      page: 1,
      total: matched.length,
      users: matched.map((user) => publicUser(user, counts.get(user.id) ?? { total: 0, active: 0 })),
    };
  }
  const page = Math.max(1, Math.min(1000, Number(payload.page) || 1));
  const result = await context.db.auth.admin.listUsers({ page, perPage: 25 });
  if (result.error) throw result.error;
  const counts = await workflowCounts(context, result.data.users.map((user) => user.id));
  return {
    page,
    total: result.data.total,
    users: result.data.users.map((user) => publicUser(user, counts.get(user.id) ?? { total: 0, active: 0 })),
  };
}

const workflowStatuses = ["active", "paused_error", "completed", "cancelled", "purged"];

async function ownerEmails(context: AdminContext, ids: string[]) {
  const owners = new Map<string, string>();
  await Promise.all([...new Set(ids)].map(async (id) => {
    const { data: owner } = await context.db.auth.admin.getUserById(id);
    owners.set(id, owner.user?.email || id);
  }));
  return owners;
}

async function listWorkflows(context: AdminContext, payload: Record<string, unknown>) {
  const page = Math.max(1, Number(payload.page) || 1);
  const from = (page - 1) * 30;
  const status = text(payload.status, 20);
  const query = likeQuery(text(payload.query, 80));
  let request = context.db
    .from("workflows")
    .select("id,owner_id,title,status,signature_count,expected_signature_count,created_at,last_activity_at,paused_reason,current_version_id", { count: "exact" })
    .order("last_activity_at", { ascending: false });
  if (workflowStatuses.includes(status)) request = request.eq("status", status);
  if (uuid(query)) request = request.eq("id", query);
  else if (query.length >= 2) request = request.ilike("title", `%${query}%`);
  const { data, error, count } = await request.range(from, from + 29);
  if (error) throw error;
  const owners = await ownerEmails(context, (data ?? []).map((workflow) => workflow.owner_id));
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
  await audit(context, "settings_update_requested", "system", "global", null, changes);
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
  await audit(context, "template_update_requested", "email_template", key, null, { enabled: payload.enabled !== false });
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
  if (!userId || !["disable", "enable", "delete"].includes(action)) throw new HttpError("Acción de cuenta no válida.");
  if (userId === context.user.id) throw new HttpError("No puedes modificar tu propia cuenta desde este panel.");
  const { data: target, error: targetError } = await context.db.auth.admin.getUserById(userId);
  if (targetError || !target.user?.email) throw new HttpError("La cuenta ya no existe.", 404, "NOT_FOUND");
  await audit(context, `account_${action}_requested`, "account", userId, null, { email: target.user.email });
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
  if (!/^[0-9a-f-]{36}$/i.test(workflowId) || !["pause", "resume", "release_turn", "cancel", "purge"].includes(action))
    throw new HttpError("Acción de proceso no válida.");
  const { data: workflow } = await context.db.from("workflows").select("id,owner_id,title,status").eq("id", workflowId).maybeSingle();
  if (!workflow) throw new HttpError("El proceso ya no existe.", 404, "NOT_FOUND");
  await audit(context, `workflow_${action}_requested`, "workflow", workflowId, null, { owner_id: workflow.owner_id, previous_status: workflow.status });
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

function sanitizeCleanupError(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/[/\\]|firmador-documents|\.pdf/i.test(value)) return "No se pudo borrar el archivo.";
  return value.slice(0, 180);
}

function visibleSignatures(summary: unknown) {
  const source = (summary as { signatures?: { status?: unknown; names?: unknown; addedNames?: unknown } } | null)?.signatures;
  if (!source || typeof source.status !== "string" || !["detected", "no_new_signature", "unreadable"].includes(source.status)) return null;
  const names = Array.isArray(source.names) ? source.names.filter((name): name is string => typeof name === "string").slice(0, 64) : [];
  const addedNames = Array.isArray(source.addedNames) ? source.addedNames.filter((name): name is string => typeof name === "string").slice(0, 64) : [];
  return { status: source.status, names, addedNames };
}

async function titlesFor(context: AdminContext, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const { data } = await context.db.from("workflows").select("id,title").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id as string, row.title as string]));
}

async function operations(context: AdminContext) {
  const now = new Date().toISOString();
  const horizon = new Date(Date.now() + 48 * 60 * 60_000).toISOString();
  const [locks, incidents, failedMail, overdue, expiring, jobs, budget, usage] = await Promise.all([
    context.db.from("open_round_locks").select("workflow_id,holder_name,holder_email,expires_at").gt("expires_at", now).order("expires_at").limit(40),
    context.db.from("error_reports").select("id,workflow_id,reason,detail,comment,reporter_name,reporter_email,created_at").order("created_at", { ascending: false }).limit(30),
    context.db.from("round_invitations").select("id,workflow_id,email,holder_name,status,email_error,email_sent_at,expires_at,created_at").not("email_error", "is", null).order("created_at", { ascending: false }).limit(30),
    context.db.from("document_versions").select("id,workflow_id,sequence,delete_after,submitted_by_name").lt("delete_after", now).is("discarded_at", null).order("delete_after").limit(30),
    context.db.from("workflows").select("id,title,final_file_delete_at").eq("status", "completed").gte("final_file_delete_at", now).lte("final_file_delete_at", horizon).order("final_file_delete_at").limit(30),
    context.db.from("file_cleanup_jobs").select("id,workflow_id,reason,status,attempts,last_error,scheduled_for").in("status", ["pending", "failed"]).order("scheduled_for").limit(40),
    context.db.from("security_budget_settings").select("disabled_services,last_blocked_at,last_blocked_reason").eq("singleton", true).maybeSingle(),
    context.db.from("security_budget_usage").select("scope,used,period_seconds,expires_at").gt("expires_at", now).like("scope", "shared:%").order("expires_at").limit(12),
  ]);
  for (const result of [locks, incidents, failedMail, overdue, expiring, jobs]) if (result.error) throw result.error;
  const titles = await titlesFor(context, [
    ...(locks.data ?? []).map((row) => row.workflow_id),
    ...(incidents.data ?? []).map((row) => row.workflow_id),
    ...(failedMail.data ?? []).map((row) => row.workflow_id),
    ...(overdue.data ?? []).map((row) => row.workflow_id),
    ...(jobs.data ?? []).map((row) => row.workflow_id),
  ]);
  const withTitle = <T extends { workflow_id: string }>(rows: T[] | null) => (rows ?? []).map((row) => ({ ...row, title: titles.get(row.workflow_id) || "Proceso" }));
  return {
    turns: withTitle(locks.data),
    incidents: (incidents.data ?? []).map((row) => ({ ...row, title: titles.get(row.workflow_id) || "Proceso" })),
    failed_emails: withTitle(failedMail.data),
    overdue_files: withTitle(overdue.data),
    expiring_processes: expiring.data ?? [],
    cleanup_jobs: (jobs.data ?? []).map((row) => ({ ...row, last_error: sanitizeCleanupError(row.last_error), title: titles.get(row.workflow_id) || "Proceso" })),
    budget: budget.error ? null : {
      disabled_services: budget.data?.disabled_services ?? [],
      last_blocked_at: budget.data?.last_blocked_at ?? null,
      last_blocked_reason: budget.data?.last_blocked_reason ?? null,
    },
    usage: usage.error ? [] : usage.data ?? [],
  };
}

async function workflowDetail(context: AdminContext, payload: Record<string, unknown>) {
  const workflowId = text(payload.workflow_id, 64);
  if (!uuid(workflowId)) throw new HttpError("Proceso no válido.");
  const { data: workflow } = await context.db.from("workflows").select("id,owner_id,title,status,signature_count,expected_signature_count,paused_reason,created_at,last_activity_at,completed_at,final_file_delete_at,current_version_id").eq("id", workflowId).maybeSingle();
  if (!workflow) throw new HttpError("El proceso ya no existe.", 404, "NOT_FOUND");
  const [owner, lock, waitlist, invitations, versions] = await Promise.all([
    context.db.auth.admin.getUserById(workflow.owner_id),
    context.db.from("open_round_locks").select("holder_name,holder_email,expires_at").eq("workflow_id", workflowId).maybeSingle(),
    context.db.from("open_round_waitlist").select("session_hash,holder_name,email,joined_at").eq("workflow_id", workflowId).order("joined_at").limit(50),
    context.db.from("round_invitations").select("id,email,holder_name,status,email_error,email_sent_at,expires_at,created_at").eq("workflow_id", workflowId).order("created_at", { ascending: false }).limit(50),
    context.db.from("document_versions").select("id,sequence,byte_size,submitted_by_name,submitted_by_email,delete_after,created_at,validation_summary").eq("workflow_id", workflowId).is("discarded_at", null).order("sequence", { ascending: false }).limit(21),
  ]);
  return {
    workflow: { ...workflow, owner_email: owner.data.user?.email || workflow.owner_id },
    lock: lock.data,
    waitlist: waitlist.data ?? [],
    invitations: invitations.data ?? [],
    versions: (versions.data ?? []).map((version) => {
      const { validation_summary: summary, ...visible } = version;
      return { ...visible, signatures: visibleSignatures(summary) };
    }),
  };
}

async function accountDetail(context: AdminContext, payload: Record<string, unknown>) {
  const userId = text(payload.user_id, 64);
  if (!userId) throw new HttpError("Cuenta no válida.");
  const { data: target, error } = await context.db.auth.admin.getUserById(userId);
  if (error || !target.user) throw new HttpError("La cuenta ya no existe.", 404, "NOT_FOUND");
  const { data: workflows, error: workflowError } = await context.db.from("workflows").select("id,title,status,signature_count,expected_signature_count,last_activity_at,created_at").eq("owner_id", userId).order("last_activity_at", { ascending: false }).limit(50);
  if (workflowError) throw workflowError;
  const ids = (workflows ?? []).map((workflow) => workflow.id);
  const { data: versions } = ids.length
    ? await context.db.from("document_versions").select("byte_size").in("workflow_id", ids).is("discarded_at", null)
    : { data: [] as { byte_size: number }[] };
  const storedBytes = (versions ?? []).reduce((sum, version) => sum + (version.byte_size || 0), 0);
  return {
    user: publicUser(target.user, {
      total: workflows?.length ?? 0,
      active: (workflows ?? []).filter((workflow) => workflow.status === "active").length,
    }),
    stored_bytes: storedBytes,
    workflows: workflows ?? [],
  };
}

async function search(context: AdminContext, payload: Record<string, unknown>) {
  const query = likeQuery(text(payload.query, 80));
  if (query.length < 2) throw new HttpError("Escribe al menos dos caracteres.");
  const [workflows, users] = await Promise.all([
    listWorkflows(context, uuid(query) ? { query, page: 1 } : { query, page: 1 }),
    listUsers(context, { query }),
  ]);
  return { workflows: workflows.workflows.slice(0, 20), users: users.users.slice(0, 20) };
}

async function listAudit(context: AdminContext, payload: Record<string, unknown>) {
  const query = likeQuery(text(payload.query, 80));
  let request = context.db.from("superadmin_audit_log").select("id,admin_email,action,target_type,target_id,reason,metadata,created_at").order("created_at", { ascending: false }).limit(80);
  if (uuid(query)) request = request.eq("target_id", query);
  else if (query.includes("@")) request = request.ilike("admin_email", `%${query}%`);
  else if (query) request = request.ilike("action", `%${query}%`);
  const { data, error } = await request;
  if (error) throw error;
  return { audit: data ?? [] };
}

async function recentAction(context: AdminContext, action: string, targetId: string | null) {
  const since = new Date(Date.now() - 60_000).toISOString();
  let request = context.db.from("superadmin_audit_log").select("id", { count: "exact", head: true }).eq("action", action).gte("created_at", since);
  if (targetId) request = request.eq("target_id", targetId);
  const { count } = await request;
  return (count ?? 0) > 0;
}

async function assertInvitationMail(context: AdminContext) {
  const { data: settings } = await context.db.from("system_settings").select("email_master_enabled,email_invitations_enabled,maintenance_mode").eq("singleton", true).single();
  if (settings?.maintenance_mode) throw new HttpError("El mantenimiento frena el envío de invitaciones.");
  if (!settings?.email_master_enabled || !settings.email_invitations_enabled) throw new HttpError("Las invitaciones por correo están desactivadas.");
}

async function sendMail(context: AdminContext, to: string, subject: string, html: string, idempotency: string) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!resendKey || !from) throw new HttpError("El envío de correo no está configurado.");
  return budgetedFetch(context.db, "https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotency },
    body: JSON.stringify({ from, to: [to], subject, html }),
  });
}

async function removeWaiter(context: AdminContext, payload: Record<string, unknown>) {
  const workflowId = text(payload.workflow_id, 64);
  const sessionHash = text(payload.session_hash, 128);
  if (!uuid(workflowId) || !/^[a-f0-9]{64}$/i.test(sessionHash)) throw new HttpError("No se puede quitar a esa persona de la cola.");
  const { data: person } = await context.db.from("open_round_waitlist").select("holder_name,email").eq("workflow_id", workflowId).eq("session_hash", sessionHash).maybeSingle();
  if (!person) throw new HttpError("Esa persona ya no está en la cola.", 404, "NOT_FOUND");
  await audit(context, "remove_waiter_requested", "workflow", workflowId, null, { holder_name: person.holder_name, email: person.email });
  const { error } = await context.db.from("open_round_waitlist").delete().eq("workflow_id", workflowId).eq("session_hash", sessionHash);
  if (error) throw error;
  return { ok: true };
}

async function resendInvitation(context: AdminContext, payload: Record<string, unknown>) {
  const invitationId = text(payload.invitation_id, 64);
  if (!uuid(invitationId)) throw new HttpError("Invitación no válida.");
  if (await recentAction(context, "resend_invitation_requested", invitationId)) throw new HttpError("Espera un minuto antes de reenviar este correo.");
  const { data: invitation } = await context.db.from("round_invitations").select("id,workflow_id,email,holder_name,status,token_hash,email_error,email_sent_at,expires_at").eq("id", invitationId).maybeSingle();
  if (!invitation) throw new HttpError("La invitación ya no existe.", 404, "NOT_FOUND");
  if (invitation.status === "completed") throw new HttpError("Esa invitación ya se usó para firmar.");
  if (Date.parse(invitation.expires_at) <= Date.now()) throw new HttpError("Esa invitación ya caducó. El plazo publicado no se amplía desde aquí.");
  if (invitation.email_sent_at && Date.now() - Date.parse(invitation.email_sent_at) < 60_000) throw new HttpError("Espera un minuto antes de reenviar este correo.");
  const { data: workflow } = await context.db.from("workflows").select("id,title,status").eq("id", invitation.workflow_id).maybeSingle();
  if (!workflow || workflow.status !== "active") throw new HttpError("Este proceso ya no admite invitaciones.");
  await assertInvitationMail(context);
  const { data: template } = await context.db.from("email_templates").select("subject_template,body_template,enabled").eq("template_key", "invitation").single();
  if (!template?.enabled) throw new HttpError("La plantilla de invitación está apagada.");
  await audit(context, "resend_invitation_requested", "invitation", invitationId, null, { workflow_id: workflow.id, email: invitation.email });
  const rawToken = crypto.randomUUID();
  const previousHash = invitation.token_hash;
  const previousStatus = invitation.status;
  const rotated = await context.db.from("round_invitations").update({ token_hash: await sha256(rawToken), email_error: null, status: previousStatus === "cancelled" ? "pending" : previousStatus }).eq("id", invitationId);
  if (rotated.error) throw rotated.error;
  const link = `https://firma.veryfacil.org/r/${workflow.id}?invite=${encodeURIComponent(rawToken)}`;
  const variables = { name: invitation.holder_name, title: workflow.title, link };
  const subject = render(template.subject_template, variables);
  const html = emailFrame(`<p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Invitación a firmar</p><h1 style="margin:10px 0 16px;font-size:28px">Tienes un documento pendiente</h1>${paragraphs(render(template.body_template, variables))}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Abrir invitación</a></p>`);
  const minute = Math.floor(Date.now() / 60_000);
  const response = await sendMail(context, invitation.email, subject, html, `leapsign-admin-resend-${invitationId}-${minute}`);
  if (!response.ok) {
    await context.db.from("round_invitations").update({ token_hash: previousHash, status: previousStatus, email_error: `HTTP ${response.status}` }).eq("id", invitationId);
    throw new HttpError("El correo no salió. La invitación anterior sigue igual.");
  }
  await context.db.from("round_invitations").update({ email_sent_at: new Date().toISOString(), email_error: null }).eq("id", invitationId);
  return { ok: true };
}

async function finishCleanupJob(context: AdminContext, job: { id: number; storage_path: string }) {
  await context.db.from("file_cleanup_jobs").update({ status: "processing" }).eq("id", job.id);
  const result = await context.db.storage.from("firmador-documents").remove([job.storage_path]);
  await context.db.rpc("finish_file_cleanup", { p_path: job.storage_path, p_error: result.error?.message ?? null });
  return !result.error;
}

async function retryCleanup(context: AdminContext, payload: Record<string, unknown>) {
  const jobId = Number(payload.job_id);
  if (!Number.isSafeInteger(jobId) || jobId <= 0) throw new HttpError("Purga no válida.");
  const { data: settings } = await context.db.from("system_settings").select("automatic_cleanup_enabled").eq("singleton", true).single();
  if (!settings?.automatic_cleanup_enabled) throw new HttpError("El procesamiento de purgas está desactivado.");
  const { data: job } = await context.db.from("file_cleanup_jobs").select("id,storage_path,status,scheduled_for").eq("id", jobId).maybeSingle();
  if (!job || !["pending", "failed"].includes(job.status)) throw new HttpError("Esa purga ya no está pendiente.", 404, "NOT_FOUND");
  if (Date.parse(job.scheduled_for) > Date.now()) throw new HttpError("Ese archivo todavía está dentro del plazo publicado.");
  await audit(context, "cleanup_retry_requested", "cleanup", String(jobId), null);
  const removed = await finishCleanupJob(context, job);
  return { ok: true, outcome: removed ? "done" : "failed" };
}

async function testEmail(context: AdminContext, _payload: Record<string, unknown>) {
  if (await recentAction(context, "test_email_requested", context.user.id)) throw new HttpError("Espera un minuto antes de enviar otro correo de prueba.");
  const { data: settings } = await context.db.from("system_settings").select("email_master_enabled,maintenance_mode").eq("singleton", true).single();
  if (settings?.maintenance_mode) throw new HttpError("El mantenimiento frena el envío de correos.");
  if (!settings?.email_master_enabled) throw new HttpError("El envío general de correos está apagado.");
  await audit(context, "test_email_requested", "account", context.user.id, null, { email: context.email });
  const html = emailFrame(`<h1 style="margin:0 0 16px;font-size:28px">Correo de prueba</h1>${paragraphs("Este mensaje solo llega a la cuenta que tiene abierto el panel. No abre ningún documento ni invita a firmar.")}`);
  const minute = Math.floor(Date.now() / 60_000);
  const response = await sendMail(context, context.email, "LeapSign · correo de prueba del panel", html, `leapsign-admin-test-${context.user.id}-${minute}`);
  if (!response.ok) throw new HttpError("El correo de prueba no salió. El cupo de correos puede estar agotado o el servicio pausado.");
  return { ok: true, sent_to: context.email };
}

async function pauseService(context: AdminContext, payload: Record<string, unknown>) {
  const service = text(payload.service, 20);
  if (!pausableServices.includes(service as typeof pausableServices[number]) || typeof payload.enabled !== "boolean") throw new HttpError("Servicio no válido.");
  const enabled = payload.enabled;
  const { data: settings, error } = await context.db.from("security_budget_settings").select("disabled_services").eq("singleton", true).single();
  if (error) throw error;
  const current = Array.isArray(settings.disabled_services) ? settings.disabled_services.filter((item): item is string => typeof item === "string") : [];
  const next = enabled ? current.filter((item) => item !== service) : [...new Set([...current, service])];
  await audit(context, "service_pause_requested", "budget", service, null, { enabled });
  const { error: updateError } = await context.db.from("security_budget_settings").update({ disabled_services: next, updated_at: new Date().toISOString() }).eq("singleton", true);
  if (updateError) throw updateError;
  return { ok: true, disabled_services: next };
}

async function runCleanup(context: AdminContext, _payload: Record<string, unknown>) {
  const { data: settings } = await context.db.from("system_settings").select("automatic_cleanup_enabled").eq("singleton", true).single();
  if (!settings?.automatic_cleanup_enabled) throw new HttpError("El procesamiento de purgas está desactivado.");
  await audit(context, "cleanup_run_requested", "cleanup", "pending", null);
  const { data: jobs, error } = await context.db.from("file_cleanup_jobs").select("id,storage_path").in("status", ["pending", "failed"]).lte("scheduled_for", new Date().toISOString()).order("scheduled_for").limit(100);
  if (error) throw error;
  let removed = 0;
  let failed = 0;
  for (const job of jobs ?? []) {
    if (await finishCleanupJob(context, job)) removed += 1;
    else failed += 1;
  }
  return { ok: true, removed, failed };
}

Deno.serve(protectEndpoint("superadmin-console", createClient, async (request) => {
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
    else if (action === "operations") data = await operations(context);
    else if (action === "workflow_detail") data = await workflowDetail(context, payload);
    else if (action === "account_detail") data = await accountDetail(context, payload);
    else if (action === "search") data = await search(context, payload);
    else if (action === "audit") data = await listAudit(context, payload);
    else if (action === "remove_waiter") data = await removeWaiter(context, payload);
    else if (action === "resend_invitation") data = await resendInvitation(context, payload);
    else if (action === "retry_cleanup") data = await retryCleanup(context, payload);
    else if (action === "test_email") data = await testEmail(context, payload);
    else if (action === "pause_service") data = await pauseService(context, payload);
    else throw new HttpError("Acción administrativa no válida.");
    return Response.json(data, { headers });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    const code = error instanceof HttpError ? error.code : "INTERNAL_ERROR";
    const message = error instanceof HttpError ? error.message : "No pudimos completar la operación administrativa.";
    console.error("superadmin-console", code, error instanceof Error ? error.message : error);
    return Response.json({ error: message, code }, { status, headers });
  }
}));
