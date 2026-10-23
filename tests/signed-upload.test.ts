import { describe, expect, it } from "vitest";
import { reviewSignedUpload } from "../src/lib/signed-upload";

const parent = 100_000;

describe("signed upload selection", () => {
  it("rejects an unrelated file and accepts the next related one", () => {
    expect(reviewSignedUpload({ name: "foto.pdf", size: parent }, "Contrato.pdf", parent)).toMatch(/nombre/);
    expect(reviewSignedUpload({ name: "Contrato firmado.pdf", size: parent + 20_000 }, "Contrato.pdf", parent)).toBe("");
  });

  it("rejects a file whose size cannot be the downloaded PDF", () => {
    expect(reviewSignedUpload({ name: "Contrato.pdf", size: 100 }, "Contrato.pdf", parent)).toMatch(/tamaño/);
  });

  it("keeps a same-sized file when the previous version size is unknown", () => {
    expect(reviewSignedUpload({ name: "Contrato.pdf", size: parent }, "Contrato.pdf", null)).toBe("");
  });
});
