import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20261015040000_superadmin_console.sql", "utf8");
const edge = readFileSync("supabase/functions/superadmin-console/index.ts", "utf8");
const recoveryMigration = readFileSync("supabase/migrations/20261016010000_expected_signatures_and_recovery.sql", "utf8");
const recoveryEdge = readFileSync("supabase/functions/superadmin-recovery/index.ts", "utf8");

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

describe("superadmin recovery contract", () => {
  it("stores only hashed, short-lived recovery codes behind RLS", () => {
    expect(recoveryMigration).toContain("superadmin_recovery_codes");
    expect(recoveryMigration).toContain("code_hash text not null");
    expect(recoveryMigration).toContain("enable row level security");
    expect(recoveryMigration).toContain("revoke all on public.superadmin_recovery_codes");
  });

  it("requires a password-authenticated admin and limits attempts", () => {
    expect(recoveryEdge).toContain('methods.includes("password")');
    expect(recoveryEdge).toContain('.from("super_admins")');
    expect(recoveryEdge).toContain('admin.rpc("consume_superadmin_recovery"');
    const atomicRecovery = readFileSync("supabase/migrations/20261017020000_atomic_admin_recovery.sql", "utf8");
    expect(atomicRecovery).toContain("recovery.attempts >= 5");
    expect(atomicRecovery).toContain("for update");
    expect(recoveryEdge).toContain("admin.auth.admin.mfa.deleteFactor");
  });
});

describe("expected signature completion", () => {
  it("supports an open count and a one-time owner notification", () => {
    const submit = readFileSync("supabase/functions/submit-signed-version/index.ts", "utf8");
    expect(recoveryMigration).toContain("expected_signature_count");
    expect(recoveryMigration).toContain("owner_completion_notified_at");
    expect(submit).toContain("notifyOwnerWhenComplete");
    expect(submit).toContain('.is("owner_completion_notified_at", null)');
  });
});

describe("operational switches", () => {
  it("are consulted by every notification path", () => {
    for (const file of [
      "supabase/functions/send-round-invitations/index.ts",
      "supabase/functions/submit-signed-version/index.ts",
      "supabase/functions/process-lifecycle-jobs/index.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source).toMatch(/from\(["']system_settings["']\)/);
      expect(source).toMatch(/from\(["']email_templates["']\)/);
    }
  });
});
