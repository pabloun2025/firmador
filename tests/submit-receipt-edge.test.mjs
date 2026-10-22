import {afterEach,beforeEach,it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({client:null}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>state.client}));
// PDF analysis is unreachable on a receipt-only retry; fail if it is called.
vi.mock('../supabase/functions/_shared/pdf-validation.ts',()=>({
  inspectPdf:()=>{throw new Error('Unexpected analysis on receipt recovery');},
  comparePdfProfiles:()=>{throw new Error('Unexpected analysis on receipt recovery');},
  validateRelatedSize:()=>{throw new Error('Unexpected analysis on receipt recovery');},
}));
let handler,queryTables,unavailable;
const id='22222222-2222-4222-8222-222222222222';
beforeEach(async()=>{
  vi.resetModules();queryTables=[];unavailable=false;
  state.client={
    rpc:async(name)=>({data:name==='reserve_security_budget'?{allowed:true}:{state:'accepted',receipt_id:'stable-receipt',version_id:'version',sha256:'synthetic'},error:null}),
    from(table){queryTables.push(table);const query={select:()=>query,eq:()=>query,single:async()=>({data:unavailable?null:{enabled:true},error:unavailable?{message:'private failure'}:null})};return query;},
    storage:{from:()=>{throw new Error('Storage must not be accessed on accepted retry');}},
  };
  vi.stubGlobal('Deno',{env:{get:name=>({SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic'})[name]},serve:fn=>handler=fn});
  await import('../supabase/functions/submit-signed-version/index.ts');
});
afterEach(()=>vi.unstubAllGlobals());
function request(){const form=new FormData();form.set('id',id);form.set('sessionId','synthetic-capability');form.set('reviewedPrevious','true');form.set('document',new File(['%PDF-synthetic-retry'],'Contrato_signed.pdf',{type:'application/pdf'}));return new Request('https://local.test/submit',{method:'POST',body:form});}
it('recovers receipt before requiring the old workflow, invitation, or turn',async()=>{
  const response=await handler(request());expect(response.status).toBe(200);expect((await response.json()).receipt_id).toBe('stable-receipt');
  expect(queryTables).toEqual(['signature_inventory_settings']);expect(response.headers.get('cache-control')).toBe('no-store');
});
it('fails closed rather than silently taking the legacy route on flag lookup failure',async()=>{
  unavailable=true;const response=await handler(request());expect(response.status).toBe(400);const body=await response.json();expect(body).not.toHaveProperty('state');expect(body.error).not.toContain('private failure');
});
