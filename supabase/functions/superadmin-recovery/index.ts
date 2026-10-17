import { protectEndpoint, budgetedFetch } from "../_shared/economic-guard.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const allowedOrigins = new Set([
  "https://admin.veryfacil.org",
  "https://firma.veryfacil.org",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const cors = (request: Request) => {
  const origin = request.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : "https://admin.veryfacil.org",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
};
const encoder = new TextEncoder();
const digest = async (value: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const decodeJwt = (authorization: string) => {
  try {
    const token = authorization.replace(/^Bearer\s+/i, "");
    const segment = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(segment.padEnd(Math.ceil(segment.length / 4) * 4, "=")));
  } catch { return {}; }
};

Deno.serve(protectEndpoint("superadmin-recovery", createClient, async (request) => {
  const headers = cors(request);
  if (request.method === "OPTIONS") return new Response("ok", { headers });
  try {
    const authorization = request.headers.get("Authorization");
    if (!authorization) throw new Error("Inicia sesión con tu contraseña para continuar.");
    const url = Deno.env.get("SUPABASE_URL")!;
    const userClient = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authorization } } });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user?.email || !user.email_confirmed_at) throw new Error("La sesión no es válida.");
    const claims = decodeJwt(authorization);
    const methods = Array.isArray(claims.amr) ? claims.amr.map((entry: { method?: string } | string) => typeof entry === "string" ? entry : entry.method) : [];
    if (!methods.includes("password")) throw new Error("Vuelve a iniciar sesión con tu contraseña para recuperar el segundo factor.");
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const email = user.email.trim().toLowerCase();
    const { data: allowed } = await admin.from("super_admins").select("email,user_id,active").eq("email", email).eq("active", true).maybeSingle();
    if (!allowed || (allowed.user_id && allowed.user_id !== user.id)) throw new Error("Esta cuenta no tiene acceso administrativo.");
    const payload = await request.json() as { action?: string; code?: string };

    if (payload.action === "request") {
      const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
      const { data: recent } = await admin.from("superadmin_recovery_codes").select("id").eq("user_id", user.id).gte("created_at", oneMinuteAgo).limit(1).maybeSingle();
      if (recent) throw new Error("Espera un minuto antes de solicitar otro código.");
      const random = new Uint32Array(1); crypto.getRandomValues(random);
      const code = String(random[0] % 100_000_000).padStart(8, "0");
      const codeHash = await digest(`${user.id}:${code}`);
      const { error: insertError } = await admin.from("superadmin_recovery_codes").insert({ user_id: user.id, code_hash: codeHash, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      if (insertError) throw new Error("No pudimos preparar la recuperación.");
      const key = Deno.env.get("RESEND_API_KEY");
      const from = Deno.env.get("RESEND_FROM_EMAIL");
      if (!key || !from) throw new Error("El correo de recuperación no está disponible.");
      const response = await budgetedFetch(admin, "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [email],
          subject: "LeapSign · Código para restablecer el segundo factor",
          html: `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:520px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="font-size:20px;font-weight:700">LeapSign</p><h1 style="font-size:25px">Restablecer segundo factor</h1><p>Usa este código únicamente si acabas de solicitar el restablecimiento del acceso administrativo:</p><p style="font-size:30px;font-weight:700;letter-spacing:.18em">${code}</p><p>Caduca en 10 minutos. Si no lo solicitaste, cambia tu contraseña y no compartas el código.</p></main></div>`,
        }),
      });
      if (!response.ok) throw new Error("No pudimos enviar el código de recuperación.");
      return Response.json({ ok: true }, { headers });
    }

    if (payload.action === "confirm") {
      const code = String(payload.code || "").replace(/\D/g, "");
      if (!/^\d{8}$/.test(code)) throw new Error("Escribe el código de ocho dígitos.");
      const { data: consumed, error: consumeError } = await admin.rpc("consume_superadmin_recovery", {
        p_user_id: user.id, p_code_hash: await digest(`${user.id}:${code}`),
      });
      if (consumeError || consumed !== true) throw new Error("El código no es correcto o ha caducado. Solicita uno nuevo si agotaste los intentos.");
      const factors = await admin.auth.admin.mfa.listFactors({ userId: user.id });
      if (factors.error) throw new Error("No pudimos consultar el segundo factor.");
      for (const factor of factors.data?.factors ?? []) {
        const result = await admin.auth.admin.mfa.deleteFactor({ userId: user.id, id: factor.id });
        if (result.error) throw new Error("No pudimos restablecer el segundo factor.");
      }
      await admin.from("superadmin_audit_log").insert({ admin_user_id: user.id, admin_email: email, action: "mfa_recovery_completed", target_type: "superadmin", target_id: user.id, reason: "Recuperación verificada por contraseña y correo" });
      return Response.json({ ok: true, signedOut: true }, { headers });
    }
    throw new Error("Operación no válida.");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "No pudimos completar la recuperación." }, { status: 400, headers });
  }
}));
