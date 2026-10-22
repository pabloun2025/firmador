import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261016020000_coherent_lifecycle_and_validation.sql", "utf8");
const invitations = readFileSync("supabase/functions/send-round-invitations/index.ts", "utf8");
const submit = readFileSync("supabase/functions/submit-signed-version/index.ts", "utf8");
const download = readFileSync("supabase/functions/participant-download-version/index.ts", "utf8");
const maintenance = readFileSync("supabase/functions/process-lifecycle-jobs/index.ts", "utf8");
const capacity = readFileSync("supabase/migrations/20261016030000_enforce_signature_capacity.sql", "utf8");
const names = readFileSync("supabase/functions/_shared/document-name.ts", "utf8");

describe("coherent signing lifecycle", () => {
  it("uses 48-hour invitations and reminders at one and twenty-four hours", () => {
    expect(invitations).toContain("48*60*60_000");
    expect(migration).toContain("reminder_1h_sent_at");
    expect(migration).toContain("reminder_24h_sent_at");
    expect(maintenance).toContain("60 * 60_000");
    expect(maintenance).toContain("24 * 60 * 60_000");
  });

  it("keeps historical PDFs for 48 hours and the final PDF for five days", () => {
    expect(migration).toContain("interval '48 hours'");
    expect(migration).toContain("interval '5 days'");
    expect(migration).toContain("scheduled_for");
  });

  it("requires an authoritative download before a signed upload", () => {
    expect(download).toContain("reviewed_version_at");
    expect(submit).toContain("reviewed_version_at");
    expect(migration).toContain("Descarga el documento vigente antes de incorporar");
  });

  it("validates PDF structure rather than requiring a larger file", () => {
    expect(submit).toContain("comparePdfProfiles");
    expect(submit).toContain("validateRelatedSize");
    expect(submit).not.toContain("debe pesar más que la versión anterior");
  });

  it("does not block externally renamed signed PDFs", () => {
    expect(submit).not.toContain("validateRelatedDocumentName");
    expect(download).toContain("expectedFilename");
  });

  it("treats the signer count as a real invitation capacity", () => {
    expect(invitations).toContain("expected_signature_count - workflow.signature_count - activeEmails.size");
    expect(invitations).toContain("Ya están cubiertas todas las plazas de firma");
    expect(invitations).toContain("remaining");
    expect(capacity).toContain("signature_count >= workflow_row.expected_signature_count");
    expect(capacity).toContain("Este proceso ya alcanzó el número de firmas previsto");
  });
});
