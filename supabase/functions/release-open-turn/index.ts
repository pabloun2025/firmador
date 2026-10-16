import { createClient } from "jsr:@supabase/supabase-js@2";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};
const hash = async (v: string) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ]!,
  );
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { id, sessionId } = await req.json();
    if (!id || !sessionId) throw new Error("Datos inválidos.");
    const a = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data, error } = await a.rpc("release_open_turn", {
      p_workflow_id: id,
      p_session_hash: await hash(sessionId),
    });
    if (error) throw new Error(error.message);
    // The live page advances automatically. No timing-sensitive turn email is
    // sent here; reminder emails are tied to the durable personal invitation.
    return Response.json({ ok: true }, { headers: cors });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400, headers: cors },
    );
  }
});
