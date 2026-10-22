import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';

async function subject() {
  expect(existsSync('supabase/functions/_shared/validated-submission.ts')).toBe(true);
  return import('../supabase/functions/_shared/validated-submission');
}
function fixture() {
  const receipt={state:'accepted',receipt_id:'receipt',version_id:'version',sha256:'b'.repeat(64)};
  const reserve={state:'reserved',claim_id:'claim',lease_token:'lease',storage_path:'private/attempt.pdf'};
  const rpc=vi.fn(async(name:string,_args:Record<string,unknown>):Promise<{data:any;error:any}>=>({data:name==='begin_signature_validation'?reserve:receipt,error:null}));
  const upload=vi.fn(async(_path:string,_bytes:Uint8Array,_options:unknown):Promise<{error:any}>=>({error:null}));
  const validate=vi.fn(async():Promise<any>=>({accepted:true}));
  const quota=vi.fn(async()=>{});
  const client={rpc,storage:{from:vi.fn(()=>({upload}))}};
  const options={client,workflowId:'workflow',sessionHash:'s'.repeat(64),parentId:'parent',digest:'b'.repeat(64),bytes:new Uint8Array([1,2,3]),profile:{pageCount:1,pageDimensions:[[595,842]]},validate,reserveUpload:quota};
  return {receipt,reserve,rpc,upload,validate,quota,options};
}
describe('validated submission orchestration (mocked I/O; real SQL tested separately)',()=>{
  it('reserves before crypto and uploads before atomic commit',async()=>{
    const f=fixture();expect(await (await subject()).submitValidatedVersion(f.options)).toEqual(f.receipt);
    expect(f.rpc.mock.invocationCallOrder[0]).toBeLessThan(f.validate.mock.invocationCallOrder[0]);
    expect(f.validate.mock.invocationCallOrder[0]).toBeLessThan(f.quota.mock.invocationCallOrder[0]);
    expect(f.upload.mock.invocationCallOrder[0]).toBeLessThan(f.rpc.mock.invocationCallOrder[1]);
    expect(f.upload.mock.calls[0][2]).toEqual({contentType:'application/pdf',upsert:false});
  });
  it('returns stable accepted receipt without crypto or upload on retry',async()=>{
    const f=fixture();f.rpc.mockResolvedValue({data:f.receipt as any,error:null});
    expect(await (await subject()).submitValidatedVersion(f.options)).toEqual(f.receipt);
    expect(f.validate).not.toHaveBeenCalled();expect(f.upload).not.toHaveBeenCalled();
  });
  it('never uploads or commits when validation is uncertain',async()=>{
    const f=fixture();f.validate.mockRejectedValue(new Error('timeout'));
    await expect((await subject()).submitValidatedVersion(f.options)).rejects.toThrow();
    expect(f.upload).not.toHaveBeenCalled();expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('does not commit on upload failure',async()=>{
    const f=fixture();f.upload.mockResolvedValue({error:{} as any});
    await expect((await subject()).submitValidatedVersion(f.options)).rejects.toThrow();expect(f.rpc).toHaveBeenCalledTimes(1);
  });
  it('recovers the receipt on an uncertain commit without deleting any PDF',async()=>{
    const f=fixture();f.rpc.mockImplementation(async name=>{
      if(name==='begin_signature_validation')return {data:f.reserve,error:null};
      if(name==='commit_signature_validation')throw new Error('connection lost');
      return {data:f.receipt,error:null};
    });
    expect(await (await subject()).submitValidatedVersion(f.options)).toEqual(f.receipt);
    expect(f.rpc.mock.calls[2][0]).toBe('get_signature_receipt');
    expect(f.options.client.storage.from.mock.results[0].value).not.toHaveProperty('remove');
  });
  it('does not report acceptance when neither commit nor receipt can be confirmed',async()=>{
    const f=fixture();f.rpc.mockImplementation(async name=>({data:name==='begin_signature_validation'?f.reserve:null,error:name==='begin_signature_validation'?null:{} as any}));
    await expect((await subject()).submitValidatedVersion(f.options)).rejects.toThrow('Conserva');
    expect(f.rpc).toHaveBeenCalledTimes(3);
  });
});
