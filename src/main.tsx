import { FormEvent, lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { createRoot } from "react-dom/client";
import { getSupabase } from "./lib/supabase";
import "./styles.css";
import "./round.css";
import "./redesign.css";

type IconName =
  | "arrow"
  | "check"
  | "chevron"
  | "clock"
  | "download"
  | "eye"
  | "file"
  | "lock"
  | "mail"
  | "edit"
  | "refresh"
  | "shield"
  | "trash"
  | "upload"
  | "users";
const ICON_PATHS: Record<IconName, ReactNode> = {
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="m14 7 5 5-5 5" />
    </>
  ),
  check: <path d="m5 12 4 4L19 7" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v11" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  file: (
    <>
      <path d="M7 3h7l4 4v14H7z" />
      <path d="M14 3v5h4" />
      <path d="M10 13h5M10 17h5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m4 7 8 6 8-6" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20h4l11-11-4-4L4 16z" />
      <path d="m13.5 6.5 4 4" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M19 12a7 7 0 1 0-2 5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9 7V4h6v3M8 10v8M12 10v8M16 10v8M7 7l1 14h8l1-14" />
    </>
  ),
  upload: (
    <>
      <path d="M12 21V10" />
      <path d="m8 14 4-4 4 4" />
      <path d="M5 5h14" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="9" r="3" />
      <circle cx="17" cy="8" r="2.5" />
      <path d="M3 20c.4-4 2.5-6 6-6s5.6 2 6 6M15 14c3.4 0 5.4 1.7 6 5" />
    </>
  ),
};
function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
function FrogMark() {
  return <img className="frog-mark" src="/frog-mark.svg" alt="" aria-hidden="true" />;
}
function Brand() {
  return (
    <header className="brand">
      <a href="/" aria-label="LeapSign, inicio">
        <span className="brand-mark">
          <FrogMark />
        </span>
        <span className="brand-name">LeapSign</span>
      </a>
      <span className="brand-tagline">Firma secuencial de PDF</span>
    </header>
  );
}
function Notice({
  message,
  tone = "info",
}: {
  message: string;
  tone?: "info" | "error" | "success";
}) {
  return message ? (
    <p className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>
      {message}
    </p>
  ) : null;
}
function DocumentArt() {
  return (
    <figure className="document-art">
      <img
        src="/leapsign-secure-flow.png"
        alt="Una rana avanza entre las versiones protegidas de un documento"
      />
    </figure>
  );
}
const passwordRules = (value: string) => [
  { label: "8 caracteres como mínimo", met: value.length >= 8 },
  { label: "Una letra minúscula", met: /[a-z]/.test(value) },
  { label: "Una letra mayúscula", met: /[A-Z]/.test(value) },
  { label: "Al menos un número", met: /\d/.test(value) },
  { label: "Al menos un símbolo", met: /[^\p{L}\p{N}\s]/u.test(value) },
];
const validPassword = (value: string) =>
  passwordRules(value).every((rule) => rule.met);
