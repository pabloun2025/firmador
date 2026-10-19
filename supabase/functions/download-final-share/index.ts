import { createClient } from 'jsr:@supabase/supabase-js@2';
import { protectEndpoint, reserveDownload, BudgetError } from '../_shared/economic-guard.ts';
import { finalDocument, finalShareToken, equalFinalToken, FINAL_LINK_ERROR } from '../_shared/final-share.ts';
const headers = { 'Access-Control-Allow-Origin':'*', 'Cache-Control':'no-store' };
Deno.serve(protectEndpoint('download-final-share',createClient,async request=>{
  try {
    const {id,token,action='view'} = await request.json();
    if (!['view','download'].includes(action) || typeof token!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error(FINAL_LINK_ERROR);
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!,secret);
    const {workflow,version,expiresAt} = await finalDocument(admin,id);
    if (!equalFinalToken(token,await finalShareToken(secret,workflow.id,version.id))) throw new Error(FINAL_LINK_ERROR);
    if (action==='view') return Response.json({title:workflow.title,expiresAt},{headers});
    await reserveDownload(admin,version.id,Number(version.byte_size));
    const ttl = Math.min(60,Math.floor((Date.parse(expiresAt)-Date.now())/1000));
    if (ttl<1) throw new Error(FINAL_LINK_ERROR);
    const filename = `${String(workflow.title).replace(/[<>:"/\\|?*\u0000-\u001f]/g,' ').replace(/\.pdf$/i,'').trim().slice(0,150)||'Documento'}_final.pdf`;
    const {data,error} = await admin.storage.from('firmador-documents').createSignedUrl(version.storage_path,ttl,{download:filename});
    if (error || !data?.signedUrl) throw new Error(FINAL_LINK_ERROR);
    return Response.json({url:data.signedUrl},{headers});
  } catch(error) {
    return Response.json({error:error instanceof BudgetError?error.message:FINAL_LINK_ERROR},{status:error instanceof BudgetError?error.status:404,headers});
  }
}));
