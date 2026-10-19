import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { finalShareToken } from '../supabase/functions/_shared/final-share.ts';
const fixture=vi.hoisted(()=>({client:null}));
vi.mock('@supabase/supabase-js',()=>({createClient:()=>fixture.client}));
const id='22222222-2222-4222-8222-222222222222', versionId='33333333-3333-4333-8333-333333333333';
let handler,workflow,version,budgetDenied,signed,failed,filters,ttl;
const req=(body,auth=false)=>new Request('https://local.test',{method:'POST',headers:auth?{Authorization:'Bearer synthetic-owner'}:{},body:JSON.stringify(body)});
const token=()=>finalShareToken('synthetic-service',id,versionId);
async function load(owner=false){await import(owner?'../supabase/functions/owner-final-share/index.ts':'../supabase/functions/download-final-share/index.ts');}
beforeEach(()=>{
  vi.resetModules();budgetDenied=false;signed=0;failed=false;filters=[];ttl=0;
  workflow={id,owner_id:'owner-a',title:'Acuerdo',status:'completed',current_version_id:versionId,final_file_delete_at:new Date(Date.now()+86400000).toISOString()};
  version={id:versionId,workflow_id:id,storage_path:`${id}/submissions/final.pdf`,byte_size:2048,validation_status:'accepted',discarded_at:null,delete_after:null};
  fixture.client={
    rpc:async(name,args)=>({data:{allowed:!(args.p_service==='downloads'&&budgetDenied)},error:null}),
    auth:{getUser:async()=>({data:{user:{id:'owner-a'}},error:null})},
    from(table){
      const conditions=[];const q={select(){return q;},eq(k,v){conditions.push(row=>row[k]===v);filters.push([table,k,v]);return q;},is(k,v){conditions.push(row=>row[k]===v);return q;},maybeSingle(){return q;},
        then(resolve){const row=table==='workflows'?workflow:version;return Promise.resolve({data:row&&conditions.every(c=>c(row))?row:null,error:failed?{message:'private database diagnostic'}:null}).then(resolve);}};return q;
    },
    storage:{from:()=>({createSignedUrl:async(path,seconds)=>{signed++;ttl=seconds;return {data:{signedUrl:'https://files.example.test/synthetic.pdf'},error:null};}})},
  };
  vi.stubGlobal('Deno',{env:{get:name=>({SUPABASE_URL:'https://local.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service'})[name]},serve:h=>{handler=h;}});
});
afterEach(()=>vi.unstubAllGlobals());
it('requires authenticated ownership before generating a final link',async()=>{
  await load(true);
  expect((await handler(req({id}))).status).toBe(401);
  workflow.owner_id='someone-else';expect((await handler(req({id},true))).status).toBe(404);
  workflow.owner_id='owner-a';const response=await handler(req({id},true));
  expect(response.status).toBe(200);expect((await response.json()).token).toBe(await token());
  expect(filters).toContainEqual(['workflows','owner_id','owner-a']);expect(signed).toBe(0);
});
it('returns only final metadata for a valid public capability',async()=>{
  await load();const response=await handler(req({id,token:await token()}));
  expect(response.status).toBe(200);expect(Object.keys(await response.json()).sort()).toEqual(['expiresAt','title']);expect(signed).toBe(0);
});
it('rejects missing or altered capabilities and nonfinal documents',async()=>{
  await load();expect((await handler(req({id}))).status).toBe(404);expect(filters).toHaveLength(0);
  expect((await handler(req({id,token:'a'.repeat(43)}))).status).toBe(404);
  workflow.status='active';expect((await handler(req({id,token:await token()}))).status).toBe(404);expect(signed).toBe(0);
});
it('rejects expired, deleted, superseded or unrelated final documents',async()=>{
  await load();const body={id,token:await token(),action:'download'};
  workflow.final_file_delete_at='2000-01-01';expect((await handler(req(body))).status).toBe(404);
  workflow.final_file_delete_at=new Date(Date.now()+60000).toISOString();
  version.delete_after='2000-01-01';expect((await handler(req(body))).status).toBe(404);
  version.delete_after=null;version.discarded_at=new Date().toISOString();expect((await handler(req(body))).status).toBe(404);
  version.discarded_at=null;version.workflow_id='other';expect((await handler(req(body))).status).toBe(404);
  version.workflow_id=id;workflow.current_version_id='other';expect((await handler(req(body))).status).toBe(404);
  workflow=null;expect((await handler(req(body))).status).toBe(404);expect(signed).toBe(0);
});
it('hides database failures and does not issue a URL when download budget is exhausted',async()=>{
  await load();const body={id,token:await token(),action:'download'};
  failed=true;const response=await handler(req(body));expect(response.status).toBe(404);expect(JSON.stringify(await response.json())).not.toContain('private database');
  failed=false;budgetDenied=true;expect((await handler(req(body))).status).toBe(429);expect(signed).toBe(0);
});
it('issues a short lived URL only for the final PDF and clamps it to retention expiry',async()=>{
  await load();workflow.final_file_delete_at=new Date(Date.now()+30000).toISOString();
  const response=await handler(req({id,token:await token(),action:'download'}));
  expect(response.status).toBe(200);expect((await response.json()).url).toBe('https://files.example.test/synthetic.pdf');expect(signed).toBe(1);expect(ttl).toBeGreaterThan(0);expect(ttl).toBeLessThanOrEqual(30);
});
