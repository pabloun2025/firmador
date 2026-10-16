import { describe, expect, it } from "vitest";
import { isRelatedDocumentName, normalizeDocumentName } from "../src/lib/document-name";

describe("document filename continuity", () => {
  it.each([
    ["Contrato de arriendo.pdf", "Contrato_de_arriendo_firmado.pdf"],
    ["Nómina octubre 2026.pdf", "signed_nomina-octubre-2026.pdf"],
    ["Acuerdo comercial.pdf", "Acuerdo comercial final (2).pdf"],
    ["presupuesto_cliente.pdf", "presupuesto-cliente-signature.pdf"],
  ])("accepts normal signer suffixes", (expected, candidate) => {
    expect(isRelatedDocumentName(expected, candidate)).toBe(true);
  });

  it.each([
    ["Contrato de arriendo.pdf", "foto-vacaciones.pdf"],
    ["Nómina octubre.pdf", "certificado-bancario.pdf"],
    ["Acuerdo comercial.pdf", "documento-nuevo.pdf"],
  ])("rejects unrelated names", (expected, candidate) => {
    expect(isRelatedDocumentName(expected, candidate)).toBe(false);
  });

  it("normalizes accents, numbering and signing words", () => {
    expect(normalizeDocumentName("Nómina_2026_FIRMADA (2).pdf")).toBe("nomina2026");
  });
});
