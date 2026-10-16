import { describe, expect, it } from "vitest";
import { whatsappShareUrl } from "../src/lib/share";

describe("WhatsApp sharing", () => {
  it("creates an encoded message with title, note and signing link", () => {
    const link = "https://firma.veryfacil.org/r/abc123";
    const result = whatsappShareUrl("Acuerdo comercial", link, "Firma antes del viernes.");
    const url = new URL(result);
    const message = url.searchParams.get("text");

    expect(url.origin).toBe("https://wa.me");
    expect(message).toContain("Acuerdo comercial");
    expect(message).toContain("Firma antes del viernes.");
    expect(message).toContain(link);
  });

  it("omits an empty optional note", () => {
    const result = whatsappShareUrl("Contrato", "https://firma.veryfacil.org/r/demo");
    expect(new URL(result).searchParams.get("text")).not.toContain("Mensaje:");
  });
});
