import {describe,it,expect,vi} from 'vitest';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';

// A missing implementation must fail an assertion before production code exists.
async function moduleUnderTest() {
  const {existsSync}=await import('node:fs');
  expect(existsSync('supabase/functions/_shared/signature-inventory.ts')).toBe(true);
  return import('../supabase/functions/_shared/signature-inventory');
}
const hash=async(bytes:Uint8Array)=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new Uint8Array(bytes).buffer)).toString('hex');
const parent=new TextEncoder().encode('%PDF-synthetic-parent');
const candidate=new TextEncoder().encode('%PDF-synthetic-parent\nsynthetic candidate, not real CMS');
async function fixture(){
 const base=await hash(parent),signed=await hash(candidate);
 const signature={id:'c'.repeat(64),field:'Signature_1',revision:1,byteRange:[0,10,20,candidate.length-20],declaredSigningTime:null,
   certificate:{subject:'Synthetic',issuer:'Synthetic',serial:'1',fingerprint:'d'.repeat(64),notBefore:'2026-01-01T00:00:00+00:00',notAfter:'2027-01-01T00:00:00+00:00'},
   algorithms:{digest:'sha256',signature:'rsassa_pkcs1v15'},integrity:'valid',trust:'not_evaluated',revocation:'unknown',certificateValidity:'valid_now',coverage:'entire_file',subsequentChanges:'allowed',codes:[]};
 const report={policy:'leapsign-v1.1-integrity-offline-1',accepted:true,baseSha256:base,signedSha256:signed,signatureCount:1,inheritedCount:0,addedSignatureIds:[signature.id],previousSignaturesIntact:true,signatures:[signature]};
 const loadParent=vi.fn(async()=>parent);
 const fetcher=vi.fn(async()=>Response.json(report));
 const client={rpc:vi.fn(async()=>({data:{allowed:true},error:null})),auth:{getUser:vi.fn()}};
 return {report,fetcher,client,loadParent,options:{enabled:true,url:'https://v1-validator.example/validate',token:'synthetic-token-at-least-32-characters',client,ownerId:'owner',parentId:'parent',parentSize:parent.length,parentHash:base,candidate,loadParent,fetch:fetcher}};
}
describe('v1 private inventory transport, mocked network not cryptographic proof',()=>{
 it('has no effect or cost when disabled',async()=>{const f=await fixture();const m=await moduleUnderTest();expect(await m.requestSignatureInventory({...f.options,enabled:false})).toBeNull();expect(f.client.rpc).not.toHaveBeenCalled();expect(f.fetcher).not.toHaveBeenCalled();expect(f.loadParent).not.toHaveBeenCalled();});
 it('reserves capacity before private download and validation',async()=>{const f=await fixture();const m=await moduleUnderTest();expect(await m.requestSignatureInventory(f.options)).toEqual(f.report);expect(f.client.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.loadParent.mock.invocationCallOrder[0]);expect(f.loadParent.mock.invocationCallOrder[0]).toBeLessThan(f.fetcher.mock.invocationCallOrder[0]);});
 it('never calls the validator when shared budget fails',async()=>{const f=await fixture();f.client.rpc.mockResolvedValue({data:{allowed:false},error:null});await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();expect(f.loadParent).not.toHaveBeenCalled();});
 it('rejects a changed parent before making an HTTP request',async()=>{const f=await fixture();f.loadParent.mockResolvedValue(new TextEncoder().encode('%PDF-unrelated'));await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();});
 it.each(['http://v1-validator.example/validate','https://pruebas.leapsign.app/validate','https://leapsign.app/validate','https://v1-validator.example/validate?token=hidden'])('rejects unsafe or v2 destinations',async url=>{const f=await fixture();await expect((await moduleUnderTest()).requestSignatureInventory({...f.options,url})).rejects.toThrow();expect(f.fetcher).not.toHaveBeenCalled();});
 it('sends only PDF bytes and bound hash, no P12 or password',async()=>{const f=await fixture();await (await moduleUnderTest()).requestSignatureInventory(f.options);const [,init]=f.fetcher.mock.calls[0] as unknown as [string,RequestInit];const body=JSON.parse(init.body as string);expect(Object.keys(body).sort()).toEqual(['baseSha256','candidate','previous']);expect(Buffer.from(body.previous,'base64')).toEqual(Buffer.from(parent));expect(init.redirect).toBe('error');expect(body).not.toHaveProperty('token');});
 it('allows a bounded cold start without retrying or multiplying the validation',async()=>{
   const f=await fixture();const timeout=vi.spyOn(AbortSignal,'timeout');
   await (await moduleUnderTest()).requestSignatureInventory(f.options);
   expect(timeout).toHaveBeenCalledWith(90000);expect(f.fetcher).toHaveBeenCalledTimes(1);timeout.mockRestore();
 });
 it.each(['accepted','baseSha256','signatureCount','previousSignaturesIntact'])('rejects inconsistent report field %s',async key=>{const f=await fixture();f.fetcher.mockImplementation(async()=>Response.json({...f.report,[key]:false}));await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.toThrow();});
 it('rejects report with private fields even on success',async()=>{const f=await fixture();f.fetcher.mockImplementation(async()=>Response.json({...f.report,password:'not-allowed'}));await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.toThrow();});
 it('normalizes unavailable server without leaking response body',async()=>{const f=await fixture();f.fetcher.mockImplementation(async()=>new Response('secret raw server text',{status:503}));await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.not.toThrow('secret raw');});
 it('caps response bytes instead of trusting content length',async()=>{const f=await fixture();f.fetcher.mockImplementation(async()=>new Response('x'.repeat(262145),{headers:{'Content-Type':'application/json'}}));await expect((await moduleUnderTest()).requestSignatureInventory(f.options)).rejects.toThrow();});
 it('does not depend on any v2 module',()=>{const source=readFileSync('supabase/functions/_shared/signature-inventory.ts','utf8');expect(source).not.toMatch(/from ['"].*v2/);});
});
