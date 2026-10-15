import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const app = readFileSync("src/main.tsx", "utf8");
const redesign = readFileSync("src/redesign.css", "utf8");

describe("LeapSign task-oriented interface", () => {
  it("centers the owner workspace on creating and managing documents", () => {
    expect(app).toContain("Nuevo documento para firmar");
    expect(app).toContain("Crear proceso y obtener enlace");
    expect(app).toContain("Mis documentos");
    expect(app).toContain("Cola de firmas");
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
    expect(app).toContain('details className="contact-picker"');
    expect(app).toContain('details className="history-disclosure"');
    expect(app).toContain('details className="issue-disclosure"');
  });

  it("defines visible focus and responsive mobile layouts", () => {
    expect(redesign).toContain(":focus-visible");
    expect(redesign).toContain("@media (max-width: 600px)");
    expect(redesign).toContain("grid-template-columns: 1fr");
  });
});
