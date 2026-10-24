import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compactRoundId, expandRoundId, roundPath } from "../src/lib/round-link";

const app = readFileSync("src/main.tsx", "utf8");
const redesign = readFileSync("src/redesign.css", "utf8");

describe("LeapSign task-oriented interface", () => {
  it("centers the owner workspace on creating and managing documents", () => {
    expect(app).toContain("Nuevo documento para firmar");
    expect(app).toContain("Crear proceso y obtener enlace");
    expect(app).toContain("Mis documentos");
    expect(app).toContain("Cola de firmas");
    expect(app).toContain("Procesos anteriores");
    expect(app).toContain("Ir al seguimiento de este proceso");
    expect(app).not.toContain("Tus documentos, en orden.");
  });

  it("explains the complete signer task with specific actions", () => {
    for (const copy of [
      "Descarga el documento",
      "Firma el PDF",
      "Sube el PDF firmado",
      "Descargar PDF",
      "Seleccionar PDF firmado",
      "Subir PDF firmado y completar mi turno",
    ]) {
      expect(app).toContain(copy);
    }
  });

  it("keeps secondary information progressively disclosed", () => {
    expect(app).toContain('details className="contact-picker" open');
    expect(app).toContain('details className="history-disclosure"');
    expect(app).toContain('details className="issue-disclosure"');
  });

  it("shows the queue game immediately and depicts a frog jumping PDFs", () => {
    const arcade = readFileSync("src/components/QueueArcade.tsx", "utf8");
    expect(app).toContain('<QueueArcade />');
    expect(arcade).toContain('className="queue-game arcade"');
    expect(arcade).toContain("Salto de firma");
    expect(arcade).toContain("saltando documentos PDF");
    expect(arcade).not.toContain('<details');
  });

  it("refreshes tracking periodically and collapses inactive sections", () => {
    expect(app).toContain("20_000");
    expect(app).toContain('className="tracking-section signature-queue"');
    expect(app).toContain('className="tracking-section version-section"');
    expect(redesign).toContain(".tracking-section > summary");
  });

  it("shows the current signer in large type and previews the PDF before closing", () => {
    const studio = readFileSync("src/studio.css", "utf8");
    const headlines = readFileSync("src/lib/signature-progress.ts", "utf8");
    expect(app).toContain("Ver PDF");
    expect(app).toContain('className="signer-label"');
    expect(headlines).toContain("La última firma añadida es");
    expect(app).toContain("El proceso sigue abierto.");
    expect(app).toContain('details className="close-choice"');
    expect(app).toContain("Cerrar firmas con esta versión");
    expect(app).toContain("Ya vi este PDF y quiero dejarlo como versión final");
    expect(app).toContain('className="pdf-preview-dialog"');
    expect(app).toContain("Plazos y conservación");
    expect(app).toContain('details className="history-disclosure"');
    expect(studio).toContain(".signer-banner strong { display: block; color: #102c25; font-size: 20px;");
  });

  it("moves creation through distinct create, share and tracking stages", () => {
    expect(app).toContain('"create" | "share" | "track"');
    expect(app).toContain('creationStage === "share"');
    expect(app).toContain('creationStage === "track"');
    expect(app).toContain('creationStage !== "share"');
  });

  it("asks for a signer target and explains the indefinite option", () => {
    expect(app).toContain("¿Cuántas personas deben firmar?");
    expect(app).toContain("No lo sé todavía");
    expect(app).toContain('form.set("expectedSignatures"');
  });

  it("shows and enforces the remaining invitation capacity", () => {
    expect(app).toContain("Puedes invitar a");
    expect(app).toContain("remainingInvitations");
    expect(redesign).toContain(".invitation-capacity");
  });

  it("offers WhatsApp sharing beside the generated signing link", () => {
    expect(app).toContain("Compartir por WhatsApp");
    expect(app).toContain("whatsappShareUrl(createdRoundTitle, createdLink, message)");
    expect(redesign).toContain(".whatsapp-button");
  });

  it("keeps the tracking handoff aligned across the full card", () => {
    expect(redesign).toMatch(/\.tracking-handoff\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
    expect(redesign).toMatch(/\.tracking-handoff\s*\{[^}]*padding:\s*0 30px 26px;/s);
  });

  it("shows the real process-creation error with an error treatment", () => {
    expect(app).toContain('await functionError(\n          error,\n          "No pudimos crear el proceso. Comprueba el PDF e inténtalo de nuevo."');
    expect(app).toContain('<Notice message={notice} tone={workspaceNoticeTone} />');
    expect(app).toContain('setWorkspaceNoticeTone("error")');
    expect(app).not.toContain("No pudimos crear la ronda. Comprueba el PDF e inténtalo de nuevo.");
  });

  it("defines visible focus and responsive mobile layouts", () => {
    expect(redesign).toContain(":focus-visible");
    expect(redesign).toContain("@media (max-width: 600px)");
    expect(redesign).toContain("grid-template-columns: 1fr");
  });
});

describe("compact signing links", () => {
  const id = "f5cb323f-7901-4e8d-866c-d228e2d5a554";

  it("shortens a UUID without losing information", () => {
    const compact = compactRoundId(id);
    expect(compact).toHaveLength(22);
    expect(expandRoundId(compact)).toBe(id);
    expect(roundPath(id)).toBe(`/r/${compact}`);
  });

  it("keeps existing UUID links compatible", () => {
    expect(expandRoundId(id.toUpperCase())).toBe(id);
  });

  it("rejects malformed identifiers", () => {
    expect(expandRoundId("not-a-process")).toBe("");
  });
});
