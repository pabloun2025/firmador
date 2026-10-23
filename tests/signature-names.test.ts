import { describe, expect, it } from "vitest";
import { readSignatureProgress } from "../supabase/functions/_shared/signature-names";
import { signatureReadout } from "../src/lib/signature-progress";

const pdf = (body: string) => new TextEncoder().encode(`%PDF-1.7\n${body}\n%%EOF`);
const contents = (hex: string) => `/Contents <${hex}>`;
const signature = (name: string, hex: string) => `<< /Type /Sig /Filter /Adobe.PPKLite /SubFilter /adbe.pkcs7.detached /Name (${name}) ${contents(hex)} >>`;
const hex = `${"30820100112233445566778899aabbccddeeff"}${"ab".repeat(80)}`;

describe("signature name reading", () => {
  it("reports a new signer name without calling the signature valid", async () => {
    const progress = await readSignatureProgress(pdf(signature("Ana Perez", hex)), pdf("<< /Type /Catalog >>"));
    expect(progress.status).toBe("detected");
    expect(progress.addedNames).toEqual(["Ana Perez"]);
    expect(signatureReadout(progress)).toBe("Firmas detectadas: Ana Perez. Nueva: Ana Perez.");
    expect(signatureReadout(progress)).not.toMatch(/válid/i);
  });

  it("keeps an inherited signature and names only the added one", async () => {
    const previous = pdf(signature("Ana Perez", hex));
    const candidate = pdf(`${signature("Ana Perez", hex)} ${signature("Luis Mora", `${hex}ab`)}`);
    const progress = await readSignatureProgress(candidate, previous);
    expect(progress).toMatchObject({ status: "detected", names: ["Ana Perez", "Luis Mora"], addedNames: ["Luis Mora"], signatureCount: 2, previousCount: 1 });
  });

  it("says when the uploaded PDF adds no signature", async () => {
    const file = pdf(signature("Ana Perez", hex));
    const progress = await readSignatureProgress(file, file);
    expect(progress.status).toBe("no_new_signature");
    expect(signatureReadout(progress)).toBe("Sin firma nueva. Firmas ya presentes: Ana Perez.");
  });

  it("reads the certificate common name and ignores a document timestamp", async () => {
    const encoded = [...new TextEncoder().encode("Maria Lopez")].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const commonName = `06035504030c0b${encoded}${"11".repeat(50)}`;
    const file = pdf(`<< /Type /DocTimeStamp /Contents <${hex}> >> << /Type /Sig ${contents(commonName)} >>`);
    const progress = await readSignatureProgress(file);
    expect(progress.names).toEqual(["Maria Lopez"]);
    expect(progress.signatureCount).toBe(1);
  });

  it("does not fail the caller when the PDF cannot be read", async () => {
    const progress = await readSignatureProgress(new TextEncoder().encode("not a pdf"));
    expect(progress.status).toBe("unreadable");
    expect(signatureReadout(progress)).toBe("No se pudieron leer las firmas de este PDF.");
  });
});
