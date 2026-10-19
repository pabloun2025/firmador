import { createClient } from 'jsr:@supabase/supabase-js@2';
import { protectEndpoint } from '../_shared/economic-guard.ts';
import { finalDocument, finalShareToken, FINAL_LINK_ERROR } from '../_shared/final-share.ts';
const headers = { 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store' };
Deno.serve(protectEndpoint('owner-final-share',createClient,async(request,context)=>{
  try {
    if (!context.ownerId) throw new Error(FINAL_LINK_ERROR);
    const { id } = await request.json();
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!,secret);
    const { workflow, version, expiresAt } = await finalDocument(admin,id,context.ownerId);
    const token = await finalShareToken(secret,workflow.id,version.id);
    return Response.json({token,title:workflow.title,expiresAt},{headers});
  } catch { return Response.json({error:FINAL_LINK_ERROR},{status:404,headers}); }
}));
