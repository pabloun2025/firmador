import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "../lib/supabase";
import "./admin.css";

type Tab = "overview" | "operations" | "accounts" | "workflows" | "communications" | "audit";
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
  expected_signature_count?: number | null;
  created_at: string;
  last_activity_at: string;
  paused_reason?: string;
};
type SignatureRead = { status: string; names: string[]; addedNames: string[] } | null;
type OperationsData = {
  turns: { workflow_id: string; title: string; holder_name: string; holder_email?: string | null; expires_at: string }[];
  incidents: { id: string; workflow_id: string; title: string; reason?: string | null; detail?: string | null; comment?: string | null; reporter_name?: string | null; reporter_email?: string | null; created_at: string }[];
  failed_emails: { id: string; workflow_id: string; title: string; email: string; holder_name: string; email_error?: string | null; expires_at: string }[];
  overdue_files: { id: string; workflow_id: string; title: string; sequence: number; delete_after: string; submitted_by_name?: string | null }[];
  expiring_processes: { id: string; title: string; final_file_delete_at: string }[];
  cleanup_jobs: { id: number; workflow_id: string; title: string; reason: string; status: string; attempts: number; last_error?: string | null; scheduled_for: string }[];
  budget: { disabled_services: string[]; last_blocked_at?: string | null; last_blocked_reason?: string | null } | null;
  usage: { scope: string; used: number; period_seconds: number; expires_at: string }[];
};
type WorkflowDetail = {
  workflow: AdminWorkflow & { completed_at?: string | null; final_file_delete_at?: string | null };
  lock: { holder_name: string; holder_email?: string | null; expires_at: string } | null;
  waitlist: { session_hash: string; holder_name: string; email?: string | null; joined_at: string }[];
  invitations: { id: string; email: string; holder_name: string; status: string; email_error?: string | null; expires_at: string }[];
  versions: { id: string; sequence: number; byte_size: number; submitted_by_name?: string | null; delete_after?: string | null; created_at: string; signatures: SignatureRead }[];
};
type AccountDetail = {
  user: AdminUser;
  stored_bytes: number;
  workflows: { id: string; title: string; status: string; signature_count: number; expected_signature_count?: number | null; last_activity_at: string }[];
};
type SearchResult = { users: AdminUser[]; workflows: AdminWorkflow[] };
type Act = (body: Record<string, unknown>, success: string) => Promise<boolean>;

const date = (value?: string | null) => value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Nunca";
const number = (value = 0) => new Intl.NumberFormat("es-ES").format(value);
const bytes = (value = 0) => value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : value >= 1024 ** 2 ? `${(value / 1024 ** 2).toFixed(1)} MB` : `${Math.ceil(value / 1024)} KB`;
const signatureLine = (signatures: SignatureRead) => {
  if (!signatures) return "Sin lectura de firmas";
  if (signatures.status === "unreadable") return "No se pudieron leer";
  if (signatures.status === "no_new_signature") return "No hay una firma nueva";
  return signatures.addedNames.join(", ") || signatures.names.join(", ") || "Firma detectada";
};
const scopeLabel = (scope: string) => ({ "shared:emails": "Correos enviados", "shared:upload-bytes": "Bytes de subida", "shared:download-issuance-bytes": "Bytes de descarga preparados" }[scope] || scope);
const fillTemplate = (value: string) => value.replaceAll("{{name}}", "Ana Pérez").replaceAll("{{title}}", "Contrato de ejemplo").replaceAll("{{link}}", "https://firma.veryfacil.org");

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
  return <div className="admin-brand"><span><img src="/frog-brand.webp" alt="" /></span><div><strong>LeapSign</strong><small>Centro de control</small></div></div>;
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
      <button className="admin-secondary" onClick={() => void act({ action: "run_cleanup" }, "Purgado procesado.")}>Procesar purgas</button>
    </section>
  </>;
}

