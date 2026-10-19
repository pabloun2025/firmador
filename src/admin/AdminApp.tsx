import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";
import "./admin.css";

type Tab = "overview" | "accounts" | "workflows" | "communications" | "audit";
type Dashboard = {
  metrics: Record<string, number>;
  settings: Record<string, boolean | string>;
  templates: EmailTemplate[];
  audit: AuditEntry[];
};
type EmailTemplate = {
  template_key: string;
  label: string;
  subject_template: string;
  body_template: string;
  enabled: boolean;
  updated_at: string;
};
type AuditEntry = {
  id: number;
  admin_email: string;
  action: string;
  target_type: string;
  target_id?: string | null;
  reason?: string | null;
  created_at: string;
};
type AdminUser = {
  id: string;
  email?: string;
  name?: string;
  created_at: string;
  last_sign_in_at?: string;
  confirmed_at?: string;
  banned_until?: string;
  workflows: { total: number; active: number };
};
type AdminWorkflow = {
  id: string;
  owner_email?: string;
  title: string;
  status: string;
  signature_count: number;
  created_at: string;
  last_activity_at: string;
  paused_reason?: string;
};

const date = (value?: string | null) => value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Nunca";
const number = (value = 0) => new Intl.NumberFormat("es-ES").format(value);
const bytes = (value = 0) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("superadmin-console", { body });
  if (error) {
    let detail = error.message;
    try {
      const response = (error as { context?: Response }).context;
      if (response) {
        const payload = await response.clone().json() as { error?: string };
        if (payload.error) detail = payload.error;
      }
    } catch { /* Keep the provider error. */ }
    throw new Error(detail);
  }
  return data as T;
}

async function invokeRecovery<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = await getSupabase();
  const { data, error } = await supabase.functions.invoke("superadmin-recovery", { body });
  if (error) {
    let detail = error.message;
    try {
      const response = (error as { context?: Response }).context;
      if (response) detail = ((await response.clone().json()) as { error?: string }).error || detail;
    } catch { /* Keep provider detail. */ }
    throw new Error(detail);
  }
  return data as T;
}

function AdminBrand() {
  return <div className="admin-brand"><span><img src="/frog-mark.svg" alt="" /></span><div><strong>LeapSign</strong><small>Centro de control</small></div></div>;
}

function Login({ onSession }: { onSession: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const supabase = await getSupabase();
    const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (result.error || !result.data.session) setError("No se pudo iniciar sesión. Comprueba tus datos y vuelve a intentarlo.");
    else onSession(result.data.session);
    setBusy(false);
  }
  async function recoverPassword() {
    setError(""); setNotice("");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Escribe primero el correo de la cuenta administrativa.");
    setBusy(true);
    const supabase = await getSupabase();
    const redirectTo = window.location.hostname === "admin.veryfacil.org" ? "https://admin.veryfacil.org" : `${window.location.origin}/superadmin`;
    const result = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (result.error) setError("No pudimos enviar el enlace. Espera unos minutos y vuelve a intentarlo.");
    else setNotice("Si el correo corresponde a la cuenta administrativa, recibirás un enlace para crear una contraseña nueva.");
    setBusy(false);
  }
  return <main className="admin-login">
    <AdminBrand />
    <section>
      <span className="admin-kicker">Acceso restringido</span>
      <h1>Administración de LeapSign</h1>
      <p>Este espacio está reservado a la cuenta propietaria y requiere un segundo factor.</p>
      <form onSubmit={submit}>
        <label>Correo<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <button disabled={busy}>{busy ? "Comprobando…" : "Continuar"}</button>
        <button type="button" className="admin-link-button" disabled={busy} onClick={recoverPassword}>¿Olvidaste la contraseña?</button>
      </form>
      {notice && <p className="admin-alert success">{notice}</p>}
      {error && <p className="admin-alert error">{error}</p>}
    </section>
  </main>;
}

function PasswordRecovery({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  async function save(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!valid) return setError("Usa al menos 12 caracteres, mayúscula, minúscula, número y símbolo.");
    if (password !== confirm) return setError("Las contraseñas no coinciden.");
    setBusy(true);
    const supabase = await getSupabase();
    const result = await supabase.auth.updateUser({ password });
    if (result.error) setError("El enlace ya no es válido. Solicita uno nuevo.");
    else { await supabase.auth.signOut(); window.history.replaceState({}, "", window.location.pathname); onDone(); }
    setBusy(false);
  }
  return <main className="admin-login"><AdminBrand /><section>
    <span className="admin-kicker">Recuperación verificada</span><h1>Crea una contraseña nueva</h1>
    <p>Debe tener 12 caracteres o más, mayúscula, minúscula, número y símbolo.</p>
    <form onSubmit={save}><label>Nueva contraseña<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Repite la contraseña<input type="password" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label><button disabled={busy}>{busy ? "Guardando…" : "Guardar contraseña"}</button></form>
    {error && <p className="admin-alert error">{error}</p>}
  </section></main>;
}