function PasswordInput({
  value,
  onChange,
  visible,
  onToggle,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  visible: boolean;
  onToggle: () => void;
  autoFocus?: boolean;
}) {
  return (
    <span className="password-field">
      <input
        type={visible ? "text" : "password"}
        autoComplete="new-password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        minLength={8}
        required
        autoFocus={autoFocus}
      />
      <button
        type="button"
        className="password-toggle"
        aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
        aria-pressed={visible}
        onClick={onToggle}
      >
        <Icon name="eye" size={18} />
      </button>
    </span>
  );
}
function PasswordRequirements({ value }: { value: string }) {
  return (
    <ul className="password-rules" aria-label="Requisitos de contraseña">
      {passwordRules(value).map((rule) => (
        <li className={rule.met ? "met" : ""} key={rule.label}>
          <span><Icon name="check" size={12} /></span>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}
function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <span className="footer-mark">
          <FrogMark />
        </span>
        <span>© {new Date().getFullYear()} Pablo Martínez · Libre uso</span>
      </div>
      <nav aria-label="Información legal">
        <a href="/privacidad">Privacidad</a>
        <a href="/seguridad">Seguridad</a>
        <a href="/condiciones">Condiciones de uso</a>
        <a href="mailto:pabloun@gmail.com">Contacto</a>
      </nav>
    </footer>
  );
}
async function functionError(error: any, fallback: string) {
  try {
    const body =
      error?.context && typeof error.context.json === "function"
        ? await error.context.json()
        : null;
    return body?.error || fallback;
  } catch {
    return fallback;
  }
}

const ISSUE_REASONS = [
  "La firma está en un lugar incorrecto",
  "El archivo no corresponde a este proceso",
  "El PDF no se puede abrir o parece corrupto",
  "Otro problema",
] as const;

const LEGAL_CONTENT = {
  privacidad: {
    eyebrow: "Privacidad",
    title: "Tus documentos siguen siendo tuyos.",
    intro:
      "LeapSign utiliza únicamente la información necesaria para gestionar cada proceso. No vende datos, no analiza el contenido con fines publicitarios y no publica los archivos.",
    sections: [
      [
        "Datos necesarios",
        "Se tratan la cuenta del creador, los datos básicos del proceso, el PDF y sus versiones. El nombre y el correo de cada participante se utilizan para gestionar su turno y enviar las notificaciones solicitadas.",
      ],
      [
        "Acceso y protección",
        "Los PDF permanecen en almacenamiento privado. El acceso se autoriza desde el servidor mediante enlaces personales y temporales; las comunicaciones usan HTTPS y el proveedor protege los datos almacenados. Ningún sistema conectado puede garantizar riesgo cero.",
      ],
      [
        "Conservación",
        "Los archivos se mantienen mientras el proceso está activo. Al aceptar una versión final o descartar parte del historial, esas copias dejan de estar disponibles y su eliminación técnica se completa en un máximo de 48 horas. LeapSign no sustituye a un archivo documental permanente.",
      ],
      [
        "Tus derechos",
        "Puedes consultar, descargar y eliminar tus procesos desde tu espacio. Para ejercer derechos de acceso, rectificación, supresión, limitación u oposición, escribe a pabloun@gmail.com.",
      ],
    ],
  },
  seguridad: {
    eyebrow: "Seguridad",
    title: "Acceso limitado a cada paso.",
    intro:
      "Cada participante accede únicamente al documento que necesita y durante el tiempo de su turno. El creador conserva el control del proceso.",
    sections: [
      [
        "Acceso personal",
        "Cada cuenta ve sus propios procesos. Quien firma recibe un enlace personal para acceder exclusivamente a la versión vigente durante su turno.",
      ],
      [
        "Claves protegidas",
        "Las credenciales administrativas permanecen en el servidor y no se incluyen en el navegador ni en los enlaces compartidos.",
      ],
      [
        "Una versión cada vez",
        "Cada entrega parte de la versión vigente. El creador puede detener el proceso, recuperar una versión anterior y confirmar la copia definitiva.",
      ],
      [
        "Qué hace LeapSign",
        "LeapSign organiza turnos y versiones; no identifica legalmente a los firmantes ni certifica las firmas. Esa comprobación corresponde a la herramienta de firma utilizada y, cuando proceda, al asesoramiento profesional adecuado.",
      ],
    ],
  },
  condiciones: {
    eyebrow: "Condiciones de uso",
    title: "Condiciones claras para usar LeapSign.",
    intro:
      "Utiliza documentos que puedas tratar legítimamente, protege los enlaces de acceso y revisa cada versión antes de hacerla avanzar.",
    sections: [
      [
        "Naturaleza del servicio",
        "LeapSign coordina el envío secuencial de archivos PDF. No es una autoridad certificadora, un servicio de identificación, una notaría ni asesoramiento jurídico. Subir un archivo no demuestra por sí solo la identidad de quien firma ni la validez jurídica de la firma.",
      ],
      [
        "Responsabilidad del usuario",
        "El creador debe estar autorizado para tratar el documento y los datos de las personas invitadas. Cada participante debe comprobar el archivo, utilizar una herramienta de firma adecuada y mantener privado su enlace.",
      ],
      [
        "Disponibilidad y conservación",
        "El servicio puede actualizarse, interrumpirse o requerir mantenimiento. Conserva por tu cuenta la versión final: LeapSign no debe ser el único lugar donde guardes un documento importante.",
      ],
      [
        "Autoría, uso y contacto",
        "LeapSign es un proyecto PSMM de libre uso. Los documentos pertenecen siempre a sus respectivos titulares y subirlos no transfiere su propiedad. Contacto: pabloun@gmail.com.",
      ],
    ],
  },
} as const;

function LegalPage({ page }: { page: keyof typeof LEGAL_CONTENT }) {
  const content = LEGAL_CONTENT[page];
  return (
    <main className="legal-page">
      <Brand />
      <article className="legal-shell">
        <a className="back-link" href="/">
          <Icon name="arrow" size={17} /> Volver a LeapSign
        </a>
        <header>
          <span>{content.eyebrow}</span>
          <h1>{content.title}</h1>
          <p>{content.intro}</p>
        </header>
        <div className="legal-grid">
          {content.sections.map(([title, body]) => (
            <section key={title}>
              <h2>{title}</h2>
              <p>{body}</p>
            </section>
          ))}
        </div>
        <aside className="legal-note">
          <Icon name="mail" />
          <div>
            <strong>¿Necesitas aclarar algo?</strong>
            <p>
              Escribe a <a href="mailto:pabloun@gmail.com">pabloun@gmail.com</a>
              . Esta información explica el funcionamiento general del servicio
              y no sustituye asesoramiento jurídico profesional.
            </p>
          </div>
        </aside>
        <p className="legal-updated">
          Última actualización: 15 de octubre de 2026.
        </p>
      </article>
    </main>
  );
}

function RoundAccess({ id }: { id: string }) {
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [issueReason, setIssueReason] = useState("");
  const [issueDetail, setIssueDetail] = useState("");
  const [signedDocument, setSignedDocument] = useState<File | null>(null);
  const [reviewedPrevious, setReviewedPrevious] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [round, setRound] = useState<{ title: string; message: string } | null>(
    null,
  );
  const [turn, setTurn] = useState<{
    state: string;
    position?: number;
    expires_at?: string;
    pdfUrl?: string;
  } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [turnExpired, setTurnExpired] = useState(false);
  const [notice, setNotice] = useState("");
  const [noticeTarget, setNoticeTarget] = useState<
    "access" | "turn" | "submission" | "release" | "issue"
  >("access");
  const [noticeTone, setNoticeTone] = useState<"info" | "error" | "success">(
    "info",
  );
  const [busy, setBusy] = useState(false);
  const query = new URLSearchParams(window.location.search);
  const turnToken = query.get("turn") || "";
  const queueToken = query.get("queue") || "";
  const inviteToken = query.get("invite") || "";
  const [autoOpened, setAutoOpened] = useState(false);
  const [autoRestored, setAutoRestored] = useState(false);
  const sessionId =
    localStorage.getItem("firmador-turn") || crypto.randomUUID();
  localStorage.setItem("firmador-turn", sessionId);
  useEffect(() => {
    if ((!queueToken && !turnToken && !inviteToken) || round || autoOpened) return;
    setAutoOpened(true);
    void loadRound("");
  }, [queueToken, turnToken, inviteToken, round, autoOpened]);
  useEffect(() => {
    if ((!queueToken && !turnToken && !inviteToken) || !round || autoRestored) return;
    setAutoRestored(true);
    void takeTurn();
  }, [queueToken, turnToken, inviteToken, round, autoRestored]);
  useEffect(() => {
    if (turn?.state !== "waiting") return;
    const timer = window.setInterval(() => {
      void takeTurn();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [turn?.state]);
  useEffect(() => {
    if (turn?.state !== "active" || !turn.expires_at) return;
    const update = () => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(turn.expires_at!).getTime() - Date.now()) / 1000),
      );
      setSecondsLeft(remaining);
      if (remaining === 0) setTurnExpired(true);
    };
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [turn?.state, turn?.expires_at]);
  async function openRound(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await loadRound(key);
  }
  async function loadRound(groupKey: string) {
    setBusy(true);
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("get-round", {
      body: { id, groupKey, inviteToken },
    });
    if (error || !data) {
      setNoticeTarget("access");
      setNoticeTone("error");
      setNotice(await functionError(
        error,
        queueToken || turnToken || inviteToken
          ? "Este enlace ya no permite acceder al proceso. Solicita una invitación nueva al creador."
          : "No pudimos abrir este documento. Comprueba la clave.",
      ));
    } else {
      setKey(groupKey);
      setRound(data);
      setNotice("");
    }
    setBusy(false);
  }
  async function takeTurn() {
    if (!name.trim() && !queueToken && !turnToken && !inviteToken) {
      setNoticeTarget("turn");
      setNoticeTone("error");
      return setNotice("Escribe tu nombre para tomar un turno.");
    }
    setBusy(true);
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("take-open-turn", {
      body: {
        id,
        groupKey: key,
        name,
        email,
        sessionId,
        turnToken,
        queueToken,
        inviteToken,
      },
    });
    if (error || !data) {
      setNoticeTarget("turn");
      setNoticeTone("error");
      setNotice(
        await functionError(
          error,
          data?.error ||
            "No pudimos asignarte un turno. Inténtalo de nuevo en unos segundos.",
        ),
      );
    } else {
      setTurnExpired(false);
      setTurn(data);
      if (data.holder_name) setName(data.holder_name);
      if (data.email) setEmail(data.email);
      setNotice("");
    }
    setBusy(false);
  }
  async function release() {
    setBusy(true);
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("release-open-turn", { body: { id, sessionId } });
    if (error || !data?.ok) {
      setNoticeTarget("release");
      setNoticeTone("error");
      setNotice(await functionError(error, "No pudimos liberar el turno. Inténtalo de nuevo."));
    } else {
      setTurn(null);
      setNoticeTarget("turn");
      setNoticeTone("success");
      setNotice(inviteToken
        ? "Turno liberado. Puedes volver a solicitarlo desde esta misma invitación mientras no hayas firmado."
        : "Turno liberado. Puedes volver a solicitarlo cuando lo necesites.");
    }
    setBusy(false);
  }
  async function submitSignedVersion() {
    if (!signedDocument || !reviewedPrevious) {
      setNoticeTarget("submission");
      setNoticeTone("error");
      return setNotice("Confirma la revisión y selecciona el PDF firmado.");
    }
    setBusy(true);
    const form = new FormData();
    form.set("id", id);
    form.set("groupKey", key);
    form.set("sessionId", sessionId);
    form.set("reviewedPrevious", "true");
    form.set("document", signedDocument);
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("submit-signed-version", {
      body: form,
    });
    if (error || !data) {
      setNoticeTarget("submission");
      setNoticeTone("error");
      setNotice(
        await functionError(
          error,
          data?.error || "No pudimos incorporar el PDF firmado.",
        ),
      );
    } else {
      setTurn(null);
      setSubmitted(true);
      setNotice("");
    }
    setBusy(false);
  }
  async function reportIssue() {
    if (!ISSUE_REASONS.includes(issueReason as (typeof ISSUE_REASONS)[number])) {
      setNoticeTarget("issue");
      setNoticeTone("error");
      return setNotice("Elige el motivo de la incidencia.");
    }
    if (issueReason === "Otro problema" && issueDetail.trim().length > 500) {
      setNoticeTarget("issue");
      setNoticeTone("error");
      return setNotice("La observación puede tener hasta 500 caracteres.");
    }
    setBusy(true);
    const s = await getSupabase();
    const { error } = await s.functions.invoke("report-open-error", {
      body: {
        id,
        groupKey: key,
        sessionId,
        reason: issueReason,
        detail: issueDetail,
        reporterName: name,
        reporterEmail: email,
        inviteToken,
      },
    });
    if (error) {
      setNoticeTarget("issue");
      setNoticeTone("error");
      setNotice(
        await functionError(error, "No pudimos registrar la incidencia."),
      );
    } else {
      setTurn(null);
      setRound(null);
      setNotice(
        "El proceso se detuvo para que el creador revise la incidencia.",
      );
    }
    setBusy(false);
  }
  if (!round)
    return (
      <main className="round">
        <Brand />
        <section className="round-card">
          <span className="file-chip">
            <Icon name="file" size={14} /> Documento privado
          </span>
          <h1>Abre el documento</h1>
          <p className="round-lead">
            Introduce la clave que te facilitó el creador. Si tu enlace es
            personal, podrás continuar directamente.
          </p>
          <form onSubmit={openRound}>
            <label>
              Clave de acceso <em>Solo si te la solicitaron</em>
              <input
                type="password"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                autoFocus
              />
            </label>
            <button className="primary wide" disabled={busy}>
              {busy ? "Abriendo…" : "Abrir documento"}
            </button>
            <Notice message={notice} tone={noticeTone} />
          </form>
        </section>
      </main>
    );
  if (submitted)
    return (
      <main className="round">
        <Brand />
        <section className="round-card">
          <span className="file-chip success">
            <Icon name="check" size={14} /> Incorporado
          </span>
          <h1>Tu firma ya forma parte del documento</h1>
          <p>
            El PDF firmado se guardó correctamente. El proceso continuará con
            la siguiente persona.
          </p>
        </section>
      </main>
    );
  if (turn?.state === "active" && turnExpired)
    return (
      <main className="round">
        <Brand />
        <section className="round-card expired-card">
          <span className="file-chip warning">
            <Icon name="clock" size={14} /> Turno vencido
          </span>
          <h1>Se terminó tu tiempo</h1>
          <p>
            Para respetar a las demás personas, tu turno se liberó. Puedes
            volver a solicitar un intento y entrarás al final de la cola.
          </p>
          <button className="primary wide" onClick={takeTurn} disabled={busy}>
            {busy ? "Solicitando…" : "Solicitar un nuevo intento"}
          </button>
          <Notice message={notice} tone={noticeTone} />
        </section>
      </main>
    );
  if (turn?.state === "active")
    return (
      <main className="round">
        <Brand />
        <section className="round-card">
          <span className="file-chip success">
            <Icon name="clock" size={14} /> Tu turno
          </span>
          <p className="round-context">Documento</p>
          <h1>{round.title}</h1>
          <div className="turn-timer">
            <small>Tiempo disponible para completar tu turno</small>
            <strong>
              {String(Math.floor(secondsLeft / 60)).padStart(2, "0")}:
              {String(secondsLeft % 60).padStart(2, "0")}
            </strong>
            <span>El turno vence si no finalizas dentro de este tiempo.</span>
          </div>
          <div className="signing-step">
            <div className="task-heading">
              <span className="eyebrow">Tu tarea</span>
              <h2>Firma el documento en tres pasos</h2>
              <p>Descarga el PDF, fírmalo fuera de LeapSign y súbelo de nuevo.</p>
            </div>
            <ol className="signer-tasks">
              <li className="signer-task">
                <span className="task-number">1</span>
                <div className="task-content">
                  <span className="task-icon">
                  <Icon name="download" />
                  </span>
                  <div className="task-copy">
                    <h3>Descarga el documento</h3>
                    <p>Guarda la versión vigente en tu dispositivo.</p>
                  </div>
                  <a
                    className="primary task-action"
                    href={turn.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    download
                  >
                    <Icon name="download" size={18} /> Descargar PDF
                  </a>
                </div>
              </li>
              <li className="signer-task">
                <span className="task-number">2</span>
                <div className="task-content">
                  <span className="task-icon frog-task-icon"><FrogMark /></span>
                  <div className="task-copy">
                    <h3>Firma el PDF</h3>
                    <p>
                      Ábrelo en FirmaEC, Adobe Acrobat u otra herramienta de
                      firma. Conserva el archivo en formato PDF.
                    </p>
                  </div>
                </div>
              </li>
              <li className="signer-task active-task">
                <span className="task-number">3</span>
                <div className="task-content">
                  <span className="task-icon"><Icon name="upload" /></span>
                  <div className="task-copy">
                    <h3>Sube el PDF firmado</h3>
                    <p>Vuelve a LeapSign y selecciona el archivo que acabas de firmar.</p>
                  </div>
                  <label className={`upload ${signedDocument ? "has-file" : ""}`}>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => setSignedDocument(e.target.files?.[0] ?? null)}
                    />
                    <span className="upload-icon">
                      <Icon name="upload" />
                    </span>
                    <span>
                      <strong>
                        {signedDocument
                          ? signedDocument.name
                          : "Seleccionar PDF firmado"}
                      </strong>
                      <small>
                        {signedDocument
                          ? `${Math.ceil(signedDocument.size / 1024)} KB`
                          : "PDF · máximo 10 MB"}
                      </small>
                    </span>
                  </label>
                  <label className="review-check">
                    <input
                      type="checkbox"
                      checked={reviewedPrevious}
                      onChange={(e) => setReviewedPrevious(e.target.checked)}
                    />
                    <span>
                      <strong>He revisado el documento</strong>
                      <small>Confirmo que firmé la copia correcta antes de enviarla.</small>
                    </span>
                  </label>
                  <button
                    className="primary wide"
                    onClick={submitSignedVersion}
                    disabled={busy}
                  >
                    {busy ? "Subiendo PDF…" : "Subir PDF firmado y completar mi turno"}
                  </button>
                  {noticeTarget === "submission" && (
                    <Notice message={notice} tone={noticeTone} />
                  )}
                </div>
              </li>
            </ol>
          </div>
          <button className="text-button release-turn" onClick={release} disabled={busy}>
            {busy ? "Liberando…" : "Liberar turno sin firmar"}
          </button>
          {noticeTarget === "release" && (
            <Notice message={notice} tone={noticeTone} />
          )}
          <aside className="scope-note">
            <Icon name="shield" size={18} />
            <p>
              LeapSign mantiene el orden de las versiones. La identidad y la
              validez de la firma deben comprobarse con la herramienta de firma
              correspondiente.
            </p>
          </aside>
          <details className="issue-disclosure">
            <summary>¿Hay un problema con el documento?</summary>
            <fieldset className="issue-box">
            <legend>Informar una incidencia <em>Detendrá el proceso</em></legend>
            <label>
              Motivo
              <select
                value={issueReason}
                onChange={(e) => setIssueReason(e.target.value)}
              >
                <option value="">Selecciona una opción</option>
                {ISSUE_REASONS.map((reason) => (
                  <option key={reason} value={reason}>
                    {reason}
                  </option>
                ))}
              </select>
            </label>
            {issueReason === "Otro problema" && (
              <label>
                Observación <em>Opcional</em>
                <textarea
                  value={issueDetail}
                  maxLength={500}
                  placeholder="Añade un detalle breve que ayude al creador."
                  onChange={(e) => setIssueDetail(e.target.value)}
                />
              </label>
            )}
            <button
              className="text-button danger"
              onClick={reportIssue}
              disabled={busy}
            >
              Detener e informar
            </button>
            {noticeTarget === "issue" && (
              <Notice message={notice} tone={noticeTone} />
            )}
            </fieldset>
          </details>
          {noticeTarget !== "submission" && noticeTarget !== "release" && noticeTarget !== "issue" && (
            <Notice message={notice} tone={noticeTone} />
          )}
        </section>
      </main>
    );
  return (
    <main className="round">
      <Brand />
      <section className="round-card">
        <span className="file-chip">
          <Icon name="file" size={14} /> Documento privado
        </span>
        <h1>{round.title}</h1>
        {round.message && <p>{round.message}</p>}
        <div className="round-instruction">
          <strong>Solicita tu turno</strong>
          <span>Cuando te corresponda, podrás descargar el PDF y subirlo firmado.</span>
        </div>
        <label>
          Tu nombre
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Como quieres aparecer"
          />
        </label>
        <label>
          Correo <em>Opcional</em>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Te avisaremos cuando sea tu turno"
          />
        </label>
        {turn?.state === "waiting" && (
          <p className="queue">
            <strong>Estás en la cola · posición {turn.position}</strong>
            <span>Esta página comprueba tu turno automáticamente. Si indicaste tu correo, también recibirás un aviso.</span>
          </p>
        )}
        <button className="primary wide" onClick={takeTurn} disabled={busy}>
          {turn?.state === "waiting"
            ? "Comprobar si ya es mi turno"
            : busy ? "Solicitando turno…" : "Solicitar turno para firmar"}
        </button>
        <Notice message={notice} tone={noticeTone} />
      </section>
    </main>
  );
}

type OwnerRound = {
  id: string;
  title: string;
  status: string;
  created_at: string;
  signature_count: number;
};
type Contact = { id: string; email: string; display_name?: string | null };
type InviteDraft = {
  id: string;
  email: string;
  name: string;
  saveContact: boolean;
};
const emptyInvite = (): InviteDraft => ({
  id: crypto.randomUUID(),
  email: "",
  name: "",
  saveContact: false,
});
function InvitationComposer({ workflowId, contacts = [], onSent }: { workflowId: string; contacts?: Contact[]; onSent?: () => void }) {
  const [drafts, setDrafts] = useState<InviteDraft[]>([emptyInvite()]);
  const [savedContacts, setSavedContacts] = useState<Contact[]>(contacts);
  const [chosen, setChosen] = useState<string[]>([]);
  const [contactSort, setContactSort] = useState<"name" | "email">("name");
  const [contactPage, setContactPage] = useState(0);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"error" | "success">("success");
  const [busy, setBusy] = useState(false);
  async function loadContacts() {
    const s = await getSupabase();
    const { data } = await s.from("owner_contacts").select("id,email,display_name").order("last_used_at", { ascending: false }).limit(100);
    if (data) setSavedContacts(data as Contact[]);
  }
  useEffect(() => {
    void loadContacts();
  }, []);
  useEffect(() => {
    if (contacts.length) setSavedContacts(contacts);
  }, [contacts]);
  function updateDraft(id: string, patch: Partial<InviteDraft>) {
    setDrafts((current) => current.map((draft) => draft.id === id ? { ...draft, ...patch } : draft));
  }
  function startEditing(contact: Contact) {
    setEditingContact(contact.id);
    setEditName(contact.display_name || "");
    setEditEmail(contact.email);
    setMessage("");
  }
  async function saveContact(contactId: string) {
    const normalizedEmail = editEmail.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setMessageTone("error");
      return setMessage("Escribe un correo válido para guardar el contacto.");
    }
    setBusy(true);
    const s = await getSupabase();
    const { error } = await (s as any).from("owner_contacts").update({
      email: normalizedEmail,
      display_name: editName.trim() || null,
    }).eq("id", contactId);
    if (error) {
      setMessageTone("error");
      setMessage(error.code === "23505"
        ? "Ya existe un contacto con ese correo."
        : "No pudimos guardar los cambios del contacto.");
    } else {
      setEditingContact(null);
      setMessageTone("success");
      setMessage("Contacto actualizado.");
      await loadContacts();
    }
    setBusy(false);
  }
  async function deleteContact(contact: Contact) {
    if (!window.confirm(`¿Eliminar ${contact.display_name || contact.email} de tus contactos frecuentes?`)) return;
    setBusy(true);
    const s = await getSupabase();
    const { error } = await (s as any).from("owner_contacts").delete().eq("id", contact.id);
    if (error) {
      setMessageTone("error");
      setMessage("No pudimos eliminar el contacto.");
    } else {
      setChosen((current) => current.filter((id) => id !== contact.id));
      if (editingContact === contact.id) setEditingContact(null);
      setMessageTone("success");
      setMessage("Contacto eliminado.");
      await loadContacts();
    }
    setBusy(false);
  }
  async function send(recipients: { email: string; name?: string; saveContact?: boolean }[], source: "drafts" | "contacts") {
    if (!recipients.length) return;
    if (recipients.some((recipient) => !/^\S+@\S+\.\S+$/.test(recipient.email.trim()))) {
      setMessageTone("error");
      setMessage("Revisa los correos: hay una dirección incompleta o no válida.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const s = await getSupabase();
      const { data, error } = await s.functions.invoke("send-round-invitations", { body: { id: workflowId, recipients } });
      if (error || !data) {
        setMessageTone("error");
        setMessage(await functionError(error, "No pudimos enviar las invitaciones. Revisa los correos e inténtalo de nuevo."));
        return;
      }
      const parts = [];
      if (data.sent) parts.push(`${data.sent} invitación${data.sent === 1 ? " enviada" : "es enviadas"}`);
      if (data.skipped) parts.push(`${data.skipped} destinatario${data.skipped === 1 ? " ya estaba" : "s ya estaban"} en la cola`);
      if (data.completed) parts.push(`${data.completed} contacto${data.completed === 1 ? " ya completó" : "s ya completaron"} su firma`);
      if (data.failed?.length) parts.push(`${data.failed.length} envío${data.failed.length === 1 ? " falló" : "s fallaron"}`);
      setMessageTone(!data.failed?.length && (data.sent || data.skipped || data.completed) ? "success" : "error");
      setMessage(`${parts.join(" · ")}.`);
      if (data.sent) {
        if (source === "drafts") setDrafts([emptyInvite()]);
        else setChosen([]);
        await loadContacts();
        onSent?.();
      }
    } finally {
      setBusy(false);
    }
  }
  const pending = drafts.filter((draft) => draft.email.trim());
  const sortedContacts = [...savedContacts].sort((a, b) => {
    const first = contactSort === "name" ? (a.display_name || a.email) : a.email;
    const second = contactSort === "name" ? (b.display_name || b.email) : b.email;
    return first.localeCompare(second, "es", { sensitivity: "base" });
  });
  const contactPageCount = Math.max(1, Math.ceil(sortedContacts.length / 10));
  const visibleContacts = sortedContacts.slice(contactPage * 10, contactPage * 10 + 10);
  useEffect(() => {
    if (contactPage >= contactPageCount) setContactPage(contactPageCount - 1);
  }, [contactPage, contactPageCount]);
  return (
    <div className="invitation-composer">
      <h4>Invitar por correo</h4>
      <p>Añade las personas que deben firmar. Cada una recibirá un enlace personal para entrar en la cola.</p>
      <div className="invite-list">
        {drafts.map((draft, index) => (
          <div className="invite-person" key={draft.id}>
            <div className="invite-person-head">
              <strong>Persona {index + 1}</strong>
              {drafts.length > 1 && <button type="button" className="text-button danger" onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}>Quitar</button>}
            </div>
            <div className="invite-fields">
              <label>Correo<input type="email" value={draft.email} onChange={(event) => updateDraft(draft.id, { email: event.target.value })} placeholder="persona@ejemplo.com" /></label>
              <label>Nombre <em>Opcional</em><input value={draft.name} maxLength={120} onChange={(event) => updateDraft(draft.id, { name: event.target.value })} placeholder="Nombre para la invitación" /></label>
            </div>
            <label className="save-contact"><input type="checkbox" checked={draft.saveContact} onChange={(event) => updateDraft(draft.id, { saveContact: event.target.checked })} /> Guardar en contactos frecuentes</label>
          </div>
        ))}
      </div>
      <div className="invite-actions">
        <button type="button" className="signout" disabled={busy || drafts.length >= 25} onClick={() => setDrafts((current) => [...current, emptyInvite()])}>+ Añadir otra persona</button>
        <button type="button" className="primary" disabled={busy || !pending.length} onClick={() => send(pending, "drafts")}><Icon name="mail" size={16} /> {busy ? "Enviando…" : pending.length === 1 ? "Enviar 1 invitación" : `Enviar ${pending.length} invitaciones`}</button>
      </div>
      {savedContacts.length > 0 && <details className="contact-picker">
        <summary><span>Elegir contactos frecuentes</span><small>{chosen.length ? `${chosen.length} seleccionado${chosen.length === 1 ? "" : "s"}` : `${savedContacts.length} guardado${savedContacts.length === 1 ? "" : "s"}`}</small><Icon name="chevron" size={17} /></summary>
        <div className="contact-sort">
          <label>Ordenar por<select value={contactSort} onChange={(event) => { setContactSort(event.target.value as "name" | "email"); setContactPage(0); }}><option value="name">Nombre</option><option value="email">Correo</option></select></label>
          <span>{sortedContacts.length} contacto{sortedContacts.length === 1 ? "" : "s"}</span>
        </div>
        <div className="contact-options">{visibleContacts.map((contact) => <div className="contact-row" key={contact.id}>
          {editingContact === contact.id ? <div className="contact-edit">
            <label>Nombre<input value={editName} maxLength={120} onChange={(event) => setEditName(event.target.value)} /></label>
            <label>Correo<input type="email" value={editEmail} onChange={(event) => setEditEmail(event.target.value)} /></label>
            <div><button type="button" className="text-button" disabled={busy} onClick={() => saveContact(contact.id)}>Guardar</button><button type="button" className="text-button" onClick={() => setEditingContact(null)}>Cancelar</button></div>
          </div> : <>
            <label><input type="checkbox" checked={chosen.includes(contact.id)} onChange={() => setChosen((current) => current.includes(contact.id) ? current.filter((id) => id !== contact.id) : [...current, contact.id])} /><span>{contact.display_name || contact.email}<small>{contact.display_name ? contact.email : ""}</small></span></label>
            <div className="contact-row-actions"><button type="button" aria-label={`Editar ${contact.display_name || contact.email}`} title="Editar contacto" onClick={() => startEditing(contact)}><Icon name="edit" size={16} /></button><button type="button" className="danger" aria-label={`Eliminar ${contact.display_name || contact.email}`} title="Eliminar contacto" onClick={() => deleteContact(contact)}><Icon name="trash" size={16} /></button></div>
          </>}
        </div>)}</div>
        {contactPageCount > 1 && <div className="contact-pagination"><button type="button" className="text-button" disabled={contactPage === 0} onClick={() => setContactPage((page) => page - 1)}>Anterior</button><span>Página {contactPage + 1} de {contactPageCount}</span><button type="button" className="text-button" disabled={contactPage + 1 >= contactPageCount} onClick={() => setContactPage((page) => page + 1)}>Siguiente</button></div>}
        <button type="button" className="primary selected-send" disabled={busy || !chosen.length} onClick={() => send(savedContacts.filter((contact) => chosen.includes(contact.id)).map((contact) => ({ email: contact.email, name: contact.display_name || "", saveContact: true })), "contacts")}><Icon name="mail" size={16} /> {busy ? "Enviando…" : `Enviar a ${chosen.length} marcado${chosen.length === 1 ? "" : "s"}`}</button>
      </details>}
      {message && <Notice message={message} tone={messageTone} />}
    </div>
  );
}
function OwnerPanel() {
  const [rounds, setRounds] = useState<OwnerRound[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [notice, setNotice] = useState("");
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  async function loadRounds() {
    const s = await getSupabase();
    const { data, error } = await s
      .from("workflows")
      .select("id,title,status,created_at,signature_count")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) setNotice("No pudimos cargar tus rondas.");
    else setRounds((data ?? []) as OwnerRound[]);
  }
  async function openRound(id: string) {
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("get-owner-round", {
      body: { id },
    });
    if (error || !data)
      setNotice("No pudimos cargar el seguimiento de la ronda.");
    else {
      setSelected(data);
      setFinalConfirmed(false);
      setNotice("");
    }
  }
  async function manageRound(
    action:
      | "pause"
      | "resume"
      | "release_turn"
      | "skip_next"
      | "rollback"
      | "finalize"
      | "purge",
    versionId?: string,
    workflowId?: string,
  ) {
    const roundId = workflowId ?? selected?.workflow.id;
    if (!roundId) return;
    if (action === "finalize" && !finalConfirmed) {
      setNotice(
        "Revisa la versión descargada y marca la confirmación antes de aceptarla como final.",
      );
      return;
    }
    const irreversible = action === "rollback" || action === "finalize";
    const warning =
      action === "purge"
        ? "Eliminarás permanentemente este proceso, sus versiones y sus archivos privados. Esta acción no se puede deshacer. ¿Continuar?"
        : action === "rollback"
          ? "Volverás a esta versión. Las posteriores se eliminarán y se liberará el turno activo. ¿Continuar?"
          : action === "finalize"
            ? "Aceptarás esta versión como final. Las anteriores se eliminarán y el proceso se cerrará. Esta acción no se puede deshacer. ¿Continuar?"
            : "";
    if ((action === "purge" || irreversible) && !window.confirm(warning))
      return;
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("owner-round-action", {
      body: {
        id: roundId,
        action,
        versionId,
        confirmPurge: action === "purge",
        confirmIrreversible: irreversible,
      },
    });
    if (error || !data?.ok)
      setNotice(data?.error || "No pudimos aplicar ese cambio.");
    else if (action === "purge") {
      if (selected?.workflow.id === roundId) setSelected(null);
      setNotice("Proceso eliminado y archivos purgados.");
      await loadRounds();
    } else {
      setNotice(
        action === "release_turn"
          ? "Turno liberado; se avisará a la siguiente persona."
          : action === "skip_next"
            ? "La primera persona en espera fue retirada de la cola."
            : action === "pause"
              ? "Proceso detenido."
              : action === "resume"
                ? "Proceso reanudado."
                : action === "rollback"
                  ? "Se recuperó la versión seleccionada y el proceso continúa desde ella."
                  : action === "finalize"
                    ? "La versión final fue aceptada; el proceso quedó cerrado."
                    : "Cambio aplicado.",
      );
      await openRound(roundId);
      await loadRounds();
    }
  }
  async function downloadVersion(versionId?: string) {
    if (!selected) return;
    const s = await getSupabase();
    const { data, error } = await s.functions.invoke("owner-download-version", {
      body: { id: selected.workflow.id, versionId },
    });
    if (error || !data?.url) setNotice("No pudimos preparar la descarga.");
    else window.open(data.url, "_blank", "noopener");
  }
  const statusText = (status: string) =>
    status === "active"
      ? "En curso"
      : status === "paused_error"
        ? "Detenido por incidencia"
        : status === "completed"
          ? "Finalizado"
          : status === "cancelled"
            ? "Cancelado"
            : status;
  const currentVersion = selected?.versions.find(
    (version: any) => version.id === selected.workflow.current_version_id,
  );
  const previousVersions = selected?.versions.filter(
    (version: any) => version.id !== selected.workflow.current_version_id,
  ) ?? [];
  useEffect(() => {
    void loadRounds();
  }, []);
  return (
    <section className="owner-panel">
      <div className="owner-panel-head">
        <div>
          <span className="section-kicker">Actividad</span>
          <h2>Mis documentos</h2>
          <p>Consulta el estado de cada proceso y gestiona sus firmas.</p>
        </div>
        <button className="signout" onClick={loadRounds}>
          <Icon name="refresh" size={16} /> Actualizar
        </button>
      </div>
      {rounds.length === 0 ? (
        <p className="empty-state">Todavía no has creado ningún proceso.</p>
      ) : (
        <div className="owner-list">
          {rounds.map((round) => (
            <div key={round.id} className="owner-round">
              <button
                className="owner-round-open"
                onClick={() => openRound(round.id)}
              >
                <span>
                  <strong>{round.title}</strong>
                  <small>
                    Creado el {new Date(round.created_at).toLocaleDateString()}
                  </small>
                </span>
                <span className="round-list-meta">
                  <span className={`status-badge status-${round.status}`}>{statusText(round.status)}</span>
                  <small>{round.signature_count} {round.signature_count === 1 ? "firma" : "firmas"}</small>
                  <strong className="open-label">Gestionar <Icon name="arrow" size={14} /></strong>
                </span>
              </button>
              <button
                className="trash-button"
                aria-label={`Eliminar ${round.title}`}
                title="Eliminar proceso"
                onClick={() => manageRound("purge", undefined, round.id)}
              >
                <Icon name="trash" size={18} />
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <div className="owner-detail">
          <div className="owner-detail-top">
            <div>
              <span className={`status-badge status-${selected.workflow.status}`}>{statusText(selected.workflow.status)}</span>
              <h3>{selected.workflow.title}</h3>
              <p>{selected.workflow.signature_count} {selected.workflow.signature_count === 1 ? "firma incorporada" : "firmas incorporadas"}</p>
            </div>
            <div className="owner-actions">
              {selected.workflow.status === "active" ? (
                <button
                  className="signout"
                  onClick={() => manageRound("pause")}
                >
                  Detener proceso
                </button>
              ) : selected.workflow.status === "paused_error" ? (
                <button
                  className="signout"
                  onClick={() => manageRound("resume")}
                >
                  Reanudar proceso
                </button>
              ) : null}
              {selected.activeTurn && (
                <button
                  className="signout"
                  onClick={() => manageRound("release_turn")}
                >
                  Liberar turno actual
                </button>
              )}
              {selected.queue.length > 0 && (
                <button
                  className="signout"
                  onClick={() => manageRound("skip_next")}
                >
                  Retirar primera espera
                </button>
              )}
              <button className="signout" onClick={() => downloadVersion()}>
                <Icon name="download" size={16} /> Descargar PDF actual
              </button>
              <button
                className="danger-button"
                onClick={() => manageRound("purge")}
              >
                <Icon name="trash" size={16} /> Eliminar proceso
              </button>
            </div>
          </div>
          <dl>
            <div>
              <dt>Versión vigente</dt>
              <dd>
                Versión{" "}
                {currentVersion?.sequence ?? 0}
              </dd>
            </div>
            <div>
              <dt>Turno actual</dt>
              <dd>
                {selected.activeTurn
                  ? `${selected.activeTurn.holder_name}${selected.activeTurn.holder_email ? ` · ${selected.activeTurn.holder_email}` : ""} · hasta ${new Date(selected.activeTurn.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Sin turno activo · disponible"}
              </dd>
            </div>
            <div>
              <dt>Personas en espera</dt>
              <dd>
                {selected.queue.length
                  ? `${selected.queue.length} en la cola`
                  : "Sin personas esperando"}
              </dd>
            </div>
          </dl>
          <section className="signature-queue" aria-labelledby="queue-title">
            <div className="subsection-heading">
              <div>
                <span className="section-kicker">Orden de acceso</span>
                <h4 id="queue-title">Cola de firmas</h4>
              </div>
              <span>{selected.workflow.signature_count} completada{selected.workflow.signature_count === 1 ? "" : "s"}</span>
            </div>
            <ol>
              {selected.activeTurn ? (
                <li className="queue-current">
                  <span className="queue-marker"><Icon name="clock" size={16} /></span>
                  <span><strong>{selected.activeTurn.holder_name}</strong><small>Firmando ahora{selected.activeTurn.holder_email ? ` · ${selected.activeTurn.holder_email}` : ""}</small></span>
                  <span className="queue-state">Turno actual</span>
                </li>
              ) : (
                <li className="queue-available">
                  <span className="queue-marker"><Icon name="check" size={16} /></span>
                  <span><strong>Documento disponible</strong><small>No hay un turno activo en este momento.</small></span>
                </li>
              )}
              {selected.queue.map((item: any, index: number) => (
                <li key={item.id || `${item.holder_name}-${index}`}>
                  <span className="queue-marker">{index + 1}</span>
                  <span><strong>{item.holder_name}</strong><small>{item.email || "En espera"}</small></span>
                  <span className="queue-state">En espera</span>
                </li>
              ))}
            </ol>
          </section>
          {selected.workflow.status === "active" && <section className="share-round">
            <div className="subsection-heading">
              <div>
                <span className="section-kicker">Participantes</span>
                <h4>Compartir e invitar firmantes</h4>
                <p>Comparte el acceso general o envía invitaciones personales por correo.</p>
              </div>
            </div>
            <div className="share-url"><input readOnly value={`${window.location.origin}/r/${selected.workflow.id}`} aria-label="Enlace para solicitar un turno de firma" /><button className="signout" onClick={() => navigator.clipboard.writeText(`${window.location.origin}/r/${selected.workflow.id}`).then(() => setNotice("Enlace copiado.")).catch(() => setNotice("No se pudo copiar el enlace."))}>Copiar enlace</button></div>
            <p className="share-help">El enlace estará disponible mientras el proceso siga en curso.</p>
            <InvitationComposer workflowId={selected.workflow.id} contacts={selected.contacts ?? []} onSent={() => { void openRound(selected.workflow.id); }} />
          </section>}
          <section className="version-section" aria-labelledby="current-version-title">
            <div className="subsection-heading">
              <div>
                <span className="section-kicker">Archivo vigente</span>
                <h4 id="current-version-title">Versión actual</h4>
              </div>
              <button className="signout" onClick={() => downloadVersion(currentVersion?.id)}><Icon name="download" size={16} /> Descargar PDF actual</button>
            </div>
            {currentVersion && <article className="current-version-card">
              <div className="version-summary">
                <strong>
                  Versión {currentVersion.sequence}
                </strong>
                <span>
                  {Math.ceil(currentVersion.byte_size / 1024)} KB · {new Date(currentVersion.created_at).toLocaleString()}
                </span>
                <span className="version-author">
                  Cargada por <strong>{currentVersion.submitted_by_name || (currentVersion.sequence === 0 ? "Creador del proceso" : "Participante")}</strong>
                  {currentVersion.submitted_by_email ? ` · ${currentVersion.submitted_by_email}` : ""}
                </span>
              </div>
              {selected.workflow.status !== "completed" && (
                <div className="final-approval">
                  <div className="final-approval-title">
                    <span><Icon name="check" size={17} /></span>
                    <div>
                      <strong>Cerrar el proceso con esta versión</strong>
                      <p>Descarga y revisa el PDF antes de aceptarlo. Después no podrán añadirse más firmas.</p>
                    </div>
                  </div>
                  <label className="final-confirm">
                    <input
                      type="checkbox"
                      checked={finalConfirmed}
                      onChange={(event) => setFinalConfirmed(event.target.checked)}
                    />
                    <span><strong>He revisado el PDF</strong><small>Confirmo que esta será la versión final del documento.</small></span>
                  </label>
                  <button
                    className="primary final-button"
                    disabled={!finalConfirmed}
                    onClick={() => manageRound("finalize", currentVersion.id)}
                  >
                    Aceptar versión final y cerrar el proceso
                  </button>
                </div>
              )}
            </article>}
            <aside className="retention-note">
              <Icon name="clock" size={18} />
              <div>
                <strong>Conservación y plazos</strong>
                <p>Los turnos duran 10 minutos y las invitaciones privadas caducan a los 30 días o al completar la firma. Las copias descartadas dejan de estar disponibles de inmediato y su eliminación técnica se completa en un máximo de 48 horas.</p>
              </div>
            </aside>
            {previousVersions.length > 0 && <details className="history-disclosure">
              <summary>Versiones anteriores <span>{previousVersions.length}</span><Icon name="chevron" size={17} /></summary>
              <ul className="submission-list">
                {previousVersions.map((version: any) => (
                  <li key={version.id}>
                    <strong>Versión {version.sequence}</strong>
                    <span>{Math.ceil(version.byte_size / 1024)} KB · {new Date(version.created_at).toLocaleString()}</span>
                    <span className="version-author">Cargada por <strong>{version.submitted_by_name || (version.sequence === 0 ? "Creador del proceso" : "Participante")}</strong>{version.submitted_by_email ? ` · ${version.submitted_by_email}` : ""}</span>
                    <div className="version-actions">
                      <button className="text-button" onClick={() => downloadVersion(version.id)}>Descargar esta versión</button>
                      <button className="text-button" onClick={() => manageRound("rollback", version.id)}>Recuperar esta versión</button>
                    </div>
                  </li>
                ))}
              </ul>
            </details>}
          </section>
          {selected.reports.length > 0 && (
            <>
              <h4>Incidencias</h4>
              <ul className="submission-list">
                {selected.reports.map((report: any) => (
                  <li key={report.id}>
                    <strong>{report.reason || "Incidencia"}</strong>
                    <span>{report.detail || "No disponible"}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      <Notice message={notice} />
    </section>
  );
}

function App() {
  const legalPage = window.location.pathname.slice(
    1,
  ) as keyof typeof LEGAL_CONTENT;
  if (legalPage in LEGAL_CONTENT) return <LegalPage page={legalPage} />;
  const match = window.location.pathname.match(/^\/r\/([0-9a-f-]{36})$/i);
  if (match) return <RoundAccess id={match[1]} />;
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registering, setRegistering] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [recovering, setRecovering] = useState(
    window.location.hash.includes("type=recovery"),
  );
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [key, setKey] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [notice, setNotice] = useState("");
  const [createdLink, setCreatedLink] = useState("");
  const [createdRoundId, setCreatedRoundId] = useState("");
  const [busy, setBusy] = useState(false);
  const [authNoticeTone, setAuthNoticeTone] = useState<"info" | "error" | "success">("info");
  useEffect(() => {
    let unsubscribe = () => {};
    getSupabase()
      .then((supabase) => {
        supabase.auth.getSession().then(({ data }) => setSession(data.session));
        const { data } = supabase.auth.onAuthStateChange((event, next) => {
          setSession(next);
          if (event === "PASSWORD_RECOVERY") setRecovering(true);
        });
        unsubscribe = () => data.subscription.unsubscribe();
      })
      .catch(() =>
        setNotice(
          "No pudimos abrir tu espacio. Recarga la página e inténtalo de nuevo.",
        ),
      );
    return () => unsubscribe();
  }, []);
  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      const detail = error.message.toLowerCase();
      setAuthNoticeTone("error");
      setNotice(
        detail.includes("email not confirmed")
          ? "Confirma tu correo antes de iniciar sesión. Revisa también la carpeta de spam."
          : detail.includes("invalid login") || detail.includes("invalid credentials")
            ? "El correo o la contraseña no son correctos."
            : detail.includes("rate")
              ? "Has realizado demasiados intentos. Espera unos minutos y vuelve a probar."
              : "No pudimos iniciar sesión en este momento. Inténtalo de nuevo.",
      );
    }
    setBusy(false);
  }
  async function signUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    setAuthNoticeTone("error");
    if (!firstName.trim() || !lastName.trim())
      return setNotice("Escribe tu nombre y apellidos.");
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail))
      return setNotice("Escribe un correo válido.");
    if (!validPassword(password))
      return setNotice("Completa todos los requisitos de la contraseña.");
    if (password !== confirmPassword)
      return setNotice("Las dos contraseñas no coinciden.");
    setBusy(true);
    setNotice("");
    const supabase = await getSupabase();
    const { error } = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          full_name: `${firstName.trim()} ${lastName.trim()}`,
        },
      },
    });
    if (error) {
      const detail = error.message.toLowerCase();
      setAuthNoticeTone("error");
      setNotice(
        detail.includes("password")
          ? "La contraseña no cumple los requisitos indicados."
          : detail.includes("rate") || detail.includes("limit")
            ? "Se han realizado demasiados intentos. Espera unos minutos antes de volver a probar."
            : detail.includes("email")
              ? "No pudimos usar ese correo. Comprueba que esté bien escrito."
              : "No pudimos crear la cuenta en este momento. Inténtalo de nuevo.",
      );
    } else {
      setAuthNoticeTone("success");
      setNotice("Revisa tu correo para confirmar el registro. Si ya tenías una cuenta, inicia sesión o recupera la contraseña.");
      setRegistering(false);
      setConfirmPassword("");
    }
    setBusy(false);
  }
  async function requestRecovery() {
    setAuthNoticeTone("error");
    if (!/^\S+@\S+\.\S+$/.test(email.trim()))
      return setNotice(
        "Escribe un correo válido para recuperar la contraseña.",
      );
    setBusy(true);
    setNotice("");
    const supabase = await getSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      setAuthNoticeTone("error");
      setNotice(error.message.toLowerCase().includes("rate") ? "Has solicitado demasiados enlaces. Espera unos minutos y vuelve a intentarlo." : "No pudimos procesar la solicitud. Inténtalo de nuevo.");
    } else {
      setAuthNoticeTone("success");
      setNotice("Si existe una cuenta con ese correo, recibirás un enlace para crear una contraseña nueva.");
    }
    setBusy(false);
  }
  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthNoticeTone("error");
    if (!validPassword(password))
      return setNotice("Completa todos los requisitos de la contraseña.");
    if (password !== confirmPassword)
      return setNotice("Las dos contraseñas no coinciden.");
    setBusy(true);
    const supabase = await getSupabase();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setAuthNoticeTone("error");
      setNotice(
        "No pudimos actualizar tu contraseña. Abre de nuevo el enlace del correo.",
      );
    } else {
      await supabase.auth.signOut();
      setSession(null);
      setRecovering(false);
      window.history.replaceState({}, "", window.location.pathname);
      setAuthNoticeTone("success");
      setNotice("Contraseña actualizada. Ya puedes iniciar sesión.");
    }
    setBusy(false);
  }
  async function createRound() {
    if (!session) return;
    if (!title.trim() || !document)
      return setNotice("Añade un nombre y el PDF para continuar.");
    setBusy(true);
    setCreatedLink("");
    setCreatedRoundId("");
    setNotice("Preparando tu ronda…");
    const form = new FormData();
    form.set("title", title);
    form.set("message", message);
    form.set("groupKey", key);
    form.set("document", document);
    const supabase = await getSupabase();
    const { data, error } = await supabase.functions.invoke("create-round", {
      body: form,
    });
    if (error)
      setNotice(
        "No pudimos crear la ronda. Comprueba el PDF e inténtalo de nuevo.",
      );
    else {
      setNotice("");
      setCreatedRoundId(data.id);
      setCreatedLink(`${window.location.origin}/r/${data.id}`);
    }
    setBusy(false);
  }

  if (recovering)
    return (
      <main className="auth auth-recovery">
        <Brand />
        <div className="auth-grid">
          <section className="welcome">
            <DocumentArt />
            <span className="eyebrow">Recuperación de acceso</span>
            <h1>Crea una contraseña nueva.</h1>
            <p>
              Crea una contraseña nueva para volver a gestionar tus documentos.
            </p>
          </section>
          <section className="login-card">
            <span className="card-kicker">
              <Icon name="lock" size={16} /> Seguridad de la cuenta
            </span>
            <h2>Nueva contraseña</h2>
            <p>Elige una contraseña segura y distinta de las que uses en otros servicios.</p>
            <form onSubmit={updatePassword}>
              <label>
                Nueva contraseña
                <PasswordInput value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword((visible) => !visible)} autoFocus />
              </label>
              <PasswordRequirements value={password} />
              <label>
                Repite la contraseña
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((visible) => !visible)} />
              </label>
              {confirmPassword && <p className={`password-match ${password === confirmPassword ? "met" : ""}`}><span><Icon name="check" size={12} /></span>{password === confirmPassword ? "Las contraseñas coinciden" : "Las contraseñas deben coincidir"}</p>}
              <button className="primary wide" disabled={busy}>
                {busy ? "Guardando…" : "Guardar contraseña"}
              </button>
            </form>
            <Notice message={notice} tone={authNoticeTone} />
          </section>
        </div>
      </main>
    );
  if (!session)
    return (
      <main className={`auth ${registering ? "auth-registering" : ""}`}>
        <Brand />
        <div className="auth-grid">
          <section className="welcome">
            <DocumentArt />
            <span className="eyebrow">Firma secuencial de documentos</span>
            <h1>Organiza la firma de un PDF.</h1>
            <p>
              Comparte el documento, asigna los turnos y mantén una única
              versión vigente durante todo el proceso.
            </p>
          </section>
          <section className="login-card">
            <span className="card-kicker">
              <Icon name="shield" size={16} /> Espacio privado
            </span>
            <h2>{registering ? "Crea tu cuenta" : "Accede a LeapSign"}</h2>
            {registering && <p>Completa tus datos para crear tu espacio.</p>}
            {registering ? <form onSubmit={signUp}>
              <div className="name-fields">
                <label>Nombre<input autoComplete="given-name" value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={80} required autoFocus /></label>
                <label>Apellidos<input autoComplete="family-name" value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={120} required /></label>
              </div>
              <label>
                Correo
                <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </label>
              <label>
                Contraseña
                <PasswordInput value={password} onChange={setPassword} visible={showPassword} onToggle={() => setShowPassword((visible) => !visible)} />
              </label>
              <PasswordRequirements value={password} />
              <label>
                Repite la contraseña
                <PasswordInput value={confirmPassword} onChange={setConfirmPassword} visible={showConfirmPassword} onToggle={() => setShowConfirmPassword((visible) => !visible)} />
              </label>
              {confirmPassword && <p className={`password-match ${password === confirmPassword ? "met" : ""}`}><span><Icon name="check" size={12} /></span>{password === confirmPassword ? "Las contraseñas coinciden" : "Las contraseñas deben coincidir"}</p>}
              <button className="primary wide" disabled={busy}>{busy ? "Creando cuenta…" : "Crear cuenta"}</button>
              <button className="text-button" type="button" onClick={() => { setRegistering(false); setNotice(""); }} disabled={busy}>Ya tengo una cuenta</button>
            </form> : <form onSubmit={authenticate}>
              <label>
                Correo
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </label>
              <label>
                Contraseña
                <span className="password-field"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /><button type="button" className="password-toggle" aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPassword} onClick={() => setShowPassword((visible) => !visible)}><Icon name="eye" size={18} /></button></span>
              </label>
              <button className="primary wide" disabled={busy}>
                {busy ? "Entrando…" : "Entrar"}
              </button>
              <button
                className="text-button"
                type="button"
                onClick={requestRecovery}
                disabled={busy}
              >
                ¿Olvidaste tu contraseña?
              </button>
              <button
                className="text-button"
                type="button"
                onClick={() => { setRegistering(true); setNotice(""); }}
                disabled={busy}
              >
                Crear una cuenta
              </button>
            </form>}
            <Notice message={notice} tone={authNoticeTone} />
            {registering && <p className="form-legal">
              Al continuar aceptas las{" "}
              <a href="/condiciones">condiciones de uso</a> y la{" "}
              <a href="/privacidad">política de privacidad</a>.
            </p>}
          </section>
        </div>
      </main>
    );

  return (
    <main className="workspace">
      <Brand />
      <div className="workspace-head">
        <div>
          <span className="eyebrow">Espacio de trabajo</span>
          <h1>Documentos para firmar</h1>
          <p>{session.user.email}</p>
        </div>
        <button
          className="signout"
          onClick={() =>
            getSupabase().then((supabase) => supabase.auth.signOut())
          }
        >
          Salir
        </button>
      </div>
      <section className="create-card">
        <header className="create-card-head">
          <span className="section-kicker">Nuevo proceso</span>
          <h2>Nuevo documento para firmar</h2>
          <p>Sube el PDF que necesitas enviar a otras personas para su firma.</p>
        </header>
        <div className="form-section">
          <div className="step-title">
            <span>1</span>
            <div>
              <h3>Prepara el documento</h3>
              <p>Añade un nombre reconocible y selecciona un PDF de hasta 10 MB.</p>
            </div>
          </div>
          <label>
            Nombre del documento
            <input
              value={title}
              maxLength={120}
              placeholder="Ej. Presupuesto 2026"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label className={`upload ${document ? "has-file" : ""}`}>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
            />
            <span className="upload-icon">
              <Icon name="upload" />
            </span>
            <span>
              <strong>{document ? document.name : "Seleccionar PDF"}</strong>
              <small>
                {document
                  ? `${Math.ceil(document.size / 1024)} KB`
                  : "PDF · máximo 10 MB"}
              </small>
            </span>
          </label>
        </div>
        <div className="form-section">
          <div className="step-title">
            <span>2</span>
            <div>
              <h3>Configura el acceso</h3>
              <p>El mensaje y la clave son opcionales.</p>
            </div>
          </div>
          <label>
            Mensaje <em>Opcional</em>
            <textarea
              value={message}
              maxLength={500}
              placeholder="Añade una nota para quienes firmarán."
              onChange={(e) => setMessage(e.target.value)}
            />
          </label>
          <label>
            Clave de acceso <em>Opcional</em>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Clave para el enlace"
            />
          </label>
        </div>
        <div className="create-action">
          <p>
            <Icon name="lock" size={15} /> El PDF se guarda de forma privada.
          </p>
          <button className="primary" onClick={createRound} disabled={busy}>
            {busy ? (
              "Creando…"
            ) : (
              <>
                <span>Crear proceso y obtener enlace</span>
                <Icon name="arrow" size={17} />
              </>
            )}
          </button>
        </div>
        <aside className="process-disclaimer">
          <Icon name="shield" size={17} />
          <span><strong>Antes de compartir.</strong> Confirma que puedes tratar el documento y los datos de las personas invitadas. LeapSign organiza el proceso, pero no verifica identidades ni certifica firmas. Revisa y guarda siempre la versión final.</span>
        </aside>
        {createdLink && (
          <div className="share-link" role="status">
            <div className="share-link-head">
              <div>
                <span>Proceso creado</span>
                <strong>Ya puedes compartir el documento</strong>
              </div>
              <Icon name="check" size={20} />
            </div>
            <div className="share-link-row">
              <a href={createdLink} target="_blank" rel="noreferrer">Abrir enlace de firma</a>
              <button
                className="signout"
                onClick={() =>
                  navigator.clipboard
                    .writeText(createdLink)
                    .then(() => setNotice("Enlace copiado."))
                    .catch(() => setNotice("No se pudo copiar; selecciónalo manualmente."))
                }
              >
                Copiar enlace
              </button>
            </div>
            {createdRoundId && <InvitationComposer workflowId={createdRoundId} />}
          </div>
        )}
        <Notice message={notice} />
      </section>
      <OwnerPanel />
    </main>
  );
}
const adminHost = window.location.hostname === "admin.veryfacil.org";
const adminFallback = window.location.pathname === "/superadmin";
const AdminApp = lazy(() => import("./admin/AdminApp").then((module) => ({ default: module.AdminApp })));
createRoot(document.getElementById("root")!).render(
  adminHost || adminFallback
    ? <Suspense fallback={<main className="admin-loading-page">Abriendo el acceso seguro…</main>}><AdminApp /></Suspense>
    : <><App /><Footer /></>,
);