function Accounts({ users, load, act, openDetail }: { users: AdminUser[]; load: (query?: string) => void; act: Act; openDetail: (userId: string) => void }) {
  const [query, setQuery] = useState("");
  async function account(user: AdminUser, action: "disable" | "enable" | "delete") {
    if (action === "delete" && !window.confirm(`¿Eliminar definitivamente ${user.email} y sus archivos?`)) return;
    await act({ action: "account_action", account_action: action, user_id: user.id, ...(action === "delete" ? { confirm_email: user.email } : {}) }, action === "delete" ? "Cuenta y datos eliminados." : "Cuenta actualizada.");
    load(query);
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Identidades</span><h2>Cuentas</h2></div><button className="admin-secondary" onClick={() => load(query)}>Actualizar</button></div>
    <form className="admin-search" onSubmit={(event) => { event.preventDefault(); load(query); }}><input value={query} placeholder="Buscar por correo" onChange={(event) => setQuery(event.target.value)} /><button className="admin-secondary">Buscar</button></form>
    <div className="admin-table-wrap"><table><thead><tr><th>Cuenta</th><th>Actividad</th><th>Procesos</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>
      {users.map((user) => <tr key={user.id}><td><strong>{user.name || "Sin nombre"}</strong><small>{user.email}</small></td><td><span>Alta {date(user.created_at)}</span><small>Último acceso {date(user.last_sign_in_at)}</small></td><td>{user.workflows.total}<small>{user.workflows.active} activos</small></td><td><span className={`admin-status ${user.banned_until ? "paused" : "active"}`}>{user.banned_until ? "Bloqueada" : user.confirmed_at ? "Activa" : "Sin confirmar"}</span></td><td><div className="admin-row-actions"><button onClick={() => openDetail(user.id)}>Ficha</button>{user.banned_until ? <button onClick={() => void account(user, "enable")}>Reactivar</button> : <button onClick={() => void account(user, "disable")}>Bloquear</button>}<button className="danger" onClick={() => void account(user, "delete")}>Eliminar</button></div></td></tr>)}
      {!users.length && <tr><td colSpan={5}>No hay cuentas con esa búsqueda.</td></tr>}
    </tbody></table></div>
  </>;
}

function Workflows({ workflows, load, act, openDetail }: { workflows: AdminWorkflow[]; load: (query?: string, status?: string) => void; act: Act; openDetail: (workflowId: string) => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  async function manage(workflow: AdminWorkflow, action: string) {
    if ((action === "purge" || action === "cancel") && !window.confirm(action === "purge" ? `¿Purgar definitivamente “${workflow.title}”?` : `¿Cancelar “${workflow.title}”? Los archivos se programan para borrarse.`)) return;
    await act({ action: "workflow_action", workflow_action: action, workflow_id: workflow.id }, "Proceso actualizado.");
    load(query, status);
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Operaciones</span><h2>Procesos y flujos</h2></div><button className="admin-secondary" onClick={() => load(query, status)}>Actualizar</button></div>
    <form className="admin-search" onSubmit={(event) => { event.preventDefault(); load(query, status); }}>
      <input value={query} placeholder="Buscar por título o identificador" onChange={(event) => setQuery(event.target.value)} />
      <select value={status} aria-label="Estado del proceso" onChange={(event) => { setStatus(event.target.value); load(query, event.target.value); }}><option value="">Todos</option><option value="active">Activos</option><option value="paused_error">Pausados</option><option value="completed">Completados</option><option value="cancelled">Cancelados</option><option value="purged">Purgados</option></select>
      <button className="admin-secondary">Buscar</button>
    </form>
    <div className="admin-workflows">{workflows.map((workflow) => <article className="admin-card" key={workflow.id}>
      <header><div><span className={`admin-status ${workflow.status}`}>{workflow.status}</span><h3>{workflow.title}</h3><p>{workflow.owner_email} · {workflow.signature_count}{workflow.expected_signature_count ? ` de ${workflow.expected_signature_count}` : ""} firmas · actividad {date(workflow.last_activity_at)}</p></div><code>{workflow.id}</code></header>
      {workflow.paused_reason && <p className="admin-inline-warning">{workflow.paused_reason}</p>}
      <footer><button onClick={() => openDetail(workflow.id)}>Ficha</button>{workflow.status === "active" ? <button onClick={() => void manage(workflow, "pause")}>Pausar</button> : workflow.status === "paused_error" ? <button onClick={() => void manage(workflow, "resume")}>Reanudar</button> : null}<button onClick={() => void manage(workflow, "release_turn")}>Liberar turno</button><button onClick={() => void manage(workflow, "cancel")}>Cancelar</button><button className="danger" onClick={() => void manage(workflow, "purge")}>Purgar</button></footer>
    </article>)}{!workflows.length && <p>No hay procesos con ese filtro.</p>}</div>
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
    if (await act({ action: "update_settings", ...settings }, "Configuración guardada.")) setDashboard({ ...dashboard, settings });
  }
  async function saveTemplate() {
    if (!editing) return;
    setEditorError("");
    if (!await act({ action: "update_template", ...editing }, "Plantilla guardada.")) {
      setEditorError("No pudimos guardar los cambios. Tu texto sigue aquí; vuelve a intentarlo.");
      return;
    }
    setDashboard({ ...dashboard, templates: dashboard.templates.map((item) => item.template_key === editing.template_key ? editing : item) });
    setEditing(null);
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Comunicaciones</span><h2>Correos, plantillas y servicio</h2></div><button onClick={saveSettings}>Guardar configuración</button></div>
    <section className="admin-card admin-toggles">{toggles.map(([key, label]) => <label key={key}><span><strong>{label}</strong><small>{key === "maintenance_mode" ? "Frena crear procesos, enviar invitaciones y tomar turno. No frena una firma que ya está en curso." : "El cambio queda registrado en auditoría."}</small></span><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })} /></label>)}</section>
    <h3 className="admin-subheading">Plantillas de correo</h3>
    <div className="admin-template-list">{dashboard.templates.map((template) => <article className="admin-card" key={template.template_key}><div><span className={`admin-status ${template.enabled ? "active" : "paused"}`}>{template.enabled ? "Activa" : "Apagada"}</span><h3>{template.label}</h3><p>{template.subject_template}</p><small>Actualizada {date(template.updated_at)}</small></div><button className="admin-secondary" onClick={() => { setEditorError(""); setEditing({ ...template }); }}>Editar</button></article>)}</div>
    {editing && <div ref={modalRef} className="admin-modal" role="dialog" aria-modal="true" aria-label={`Editar ${editing.label}`}><section><div className="admin-section-title"><h2>{editing.label}</h2><button className="admin-secondary" onClick={() => setEditing(null)}>Cerrar</button></div><label>Asunto<input value={editing.subject_template} maxLength={160} onChange={(event) => setEditing({ ...editing, subject_template: event.target.value })} /></label><label>Mensaje<textarea value={editing.body_template} maxLength={3000} rows={9} onChange={(event) => setEditing({ ...editing, body_template: event.target.value })} /></label><div className="admin-preview"><span className="admin-kicker">Vista previa</span><strong>{fillTemplate(editing.subject_template)}</strong><p>{fillTemplate(editing.body_template)}</p></div><p className="admin-help">Variables disponibles: <code>{"{{name}}"}</code>, <code>{"{{title}}"}</code> y <code>{"{{link}}"}</code>. La vista previa no envía ningún correo.</p><label className="admin-check"><input type="checkbox" checked={editing.enabled} onChange={(event) => setEditing({ ...editing, enabled: event.target.checked })} /> Plantilla activa</label><button onClick={saveTemplate}>Guardar plantilla</button>{editorError && <p className="admin-alert error" role="alert">{editorError}</p>}</section></div>}
  </>;
}