function MfaGate({ onReady }: { onReady: () => void }) {
  const [factorId, setFactorId] = useState("");
  const [qr, setQr] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [recoveringFactor, setRecoveringFactor] = useState(false);
  const [recoveryRequested, setRecoveryRequested] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryNotice, setRecoveryNotice] = useState("");
  useEffect(() => {
    void (async () => {
      const supabase = await getSupabase();
      const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal.data?.currentLevel === "aal2") return onReady();
      const factors = await supabase.auth.mfa.listFactors();
      const verified = factors.data?.totp.find((factor) => factor.status === "verified");
      if (verified) setFactorId(verified.id);
      else {
        const enrolled = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "LeapSign Superadmin" });
        if (enrolled.error || !enrolled.data) setError("No se pudo preparar el segundo factor.");
        else {
          setFactorId(enrolled.data.id);
          setQr(enrolled.data.totp.qr_code);
          setSecret(enrolled.data.totp.secret);
        }
      }
      setBusy(false);
    })();
  }, [onReady]);
  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    const supabase = await getSupabase();
    const challenge = await supabase.auth.mfa.challenge({ factorId });
    if (challenge.error || !challenge.data) setError("No se pudo iniciar la comprobación.");
    else {
      const result = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.data.id, code: code.replace(/\s/g, "") });
      if (result.error) setError("El código no es correcto o ya ha caducado.");
      else { await supabase.auth.refreshSession(); onReady(); }
    }
    setBusy(false);
  }
  async function requestFactorRecovery() {
    setBusy(true); setError(""); setRecoveryNotice("");
    try {
      await invokeRecovery({ action: "request" });
      setRecoveryRequested(true);
      setRecoveryNotice("Enviamos un código de ocho dígitos al correo verificado de la cuenta administrativa.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos enviar el código."); }
    setBusy(false);
  }
  async function confirmFactorRecovery(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await invokeRecovery({ action: "confirm", code: recoveryCode });
      const supabase = await getSupabase();
      await supabase.auth.signOut();
      window.location.reload();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pudimos restablecer el segundo factor."); setBusy(false); }
  }
  if (recoveringFactor) return <main className="admin-login">
    <AdminBrand />
    <section>
      <span className="admin-kicker">Recuperación protegida</span>
      <h1>Restablecer el segundo factor</h1>
      <p>Como ya validaste tu contraseña, enviaremos un código únicamente al correo verificado del superadministrador. El código caduca en 10 minutos.</p>
      {!recoveryRequested ? <button disabled={busy} onClick={requestFactorRecovery}>{busy ? "Enviando…" : "Enviar código de recuperación"}</button> : <form onSubmit={confirmFactorRecovery}>
        <label>Código de ocho dígitos<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{8}" maxLength={8} value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, ""))} required /></label>
        <button disabled={busy || recoveryCode.length !== 8}>{busy ? "Comprobando…" : "Restablecer 2FA"}</button>
      </form>}
      {recoveryNotice && <p className="admin-alert success">{recoveryNotice}</p>}
      {error && <p className="admin-alert error">{error}</p>}
      <button type="button" className="admin-link-button" disabled={busy} onClick={() => { setRecoveringFactor(false); setError(""); }}>Volver a la verificación</button>
    </section>
  </main>;
  return <main className="admin-login">
    <AdminBrand />
    <section>
      <span className="admin-kicker">Segundo factor obligatorio</span>
      <h1>{qr ? "Protege tu panel" : "Confirma que eres tú"}</h1>
      <p>{qr ? "Escanea el código con tu aplicación autenticadora. Solo tendrás que configurarlo una vez." : "Escribe el código actual de tu aplicación autenticadora."}</p>
      {qr && <div className="admin-qr"><img src={qr} alt="Código QR para configurar el segundo factor" /><code>{secret}</code></div>}
      <form onSubmit={verify}>
        <label>Código de seis dígitos<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required /></label>
        <button disabled={busy || code.length !== 6}>{busy ? "Comprobando…" : "Confirmar y entrar"}</button>
      </form>
      {!qr && <button type="button" className="admin-link-button" disabled={busy} onClick={() => { setRecoveringFactor(true); setError(""); }}>No tengo acceso a mi autenticador</button>}
      {error && <p className="admin-alert error">{error}</p>}
    </section>
  </main>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <article className={`admin-metric ${tone || ""}`}><span>{label}</span><strong>{value}</strong></article>;
}

