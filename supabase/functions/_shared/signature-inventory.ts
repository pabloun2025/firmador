import {reserveBudget,reserveDownload,type BudgetClient} from './economic-guard.ts';

const POLICY='leapsign-v1.1-integrity-offline-1';
const MAX_PDF=10*1024*1024,MAX_RESPONSE=262144;
export class InventoryUnavailable extends Error {
  constructor(readonly code='SIGNATURE_VALIDATION_UNAVAILABLE') {super('No pudimos comprobar la nueva firma digital. Conserva el archivo e inténtalo de nuevo.');}
}
export type SignatureRecord={id:string;field:string;revision:number;byteRange:number[];declaredSigningTime:string|null;
  certificate:{subject:string;issuer:string;serial:string;fingerprint:string;notBefore:string;notAfter:string};
  algorithms:{digest:string;signature:string};integrity:'valid';trust:string;revocation:string;certificateValidity:string;
  coverage:string;subsequentChanges:'allowed';codes:string[]};
export type InventoryReport={policy:typeof POLICY;accepted:true;baseSha256:string;signedSha256:string;signatureCount:number;
  inheritedCount:number;addedSignatureIds:string[];previousSignaturesIntact:true;signatures:SignatureRecord[]};
type Options={enabled:boolean;url?:string;token?:string;client:BudgetClient;ownerId:string;parentId:string;parentSize:number;parentHash:string;
  candidate:Uint8Array;loadParent:()=>Promise<Uint8Array>;fetch?:typeof fetch};
