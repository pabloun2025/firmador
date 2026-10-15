import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261015040000_superadmin_console.sql", "utf8");
const edge = readFileSync("supabase/functions/superadmin-console/index.ts", "utf8");

describe("superadmin security contract", () => {
  it("keeps every administrative table behind RLS and removes browser grants", () => {
    for (const table of ["super_admins", "system_settings", "email_templates", "superadmin_audit_log"]) {
      expect(migration).toContain(`alter table public.${table} enable row level security`);
      expect(migration).toContain(`revoke all on public.${table} from public, anon, authenticated`);
    }
  });

  it("requires both an allowlisted account and an aal2 session", () => {
    expect(edge).toContain('claims.aal !== "aal2"');
    expect(edge).toContain('.from("super_admins")');
    expect(edge).toContain('.eq("active", true)');
  });

  it("does not implement document download or signed document URLs", () => {
    expect(edge).not.toContain("createSignedUrl");
    expect(edge).not.toContain("download-version");
  });

  it("requires a written reason for privileged mutations", () => {
    expect(edge.match(/requireReason\(payload\.reason\)/g)?.length).toBeGreaterThanOrEqual(5);
  });
});

describe("operational switches", () => {
  it("are consulted by every notification path", () => {
    for (const file of [
      "supabase/functions/send-round-invitations/index.ts",
      "supabase/functions/take-open-turn/index.ts",
      "supabase/functions/submit-signed-version/index.ts",
      "supabase/functions/owner-round-action/index.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/from\(["']system_settings["']\)/);
      expect(source).toMatch(/from\(["']email_templates["']\)/);
    }
  });
});
