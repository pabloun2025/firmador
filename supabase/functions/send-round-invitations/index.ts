import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const emailOk = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const hash = async (value: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x => x.toString(16).padStart(2, '0')).join('');
const esc = (value: string) => value.replace(/[&<>'"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' }[c]!));
const render = (template: string, variables: Record<string,string>) => Object.entries(variables).reduce((result,[key,value]) => result.replaceAll(`{{${key}}}`, value), template);
const paragraphs = (value: string) => value.split(/\n{2,}/).map(part => `<p style="line-height:1.65;color:#53665e">${esc(part).replaceAll('\n','<br>')}</p>`).join('');
async function owner(request: Request) {
  const authorization = request.headers.get('Authorization');
  if (!authorization) throw new Error('No autorizado.');
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authorization } } });
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) throw new Error('No autorizado.');
  return user;
}
Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id, recipients } = await request.json();
    if (typeof id !== 'string' || !Array.isArray(recipients) || !recipients.length || recipients.length > 25) throw new Error('Selecciona entre 1 y 25 destinatarios.');
    const normalized = recipients.map((item: unknown) => {
      const value = item as { email?: unknown; name?: unknown; saveContact?: unknown };
      const email = typeof value.email === 'string' ? value.email.trim().toLowerCase() : '';
      const name = typeof value.name === 'string' ? value.name.trim().slice(0, 120) : '';
      if (!emailOk(email)) throw new Error('Hay un correo no válido.');
      return { email, name, saveContact: value.saveContact === true };
    });
    const unique = [...new Map(normalized.map(item => [item.email, item])).values()];
    const user = await owner(request);
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const [{ data: settings }, { data: template }] = await Promise.all([
      admin.from('system_settings').select('email_master_enabled,email_invitations_enabled,maintenance_mode').eq('singleton', true).single(),
      admin.from('email_templates').select('subject_template,body_template,enabled').eq('template_key', 'invitation').single(),
    ]);
    if (settings?.maintenance_mode) throw new Error('LeapSign está en mantenimiento. Inténtalo más tarde.');
    if (!settings?.email_master_enabled || !settings.email_invitations_enabled || !template?.enabled) throw new Error('Las invitaciones por correo están desactivadas temporalmente.');
    const { data: workflow } = await admin.from('workflows').select('id,title,status').eq('id', id).eq('owner_id', user.id).maybeSingle();
    if (!workflow || workflow.status !== 'active') throw new Error('Este proceso ya no admite nuevas firmas.');
    const resendKey = Deno.env.get('RESEND_API_KEY'); const from = Deno.env.get('RESEND_FROM_EMAIL');
    if (!resendKey || !from) throw new Error('El envío de correo no está configurado.');
    let sent = 0; let skipped = 0; let completed = 0; const failed: string[] = [];
    for (const recipient of unique) {
      const { data: savedContact } = await admin.from('owner_contacts').select('display_name').eq('owner_id', user.id).eq('email', recipient.email).maybeSingle();
      const displayName = recipient.name || savedContact?.display_name || recipient.email.split('@')[0];
      if (recipient.saveContact) {
        await admin.from('owner_contacts').upsert({ owner_id: user.id, email: recipient.email, display_name: displayName, last_used_at: new Date().toISOString() }, { onConflict: 'owner_id,email' });
      }
      const { data: completedInvitation } = await admin.from('round_invitations').select('id').eq('workflow_id', id).eq('email', recipient.email).eq('status', 'completed').limit(1).maybeSingle();
      if (completedInvitation) { completed++; continue; }
      const { data: prior } = await admin.from('round_invitations').select('id,session_hash').eq('workflow_id', id).eq('email', recipient.email).in('status', ['pending','opened','cancelled']).gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (prior?.session_hash) { skipped++; continue; }
      const rawToken = crypto.randomUUID();
      const invitation = prior
        ? await admin.from('round_invitations').update({ token_hash: await hash(rawToken), holder_name: displayName, status: 'pending', session_hash: null, opened_at: null, expires_at: new Date(Date.now()+30*86400000).toISOString(), email_error: null }).eq('id', prior.id).select('id').single()
        : await admin.from('round_invitations').insert({ workflow_id:id, owner_id:user.id, email:recipient.email, holder_name:displayName, token_hash:await hash(rawToken) }).select('id').single();
      if (invitation.error || !invitation.data) { failed.push(recipient.email); continue; }
      const link = `https://firma.veryfacil.org/r/${id}?invite=${encodeURIComponent(rawToken)}`;
      const variables = { name: displayName, title: workflow.title, link };
      const subject = render(template.subject_template, variables);
      const body = render(template.body_template, variables);
      const html = `<div style="margin:0;background:#f5f6f2;padding:32px 16px"><main style="max-width:560px;margin:auto;background:#fff;border:1px solid #dce5df;border-radius:16px;padding:32px;font-family:Arial,sans-serif;color:#102c25"><p style="margin:0 0 24px;font-size:20px;font-weight:700">LeapSign</p><p style="margin:0;color:#29705c;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em">Invitación a firmar</p><h1 style="margin:10px 0 16px;font-size:28px">Tienes un documento pendiente</h1>${paragraphs(body)}<p style="margin:24px 0"><a href="${link}" style="display:inline-block;background:#124d40;color:#fff;padding:13px 18px;border-radius:9px;text-decoration:none;font-weight:700">Entrar a mi turno</a></p><hr style="border:0;border-top:1px solid #e6ece8;margin:28px 0 18px"><p style="margin:0;color:#75827c;font-size:12px;line-height:1.5">Enlace privado · No reenvíes este correo ni el enlace de acceso.</p></main></div>`;
      const response = await fetch('https://api.resend.com/emails', { method:'POST', headers:{ Authorization:`Bearer ${resendKey}`, 'Content-Type':'application/json', 'Idempotency-Key':`leapsign-invitation-${invitation.data.id}` }, body:JSON.stringify({ from, to:[recipient.email], subject, html }) });
      if (response.ok) { sent++; await admin.from('round_invitations').update({ email_sent_at:new Date().toISOString(), email_error:null }).eq('id', invitation.data.id); }
      else { failed.push(recipient.email); await admin.from('round_invitations').update({ email_error:`HTTP ${response.status}` }).eq('id', invitation.data.id); }
    }
    return Response.json({ sent, skipped, completed, failed }, { headers: cors });
  } catch (error) { return Response.json({ error:error instanceof Error ? error.message : 'Error inesperado.' }, { status:400, headers:cors }); }
});