const hex=(v:unknown):v is string=>typeof v==='string' && /^[a-f0-9]{64}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>v!==null && typeof v==='object' && !Array.isArray(v);
const exact=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===keys.sort().join(',');
const text=(v:unknown,max:number):v is string=>typeof v==='string'&&v.length<=max;
const date=(v:unknown)=>text(v,64)&&Number.isFinite(Date.parse(v));
const integer=(v:unknown,min:number,max:number)=>Number.isInteger(v)&&Number(v)>=min&&Number(v)<=max;
const digest=async(bytes:Uint8Array)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer))].map(b=>b.toString(16).padStart(2,'0')).join('');
function validReport(v:unknown,base:string,signed:string,byteSize:number):v is InventoryReport {
  if(!object(v)||!exact(v,['policy','accepted','baseSha256','signedSha256','signatureCount','inheritedCount','addedSignatureIds','previousSignaturesIntact','signatures'])||v.policy!==POLICY||v.accepted!==true||v.previousSignaturesIntact!==true||v.baseSha256!==base||v.signedSha256!==signed||!integer(v.signatureCount,1,64)||!integer(v.inheritedCount,0,63)||v.signatureCount!==Number(v.inheritedCount)+1||!Array.isArray(v.addedSignatureIds)||v.addedSignatureIds.length!==1||!hex(v.addedSignatureIds[0])||!Array.isArray(v.signatures)||v.signatures.length!==v.signatureCount)return false;
  const ids=new Set<string>();
  for(const s of v.signatures){
    if(!object(s)||!exact(s,['id','field','revision','byteRange','declaredSigningTime','certificate','algorithms','integrity','trust','revocation','certificateValidity','coverage','subsequentChanges','codes'])||!hex(s.id)||ids.has(s.id)||!text(s.field,256)||!integer(s.revision,0,127)||!Array.isArray(s.byteRange)||s.byteRange.length!==4||!s.byteRange.every(x=>integer(x,0,MAX_PDF))||s.byteRange[0]!==0||s.byteRange[1]<1||s.byteRange[2]<=s.byteRange[1]||s.byteRange[3]<1||s.byteRange[2]+s.byteRange[3]>byteSize||(s.declaredSigningTime!==null&&!date(s.declaredSigningTime))||s.integrity!=='valid'||s.subsequentChanges!=='allowed')return false;
    if(!['trusted','untrusted','not_evaluated'].includes(String(s.trust))||!['good','revoked','unknown','unavailable','not_evaluated'].includes(String(s.revocation))||!['valid_now','expired','not_yet_valid'].includes(String(s.certificateValidity))||!['entire_file','entire_revision'].includes(String(s.coverage)))return false;
    const c=s.certificate,a=s.algorithms;
    if(!object(c)||!exact(c,['subject','issuer','serial','fingerprint','notBefore','notAfter'])||!text(c.subject,512)||!text(c.issuer,512)||!text(c.serial,128)||!hex(c.fingerprint)||!date(c.notBefore)||!date(c.notAfter)||Date.parse(String(c.notAfter))<=Date.parse(String(c.notBefore))||!object(a)||!exact(a,['digest','signature'])||!text(a.digest,64)||!text(a.signature,64)||!Array.isArray(s.codes)||s.codes.length>8||!s.codes.every(x=>text(x,80)&&/^[A-Z0-9_]+$/.test(x)))return false;
    ids.add(s.id);
  }
  const addedId=v.addedSignatureIds[0];
  const added=v.signatures.find(s=>s.id===addedId);
  return Boolean(added&&added.coverage==='entire_file');
}
const base64=(bytes:Uint8Array)=>{let value='';for(let i=0;i<bytes.length;i+=8192)value+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(value);};
export async function requestSignatureInventory(options:Options):Promise<InventoryReport|null> {
  if(!options.enabled)return null;
  try {
    if(!options.url||!options.token||options.token.length<32||!hex(options.parentHash)||!Number.isSafeInteger(options.parentSize)||options.parentSize<5||options.parentSize>MAX_PDF||options.candidate.length<5||options.candidate.length>MAX_PDF)throw new InventoryUnavailable();
    const url=new URL(options.url);
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/validate'||url.hostname==='leapsign.app'||url.hostname.endsWith('.leapsign.app')||url.hostname.includes('leapsign-v2'))throw new InventoryUnavailable();
    // Existing shared ledger service; new scopes do not bypass cumulative quota.
    await reserveBudget(options.client,'requests',[
      {scope:'shared:pdf-signature-validation',period:86400,amount:1,policy:'signature_validation_daily',limit:200},
      {scope:`owner-signature-validation:${options.ownerId}`,period:86400,amount:1,policy:'signature_validation_owner_daily',limit:50},
      {scope:'shared:pdf-signature-validation',period:60,amount:1,policy:'signature_validation_minute',limit:10},
    ]);
    await reserveDownload(options.client,options.parentId,options.parentSize);
    const parent=await options.loadParent();
    if(parent.length!==options.parentSize||await digest(parent)!==options.parentHash)throw new InventoryUnavailable('PARENT_HASH_MISMATCH');
    // Free Render may need 50+ seconds to start. One bounded request, no hidden
    // retries or keep-alive pings; the worker's crypto deadline remains 20 s.
    const signed=await digest(options.candidate),signal=AbortSignal.timeout(90000);
    const response=await (options.fetch??fetch)(url.href,{method:'POST',redirect:'error',cache:'no-store',signal,
      headers:{Authorization:`Bearer ${options.token}`,'Content-Type':'application/json'},
      body:JSON.stringify({previous:base64(parent),candidate:base64(options.candidate),baseSha256:options.parentHash})});
    if(!response.ok||response.redirected||!response.body||response.headers.get('Content-Type')?.split(';')[0]!=='application/json'){await response.body?.cancel();throw new InventoryUnavailable();}
    const length=response.headers.get('Content-Length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>MAX_RESPONSE)){await response.body.cancel();throw new InventoryUnavailable();}
    const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;let abort!:()=>void;
    const stopped=new Promise<never>((_,reject)=>{abort=()=>{void reader.cancel().catch(()=>{});reject(new InventoryUnavailable());};signal.addEventListener('abort',abort,{once:true});});
    try{
      if(signal.aborted)abort();
      while(true){const {done,value}=await Promise.race([reader.read(),stopped]);if(done)break;size+=value.length;if(size>MAX_RESPONSE)throw new InventoryUnavailable();chunks.push(value);}
      const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
      const result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
      if(!validReport(result,options.parentHash,signed,options.candidate.length))throw new InventoryUnavailable('INVALID_VALIDATOR_REPORT');
      return result;
    }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
  } catch(error){if(error instanceof InventoryUnavailable)throw error;throw new InventoryUnavailable();}
}
