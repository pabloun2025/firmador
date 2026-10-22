// Bounded v1-only diagnostic. Never uploads PDFs or writes inventory/application
// rows. Quota reservations are the ONLY remote writes; no PDFs saved on disk.
import {spawnSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const args=process.argv.slice(2), flag=name=>args[args.indexOf(name)+1];
if(!args.includes('--output')||!args.includes('--python'))throw new Error('Use --output <private report.json> --python <venv/bin/python> [--after <version UUID>] [--limit 1..10]');
const limit=args.includes('--limit')?Number(flag('--limit')):5;
const after=args.includes('--after')?flag('--after'):null;
if(!Number.isInteger(limit)||limit<1||limit>10||(after&&!/^[a-f0-9-]{36}$/.test(after)))throw new Error('Invalid bounded cursor/limit');
const root=fileURLToPath(new URL('..',import.meta.url));
const output=resolve(flag('--output'));
if(output.startsWith(resolve(root)+'/'))throw new Error('Keep reports outside checkout; they contain public certificate data');
const host='https://lgsdoutarthfymbjgdrj.supabase.co';
if(!process.env.SUPABASE_ACCESS_TOKEN)throw new Error('Existing v1 management credential is required');
let v1DatabaseKey;
function curl(url,{management=false,body,max=10485760}={}){
  const headers=management?['-H',`Authorization: Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`]:['-H',`apikey: ${v1DatabaseKey}`,'-H',`Authorization: Bearer ${v1DatabaseKey}`];
  const call=spawnSync('curl',['-sS','--fail','--max-time','30','--max-filesize',String(max),...headers,...(body?['-H','Content-Type: application/json','--data',JSON.stringify(body)]:[]),url],{encoding:null,maxBuffer:max+1024,timeout:35000});
  if(call.status!==0)throw new Error('V1_REMOTE_READ_UNAVAILABLE');
  return call.stdout;
}
// Read an EXISTING key for the pinned v1 project using its authorized management
// credential. Never rotate, persist, print it or borrow any v2 credential.
const keys=JSON.parse(curl('https://api.supabase.com/v1/projects/lgsdoutarthfymbjgdrj/api-keys',{management:true,max:65536}));
v1DatabaseKey=keys.find(key=>key.name==='service_role'&&key.type==='legacy')?.api_key;
if(typeof v1DatabaseKey!=='string'||!v1DatabaseKey)throw new Error('Existing v1 service key is unavailable');
function reserve(service,rules){
  const result=JSON.parse(curl(`${host}/rest/v1/rpc/reserve_security_budget`,{body:{p_service:service,p_rules:rules},max:65536}));
  if(!result.allowed)throw new Error('V1_HISTORY_BUDGET_EXHAUSTED');
}
reserve('requests',[
  {scope:'shared:requests',period:86400,amount:1,policy:'requests_daily',limit:50000},
  {scope:'shared:signature-history-dry-run',period:86400,amount:limit,policy:'signature_history_daily',limit:20},
]);
const query=`select v.id,v.sha256,v.byte_size,v.storage_path,v.workflow_id,v.parent_version_id,v.discarded_at,p.sha256 parent_sha256,p.byte_size parent_size,p.storage_path parent_path,p.discarded_at parent_discarded_at
from public.document_versions v left join public.document_versions p on p.id=v.parent_version_id and p.workflow_id=v.workflow_id
${after?`where v.id>'${after}'::uuid`:''} order by v.id limit ${limit}`;
const rows=JSON.parse(curl('https://api.supabase.com/v1/projects/lgsdoutarthfymbjgdrj/database/query',{management:true,body:{query,read_only:true},max:65536}));
function download(id,path,size,discarded){
  if(discarded||typeof path!=='string'||!Number.isInteger(size)||size<5||size>10485760||path.split('/').some(p=>!p||p==='.'||p==='..'))return null;
  reserve('downloads',[
    {scope:'shared:download-issuance-bytes',period:86400,amount:size,policy:'download_issuance_bytes_daily',limit:2147483648},
    {scope:`download-version:${id}`,period:86400,amount:size,policy:'version_download_issuance_bytes_daily',limit:524288000},
  ]);
  try{
    const bytes=curl(`${host}/storage/v1/object/authenticated/firmador-documents/${path.split('/').map(encodeURIComponent).join('/')}`);
    return bytes.length===size?bytes:null;
  }catch{return null;}
}
const results=[];
for(const row of rows){
  const pdf=download(row.id,row.storage_path,row.byte_size,row.discarded_at);
  const parent=pdf&&row.parent_version_id?download(row.parent_version_id,row.parent_path,row.parent_size,row.parent_discarded_at):null;
  // Require the exact stored parent hash, not merely the bytes fetched at a path.
  let parentBytes=parent;
  if(parent){const {createHash}=await import('node:crypto');if(createHash('sha256').update(parent).digest('hex')!==row.parent_sha256)parentBytes=null;}
  const child=spawnSync(flag('--python'),['-m','validator.history_worker'],{cwd:root,env:{PYTHONPATH:root},
    input:JSON.stringify({versionId:row.id,sha256:row.sha256,pdf:pdf?.toString('base64')??null,parent:parentBytes?.toString('base64')??null}),
    encoding:'utf8',timeout:20000,maxBuffer:262144});
  if(child.status!==0)results.push({versionId:row.id,status:'analysis_unavailable',relationship:'not_proven'});
  else {try{results.push(JSON.parse(child.stdout));}catch{results.push({versionId:row.id,status:'analysis_unavailable',relationship:'not_proven'});}}
}
const report={mode:'dry-run',applicationRowsWritten:0,pdfsStored:0,emailsSent:0,turnsAdvanced:0,generatedAt:new Date().toISOString(),nextCursor:rows.at(-1)?.id??after,results};
writeFileSync(output,JSON.stringify(report,null,2),{mode:0o600,flag:'wx'});
console.log(JSON.stringify({mode:report.mode,versions:results.length,inventoried:results.filter(r=>r.status==='inventoried').length,relationshipsProven:results.filter(r=>r.relationship==='verified_incremental').length,applicationRowsWritten:0,pdfsStored:0,report:output}));
