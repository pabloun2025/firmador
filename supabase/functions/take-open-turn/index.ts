import { protectEndpoint } from "../_shared/economic-guard.ts";
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
Deno.serve(protectEndpoint("take-open-turn", createClient, async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const {
      id,
      groupKey = "",
      name = "",
      email = "",
      sessionId,
      turnToken = "",
      queueToken = "",
      inviteToken = "",
    } = await req.json();
    if (!id || !sessionId || (!name?.trim() && !turnToken && !queueToken && !inviteToken))
      throw new Error("Datos inválidos.");
    if (email && (typeof email !== "string" || !/^\S+@\S+\.\S+$/.test(email)))
      throw new Error("El correo no es válido.");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: settings } = await admin.from("system_settings").select("maintenance_mode").eq("singleton", true).single();
    if (settings?.maintenance_mode) throw new Error("LeapSign está en mantenimiento. Inténtalo más tarde.");
    const { data: round } = await admin
      .from("workflows")
      .select("group_key_hash,title")
      .eq("id", id)
      .maybeSingle();
    if (!inviteToken && (
      !round ||
      (round.group_key_hash && round.group_key_hash !== (await hash(groupKey)))
    ))
      throw new Error("No se pudo acceder a esta ronda.");
    const sessionHash = await hash(sessionId);
    let holderName = name.trim();
    let normalizedEmail = email.trim().toLowerCase();
    let invitedSessionHash = "";
    if (inviteToken) {
      const { data: invited, error: invitationError } = await admin.rpc("restore_round_invitation_access", {
        p_workflow_id: id, p_token_hash: await hash(inviteToken), p_new_session_hash: sessionHash,
      });
      if (invitationError) throw new Error(invitationError.message);
      if (!invited) throw new Error("No pudimos abrir la invitación.");
      holderName = String(invited.holder_name || "").trim();
      normalizedEmail = String(invited.email || "").trim().toLowerCase();
    } else if (queueToken) {
      const { data: restored, error: restoreError } = await admin.rpc(
        "restore_open_turn_access",
        {
          p_workflow_id: id,
          p_access_token_hash: await hash(queueToken),
          p_new_session_hash: sessionHash,
        },
      );
      if (restoreError) throw new Error(restoreError.message);
      if (!restored) throw new Error("No pudimos recuperar tu turno.");
      holderName = String(restored.holder_name || "").trim();
      normalizedEmail = String(restored.email || "").trim().toLowerCase();
    } else if (turnToken && !holderName) {
      const { data: invited } = await admin
        .from("open_round_waitlist")
        .select("holder_name,email,session_hash")
        .eq("workflow_id", id)
        .eq("turn_token_hash", await hash(turnToken))
        .gt("turn_token_expires_at", new Date().toISOString())
        .maybeSingle();
      if (!invited) throw new Error("El enlace de turno no es válido o ha caducado.");
      holderName = invited.holder_name;
      normalizedEmail = invited.email || "";
      invitedSessionHash = invited.session_hash;
    }
    const { data: turn, error } = await admin.rpc("claim_open_turn", {
      p_workflow_id: id,
      p_holder_name: holderName,
      p_session_hash: sessionHash,
      p_email: normalizedEmail || null,
      p_turn_token_hash: turnToken ? await hash(turnToken) : null,
    });
    if (error) throw new Error(error.message);
    if (
      turn.state === "active" &&
      invitedSessionHash &&
      invitedSessionHash !== sessionHash
    ) {
      const { error: transferError } = await admin
        .from("open_round_access_links")
        .update({ session_hash: sessionHash })
        .eq("workflow_id", id)
        .eq("session_hash", invitedSessionHash);
      if (transferError)
        console.error("No se pudo transferir el enlace de consulta", transferError.code);
    }
    // Queue and turn-ready emails were deliberately removed. The invitation
    // remains the durable access route and scheduled reminders cover inactivity.
    turn.holder_name = holderName;
    turn.email = normalizedEmail;
    return Response.json(turn, { headers: cors });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Error" },
      { status: 400, headers: cors },
    );
  }
}));