function Overview({ dashboard, refresh, act }: { dashboard: Dashboard; refresh: () => void; act: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  const metrics = dashboard.metrics;
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Situación actual</span><h2>Resumen operativo</h2></div><button className="admin-secondary" onClick={refresh}>Actualizar</button></div>
    <div className="admin-metrics">
      <Metric label="Cuentas" value={number(metrics.accounts_total)} />
      <Metric label="Procesos activos" value={number(metrics.workflows_active)} />
      <Metric label="Turnos activos" value={number(metrics.active_turns)} />
      <Metric label="Personas esperando" value={number(metrics.waiting_people)} />
      <Metric label="Versiones disponibles" value={number(metrics.document_versions)} />
      <Metric label="Almacenamiento estimado" value={bytes(metrics.stored_bytes)} />
      <Metric label="Correos fallidos" value={number(metrics.invitations_failed)} tone={metrics.invitations_failed ? "warning" : ""} />
      <Metric label="Purgas con error" value={number(metrics.cleanup_failed)} tone={metrics.cleanup_failed ? "danger" : ""} />
    </div>
    <section className="admin-card admin-health">
      <div><h3>Mantenimiento</h3><p>{number(metrics.cleanup_pending)} archivos pendientes de purga · {number(metrics.errors_last_24h)} incidencias en las últimas 24 horas.</p></div>
      <button className="admin-secondary" onClick={() => {
        const reason = window.prompt("Motivo para ejecutar las purgas pendientes:");
        if (reason) void act({ action: "run_cleanup", reason }, "Purgado procesado.");
      }}>Procesar purgas</button>
    </section>
  </>;
}

function Accounts({ users, load, act }: { users: AdminUser[]; load: () => void; act: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  async function account(user: AdminUser, action: "disable" | "enable" | "delete") {
    const label = action === "disable" ? "bloquear" : action === "enable" ? "reactivar" : "eliminar definitivamente";
    if (!window.confirm(`¿Quieres ${label} ${user.email}?`)) return;
    const reason = window.prompt("Motivo de esta operación (mínimo 8 caracteres):");
    if (!reason) return;
    let confirm_email: string | undefined;
    if (action === "delete") {
      confirm_email = window.prompt(`Escribe ${user.email} para confirmar:`) || undefined;
      if (!confirm_email) return;
    }
    await act({ action: "account_action", account_action: action, user_id: user.id, reason, confirm_email }, action === "delete" ? "Cuenta y datos eliminados." : "Cuenta actualizada.");
    load();
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Identidades</span><h2>Cuentas</h2></div><button className="admin-secondary" onClick={load}>Actualizar</button></div>
    <div className="admin-table-wrap"><table><thead><tr><th>Cuenta</th><th>Actividad</th><th>Procesos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td><strong>{user.name || "Sin nombre"}</strong><small>{user.email}</small></td><td><span>Alta {date(user.created_at)}</span><small>Último acceso {date(user.last_sign_in_at)}</small></td><td>{user.workflows.total}<small>{user.workflows.active} activos</small></td><td><span className={`admin-status ${user.banned_until ? "paused" : "active"}`}>{user.banned_until ? "Bloqueada" : user.confirmed_at ? "Activa" : "Sin confirmar"}</span></td><td><div className="admin-row-actions">{user.banned_until ? <button onClick={() => void account(user, "enable")}>Reactivar</button> : <button onClick={() => void account(user, "disable")}>Bloquear</button>}<button className="danger" onClick={() => void account(user, "delete")}>Eliminar</button></div></td></tr>)}
    </tbody></table></div>
  </>;
}

function Workflows({ workflows, load, act }: { workflows: AdminWorkflow[]; load: () => void; act: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  async function manage(workflow: AdminWorkflow, action: string) {
    const names: Record<string, string> = { pause: "pausar", resume: "reanudar", release_turn: "liberar el turno", cancel: "cancelar", purge: "purgar definitivamente" };
    if (!window.confirm(`¿Quieres ${names[action]} “${workflow.title}”?`)) return;
    const reason = window.prompt("Motivo de esta corrección (mínimo 8 caracteres):");
    if (!reason) return;
    await act({ action: "workflow_action", workflow_action: action, workflow_id: workflow.id, reason }, "Proceso actualizado.");
    load();
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Operaciones</span><h2>Procesos y flujos</h2></div><button className="admin-secondary" onClick={load}>Actualizar</button></div>
    <div className="admin-workflows">{workflows.map((workflow) => <article className="admin-card" key={workflow.id}>
      <header><div><span className={`admin-status ${workflow.status}`}>{workflow.status}</span><h3>{workflow.title}</h3><p>{workflow.owner_email} · {workflow.signature_count} firmas · actividad {date(workflow.last_activity_at)}</p></div><code>{workflow.id}</code></header>
      {workflow.paused_reason && <p className="admin-inline-warning">{workflow.paused_reason}</p>}
      <footer>{workflow.status === "active" ? <button onClick={() => void manage(workflow, "pause")}>Pausar</button> : workflow.status === "paused_error" ? <button onClick={() => void manage(workflow, "resume")}>Reanudar</button> : null}<button onClick={() => void manage(workflow, "release_turn")}>Liberar turno</button><button onClick={() => void manage(workflow, "cancel")}>Cancelar</button><button className="danger" onClick={() => void manage(workflow, "purge")}>Purgar</button></footer>
    </article>)}</div>
  </>;
}

function Communications({ dashboard, setDashboard, act }: { dashboard: Dashboard; setDashboard: (value: Dashboard) => void; act: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  const [settings, setSettings] = useState({ ...dashboard.settings });
  const [editing, setEditing] = useState<EmailTemplate | null>(null);
  const [editorError, setEditorError] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const editorOpen = editing !== null;
  useEffect(() => {
    if (!editorOpen || !modalRef.current) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = modalRef.current;
    const controls = () => Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled)'));
    modal.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setEditing(null); }
      if (event.key !== 'Tab') return;
      const items = controls();
      const target = event.shiftKey ? items.at(-1) : items[0];
      if (!modal.contains(document.activeElement) || (!event.shiftKey && document.activeElement === items.at(-1)) || (event.shiftKey && document.activeElement === items[0])) {
        event.preventDefault(); target?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [editorOpen]);
  const toggles = [
    ["email_master_enabled", "Envío general de correos"], ["email_invitations_enabled", "Invitaciones"], ["email_reminders_enabled", "Recordatorios a 1 y 24 horas"], ["email_completion_enabled", "Objetivo de firmas alcanzado"], ["automatic_cleanup_enabled", "Procesamiento de purgas"], ["maintenance_mode", "Modo mantenimiento"],
  ];
  async function saveSettings() {
    const reason = window.prompt("Motivo del cambio de configuración:"); if (!reason) return;
    if (await act({ action: "update_settings", ...settings, reason }, "Configuración guardada.")) setDashboard({ ...dashboard, settings });
  }
  async function saveTemplate() {
    if (!editing) return;
    const reason = window.prompt("Motivo del cambio de plantilla:"); if (!reason) return;
    setEditorError("");
    if (!await act({ action: "update_template", ...editing, reason }, "Plantilla guardada.")) {
      setEditorError("No pudimos guardar los cambios. Tu texto sigue aquí; vuelve a intentarlo.");
      return;
    }
    setDashboard({ ...dashboard, templates: dashboard.templates.map((item) => item.template_key === editing.template_key ? editing : item) });
    setEditing(null);
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Comunicaciones</span><h2>Correos, plantillas y servicio</h2></div><button onClick={saveSettings}>Guardar configuración</button></div>
    <section className="admin-card admin-toggles">{toggles.map(([key, label]) => <label key={key}><span><strong>{label}</strong><small>{key === "maintenance_mode" ? "Detiene temporalmente nuevas operaciones públicas." : "El cambio queda registrado en auditoría."}</small></span><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} /></label>)}</section>
    <h3 className="admin-subheading">Plantillas de correo</h3>
    <div className="admin-template-list">{dashboard.templates.map((template) => <article className="admin-card" key={template.template_key}><div><span className={`admin-status ${template.enabled ? "active" : "paused"}`}>{template.enabled ? "Activa" : "Apagada"}</span><h3>{template.label}</h3><p>{template.subject_template}</p><small>Actualizada {date(template.updated_at)}</small></div><button className="admin-secondary" onClick={() => { setEditorError(""); setEditing({ ...template }); }}>Editar</button></article>)}</div>
    {editing && <div ref={modalRef} className="admin-modal" role="dialog" aria-modal="true" aria-label={`Editar ${editing.label}`}><section><div className="admin-section-title"><h2>{editing.label}</h2><button className="admin-secondary" onClick={() => setEditing(null)}>Cerrar</button></div><label>Asunto<input value={editing.subject_template} maxLength={160} onChange={(event) => setEditing({ ...editing, subject_template: event.target.value })} /></label><label>Mensaje<textarea value={editing.body_template} maxLength={3000} rows={9} onChange={(event) => setEditing({ ...editing, body_template: event.target.value })} /></label><p className="admin-help">Variables disponibles: <code>{"{{name}}"}</code>, <code>{"{{title}}"}</code> y <code>{"{{link}}"}</code>.</p><label className="admin-check"><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> Plantilla activa</label><button onClick={saveTemplate}>Guardar plantilla</button>{editorError && <p className="admin-alert error" role="alert">{editorError}</p>}</section></div>}
  </>;
}

function Audit({ entries }: { entries: AuditEntry[] }) {
  return <><div className="admin-section-title"><div><span className="admin-kicker">Trazabilidad</span><h2>Auditoría administrativa</h2></div></div><div className="admin-audit">{entries.map((entry) => <article className="admin-card" key={entry.id}><header><strong>{entry.action.replaceAll("_", " ")}</strong><time>{date(entry.created_at)}</time></header><p>{entry.reason || "Acceso al panel"}</p><small>{entry.admin_email} · {entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ""}</small></article>)}</div></>;
}

function Console({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workflows, setWorkflows] = useState<AdminWorkflow[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function run<T>(operation: () => Promise<T>) { setBusy(true); setError(""); try { return await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); } finally { setBusy(false); } }
  async function loadDashboard() { const result = await run(() => invoke<Dashboard>({ action: "dashboard" })); if (result) setDashboard(result); }
  async function loadUsers() { const result = await run(() => invoke<{ users: AdminUser[] }>({ action: "users" })); if (result) setUsers(result.users); }
  async function loadWorkflows() { const result = await run(() => invoke<{ workflows: AdminWorkflow[] }>({ action: "workflows" })); if (result) setWorkflows(result.workflows); }
  async function act(body: Record<string, unknown>, success: string) { const result = await run(() => invoke(body)); if (!result) return false; setNotice(success); await loadDashboard(); return true; }
  useEffect(() => { void loadDashboard(); }, []);
  useEffect(() => { if (tab === "accounts") void loadUsers(); if (tab === "workflows") void loadWorkflows(); }, [tab]);
  const content = useMemo(() => {
    if (!dashboard) return <div className="admin-loading">Preparando el centro de control…</div>;
    if (tab === "overview") return <Overview dashboard={dashboard} refresh={() => void loadDashboard()} act={act} />;
    if (tab === "accounts") return <Accounts users={users} load={() => void loadUsers()} act={act} />;
    if (tab === "workflows") return <Workflows workflows={workflows} load={() => void loadWorkflows()} act={act} />;
    if (tab === "communications") return <Communications dashboard={dashboard} setDashboard={setDashboard} act={act} />;
    return <Audit entries={dashboard.audit} />;
  }, [dashboard, tab, users, workflows]);
  return <main className="admin-shell" aria-busy={busy}>
    <header className="admin-top"><AdminBrand /><div><span>{session.user.email}</span><button className="admin-secondary" onClick={() => getSupabase().then((supabase) => supabase.auth.signOut()).then(() => window.location.reload())}>Salir</button></div></header>
    <div className="admin-layout"><nav aria-label="Centro de control">{([['overview','Resumen'],['accounts','Cuentas'],['workflows','Procesos'],['communications','Correos y sistema'],['audit','Auditoría']] as [Tab,string][]).map(([key, label]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setNotice(""); setError(""); }}>{label}</button>)}</nav><section className="admin-content">{notice && <p className="admin-alert success">{notice}</p>}{error && <p className="admin-alert error">{error}</p>}{content}</section></div>
  </main>;
}

export function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [recoveringPassword, setRecoveringPassword] = useState(window.location.hash.includes("type=recovery"));
  useEffect(() => {
    document.title = "Administración · LeapSign";
    const robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (robots) robots.content = "noindex,nofollow,noarchive";
    let unsubscribe = () => {};
    void getSupabase().then(async (supabase) => {
      const current = await supabase.auth.getSession();
      setSession(current.data.session);
      const listener = supabase.auth.onAuthStateChange((event, next) => { setSession(next); if (event === "PASSWORD_RECOVERY") setRecoveringPassword(true); if (!next) setReady(false); });
      unsubscribe = () => listener.data.subscription.unsubscribe();
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);
  if (loading) return <main className="admin-loading-page"><AdminBrand /><p>Abriendo el acceso seguro…</p></main>;
  if (recoveringPassword) return <PasswordRecovery onDone={() => { setRecoveringPassword(false); setSession(null); }} />;
  if (!session) return <Login onSession={(next) => setSession(next)} />;
  if (!ready) return <MfaGate onReady={() => setReady(true)} />;
  return <Console session={session} />;
}