export function Operations({ data, load, act, openWorkflow, openAccount, find }: { data: OperationsData; load: () => void; act: Act; openWorkflow: (id: string) => void; openAccount: (id: string) => void; find: (query: string) => Promise<SearchResult | undefined> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult | null>(null);
  const creationPaused = data.budget?.disabled_services.includes("creation") ?? false;
  const emailsPaused = data.budget?.disabled_services.includes("emails") ?? false;
  async function search(event: FormEvent) {
    event.preventDefault();
    const found = await find(query);
    if (found) setResults(found);
  }
  async function service(service: "creation" | "emails", enabled: boolean, success: string) {
    if (await act({ action: "pause_service", service, enabled }, success)) load();
  }
  return <>
    <div className="admin-section-title"><div><span className="admin-kicker">Día a día</span><h2>Operación</h2></div><button className="admin-secondary" onClick={load}>Actualizar</button></div>
    <form className="admin-search" onSubmit={(event) => void search(event)}><input value={query} placeholder="Buscar proceso, identificador o correo" onChange={(event) => setQuery(event.target.value)} /><button className="admin-secondary">Buscar</button></form>
    {results && <section className="admin-card admin-ops-block"><h3>Resultados</h3><ul>{results.workflows.map((workflow) => <li key={workflow.id}><div><strong>{workflow.title}</strong><p>{workflow.owner_email} · {workflow.status}</p></div><button className="admin-secondary" onClick={() => openWorkflow(workflow.id)}>Abrir ficha</button></li>)}{results.users.map((user) => <li key={user.id}><div><strong>{user.email}</strong><p>{user.workflows.total} procesos</p></div><button className="admin-secondary" onClick={() => openAccount(user.id)}>Abrir ficha</button></li>)}{!results.workflows.length && !results.users.length && <li>Sin resultados.</li>}</ul></section>}
    <div className="admin-ops">
      <section className="admin-card"><h3>Cupo</h3>{data.budget ? <p>Último bloqueo: {data.budget.last_blocked_at ? `${date(data.budget.last_blocked_at)} · ${data.budget.last_blocked_reason || "sin detalle"}` : "ninguno reciente"}.</p> : <p>El cupo no está disponible en esta base.</p>}<p className="admin-warning-note">Estos límites internos no son un tope de factura.</p>{!!data.usage.length && <ul>{data.usage.map((item) => <li key={`${item.scope}-${item.period_seconds}`}><div><strong>{scopeLabel(item.scope)}</strong><p>{item.period_seconds >= 20 * 86400 ? "Ventana de 30 días" : "Hoy"} · vence {date(item.expires_at)}</p></div><span>{item.scope.includes("bytes") ? bytes(item.used) : number(item.used)}</span></li>)}</ul>}<div className="admin-row-actions"><button onClick={() => void service("creation", creationPaused, creationPaused ? "Creación reanudada." : "Creación pausada.")}>{creationPaused ? "Reanudar creación" : "Pausar creación"}</button><button onClick={() => void service("emails", emailsPaused, emailsPaused ? "Correos reanudados." : "Correos pausados.")}>{emailsPaused ? "Reanudar correos" : "Pausar correos"}</button><button className="admin-secondary" onClick={() => void act({ action: "test_email" }, "Correo de prueba enviado a tu cuenta.").then((ok) => { if (ok) load(); })}>Enviar correo de prueba a mi cuenta</button></div></section>
      <section className="admin-card"><h3>Turnos que vencen</h3>{data.turns.length ? <ul>{data.turns.map((turn) => <li key={turn.workflow_id}><div><strong>{turn.holder_name}</strong><p>{turn.title} · vence {date(turn.expires_at)}{turn.holder_email ? ` · ${turn.holder_email}` : ""}</p></div><button className="admin-secondary" onClick={() => openWorkflow(turn.workflow_id)}>Ficha</button></li>)}</ul> : <p>No hay turnos activos.</p>}</section>
      <section className="admin-card"><h3>Incidencias</h3>{data.incidents.length ? <ul>{data.incidents.map((incident) => <li key={incident.id}><div><strong>{incident.title}</strong><p>{incident.reason || incident.comment}{incident.detail ? ` · ${incident.detail}` : ""}</p><small>{incident.reporter_name || "Sin nombre"}{incident.reporter_email ? ` · ${incident.reporter_email}` : ""} · {date(incident.created_at)}</small></div></li>)}</ul> : <p>No hay incidencias recientes.</p>}</section>
      <section className="admin-card"><h3>Correos que no salieron</h3>{data.failed_emails.length ? <ul>{data.failed_emails.map((mail) => <li key={mail.id}><div><strong>{mail.email}</strong><p>{mail.title} · {mail.holder_name} · {mail.email_error}</p></div><button className="admin-secondary" onClick={() => void act({ action: "resend_invitation", invitation_id: mail.id }, "Invitación reenviada.").then((ok) => { if (ok) load(); })}>Reenviar</button></li>)}</ul> : <p>No hay correos con error.</p>}</section>
      <section className="admin-card"><h3>Archivos fuera de plazo</h3>{data.overdue_files.length ? <ul>{data.overdue_files.map((file) => <li key={file.id}><div><strong>{file.title}</strong><p>Versión {file.sequence}{file.submitted_by_name ? ` · ${file.submitted_by_name}` : ""} · plazo {date(file.delete_after)}</p></div></li>)}</ul> : <p>No hay archivos vencidos pendientes de ocultar.</p>}</section>
      <section className="admin-card"><h3>Procesos completados que caducan en 48 horas</h3>{data.expiring_processes.length ? <ul>{data.expiring_processes.map((workflow) => <li key={workflow.id}><div><strong>{workflow.title}</strong><p>El archivo final deja de compartirse {date(workflow.final_file_delete_at)}.</p></div><button className="admin-secondary" onClick={() => openWorkflow(workflow.id)}>Ficha</button></li>)}</ul> : <p>Ningún proceso completado caduca en las próximas 48 horas.</p>}</section>
      <section className="admin-card"><h3>Purgas</h3>{data.cleanup_jobs.length ? <ul>{data.cleanup_jobs.map((job) => <li key={job.id}><div><strong>{job.title}</strong><p>{job.reason} · {job.status} · intento {job.attempts}{job.last_error ? ` · ${job.last_error}` : ""} · {date(job.scheduled_for)}</p></div><button className="admin-secondary" disabled={Date.parse(job.scheduled_for) > Date.now()} onClick={() => void act({ action: "retry_cleanup", job_id: job.id }, "Purga reintentada.").then((ok) => { if (ok) load(); })}>Reintentar</button></li>)}</ul> : <p>No hay purgas pendientes ni fallidas.</p>}</section>
    </div>
  </>;
}

export function WorkflowFile({ detail, act, close, reload }: { detail: WorkflowDetail; act: Act; close: () => void; reload: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  const workflow = detail.workflow;
  const due = workflow.expected_signature_count ? `${workflow.signature_count} de ${workflow.expected_signature_count}` : `${workflow.signature_count}`;
  async function remove(sessionHash: string) {
    if (await act({ action: "remove_waiter", workflow_id: workflow.id, session_hash: sessionHash }, "Persona quitada de la cola.")) reload();
  }
  return <div className="admin-modal" role="dialog" aria-modal="true" aria-label={`Ficha de ${workflow.title}`}><section className="wide admin-file"><div className="admin-section-title"><div><span className="admin-kicker">Ficha del proceso</span><h2>{workflow.title}</h2></div><button className="admin-secondary" onClick={close}>Cerrar</button></div>
    <dl><dt>Propietario</dt><dd>{workflow.owner_email}</dd><dt>Estado</dt><dd>{workflow.status}</dd><dt>Firmas</dt><dd>{due}</dd><dt>Turno</dt><dd>{detail.lock ? `${detail.lock.holder_name} hasta ${date(detail.lock.expires_at)}` : "Libre"}</dd><dt>Archivo final</dt><dd>{workflow.final_file_delete_at ? date(workflow.final_file_delete_at) : "Sin fecha de caducidad"}</dd></dl>
    {workflow.paused_reason && <p className="admin-inline-warning">{workflow.paused_reason}</p>}
    <h3>Cola</h3>{detail.waitlist.length ? <ul>{detail.waitlist.map((person) => <li key={person.session_hash}><div><strong>{person.holder_name}</strong><p>{person.email || "Sin correo"} · desde {date(person.joined_at)}</p></div><button className="admin-secondary" onClick={() => void remove(person.session_hash)}>Quitar de la cola</button></li>)}</ul> : <p>Nadie espera turno.</p>}
    <h3>Invitaciones</h3>{detail.invitations.length ? <ul>{detail.invitations.map((invitation) => <li key={invitation.id}><div><strong>{invitation.holder_name}</strong><p>{invitation.email} · {invitation.status}{invitation.email_error ? ` · ${invitation.email_error}` : ""} · vence {date(invitation.expires_at)}</p></div>{invitation.email_error && invitation.status !== "completed" && <button className="admin-secondary" onClick={() => void act({ action: "resend_invitation", invitation_id: invitation.id }, "Invitación reenviada.").then((ok) => { if (ok) reload(); })}>Reenviar</button>}</li>)}</ul> : <p>No hay invitaciones.</p>}
    <h3>Versiones</h3><ul>{detail.versions.map((version) => <li key={version.id}><div><strong>Versión {version.sequence}</strong><p>{version.submitted_by_name || "Sin nombre"} · {bytes(version.byte_size)} · {signatureLine(version.signatures)}{version.delete_after ? ` · se retira ${date(version.delete_after)}` : ""}</p></div></li>)}</ul>
  </section></div>;
}

export function AccountFile({ detail, close, openWorkflow }: { detail: AccountDetail; close: () => void; openWorkflow: (id: string) => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);
  const user = detail.user;
  return <div className="admin-modal" role="dialog" aria-modal="true" aria-label={`Ficha de ${user.email}`}><section className="wide admin-file"><div className="admin-section-title"><div><span className="admin-kicker">Ficha de la cuenta</span><h2>{user.email}</h2></div><button className="admin-secondary" onClick={close}>Cerrar</button></div>
    <dl><dt>Nombre</dt><dd>{user.name || "Sin nombre"}</dd><dt>Alta</dt><dd>{date(user.created_at)}</dd><dt>Último acceso</dt><dd>{date(user.last_sign_in_at)}</dd><dt>Correo</dt><dd>{user.confirmed_at ? `Confirmado ${date(user.confirmed_at)}` : "Sin confirmar"}</dd><dt>Estado</dt><dd>{user.banned_until ? "Bloqueada" : "Activa"}</dd><dt>Almacenamiento</dt><dd>{bytes(detail.stored_bytes)}</dd></dl>
    <h3>Procesos</h3>{detail.workflows.length ? <ul>{detail.workflows.map((workflow) => <li key={workflow.id}><div><strong>{workflow.title}</strong><p>{workflow.status} · {workflow.signature_count}{workflow.expected_signature_count ? ` de ${workflow.expected_signature_count}` : ""} firmas · {date(workflow.last_activity_at)}</p></div><button className="admin-secondary" onClick={() => openWorkflow(workflow.id)}>Ficha</button></li>)}</ul> : <p>Esta cuenta no tiene procesos.</p>}
  </section></div>;
}

function Audit({ entries, onFilter }: { entries: AuditEntry[]; onFilter: (query: string) => void }) {
  const [query, setQuery] = useState("");
  return <><div className="admin-section-title"><div><span className="admin-kicker">Trazabilidad</span><h2>Auditoría administrativa</h2></div></div><form className="admin-search" onSubmit={(event) => { event.preventDefault(); onFilter(query); }}><input value={query} placeholder="Filtrar por acción, correo o identificador" onChange={(event) => setQuery(event.target.value)} /><button className="admin-secondary">Filtrar</button></form><div className="admin-audit">{entries.map((entry) => <article className="admin-card" key={entry.id}><header><strong>{entry.action.replaceAll("_", " ")}</strong><time>{date(entry.created_at)}</time></header>{entry.reason && <p>{entry.reason}</p>}<small>{entry.admin_email} · {entry.target_type}{entry.target_id ? ` · ${entry.target_id}` : ""}</small></article>)}{!entries.length && <p>No hay registros con ese filtro.</p>}</div></>;
}

function Console({ session }: { session: Session }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [workflows, setWorkflows] = useState<AdminWorkflow[]>([]);
  const [operations, setOperations] = useState<OperationsData | null>(null);
  const [workflowDetail, setWorkflowDetail] = useState<WorkflowDetail | null>(null);
  const [accountDetail, setAccountDetail] = useState<AccountDetail | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  async function run<T>(operation: () => Promise<T>) { setBusy(true); setError(""); try { return await operation(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo completar la operación."); } finally { setBusy(false); } }
  async function loadDashboard() { const result = await run(() => invoke<Dashboard>({ action: "dashboard" })); if (result) setDashboard(result); }
  async function loadUsers(query = "") { const result = await run(() => invoke<{ users: AdminUser[] }>({ action: "users", query })); if (result) setUsers(result.users); }
  async function loadWorkflows(query = "", status = "") { const result = await run(() => invoke<{ workflows: AdminWorkflow[] }>({ action: "workflows", query, status })); if (result) setWorkflows(result.workflows); }
  async function loadOperations() { const result = await run(() => invoke<OperationsData>({ action: "operations" })); if (result) setOperations(result); }
  async function find(query: string) { return run(() => invoke<SearchResult>({ action: "search", query })); }
  async function openWorkflow(id: string) { const result = await run(() => invoke<WorkflowDetail>({ action: "workflow_detail", workflow_id: id })); if (result) { setAccountDetail(null); setWorkflowDetail(result); } }
  async function openAccount(id: string) { const result = await run(() => invoke<AccountDetail>({ action: "account_detail", user_id: id })); if (result) { setWorkflowDetail(null); setAccountDetail(result); } }
  async function loadAudit(query = "") { const result = await run(() => invoke<{ audit: AuditEntry[] }>({ action: "audit", query })); if (result) setAuditEntries(result.audit); }
  async function act(body: Record<string, unknown>, success: string) { const result = await run(() => invoke({ reason: "Gestion directa", ...body })); if (!result) return false; setNotice(success); await loadDashboard(); return true; }
  useEffect(() => { void loadDashboard(); }, []);
  useEffect(() => { if (tab === "accounts") void loadUsers(); if (tab === "workflows") void loadWorkflows(); if (tab === "operations") void loadOperations(); }, [tab]);
  const content = useMemo(() => {
    if (!dashboard) return <div className="admin-loading">Preparando el centro de control…</div>;
    if (tab === "overview") return <Overview dashboard={dashboard} refresh={() => void loadDashboard()} act={act} />;
    if (tab === "operations") return operations ? <Operations data={operations} load={() => void loadOperations()} act={act} openWorkflow={(id) => void openWorkflow(id)} openAccount={(id) => void openAccount(id)} find={find} /> : <div className="admin-loading">{error ? "No se pudo abrir la operación." : "Preparando la operación…"}</div>;
    if (tab === "accounts") return <Accounts users={users} load={(query) => void loadUsers(query)} act={act} openDetail={(id) => void openAccount(id)} />;
    if (tab === "workflows") return <Workflows workflows={workflows} load={(query, status) => void loadWorkflows(query, status)} act={act} openDetail={(id) => void openWorkflow(id)} />;
    if (tab === "communications") return <Communications dashboard={dashboard} setDashboard={setDashboard} act={act} />;
    return <Audit entries={auditEntries ?? dashboard.audit} onFilter={(query) => void loadAudit(query)} />;
  }, [dashboard, tab, users, workflows, operations, auditEntries, error]);
  return <main className="admin-shell" aria-busy={busy}>
    <header className="admin-top"><AdminBrand /><div><span>{session.user.email}</span><button className="admin-secondary" onClick={() => getSupabase().then((supabase) => supabase.auth.signOut()).then(() => window.location.reload())}>Salir</button></div></header>
    <div className="admin-layout"><nav aria-label="Centro de control">{([['overview','Resumen'],['operations','Operación'],['accounts','Cuentas'],['workflows','Procesos'],['communications','Correos y sistema'],['audit','Auditoría']] as [Tab,string][]).map(([key, label]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => { setTab(key); setNotice(""); setError(""); }}>{label}</button>)}</nav><section className="admin-content">{notice && <p className="admin-alert success">{notice}</p>}{error && <p className="admin-alert error">{error}</p>}{content}</section></div>
    {workflowDetail && <WorkflowFile detail={workflowDetail} act={act} close={() => setWorkflowDetail(null)} reload={() => void openWorkflow(workflowDetail.workflow.id)} />}
    {accountDetail && <AccountFile detail={accountDetail} close={() => setAccountDetail(null)} openWorkflow={(id) => void openWorkflow(id)} />}
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
