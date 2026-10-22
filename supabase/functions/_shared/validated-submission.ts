import type { InventoryReport } from './signature-inventory.ts';

type Receipt = { state: 'accepted'; receipt_id: string; version_id: string; sha256: string };
type Result = { data: any; error: unknown };
type Client = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  storage: { from(bucket: string): { upload(path: string, bytes: Uint8Array, options: {contentType:string;upsert:boolean}): PromiseLike<{error:unknown}> } };
};
type Options = {
  client: Client; workflowId: string; sessionHash: string; parentId: string;
  digest: string; bytes: Uint8Array; profile: {pageCount:number;pageDimensions:unknown[]};
  validate: () => Promise<InventoryReport>; reserveUpload: () => Promise<void>;
};
const pending = () => new Error('No pudimos confirmar la entrega. Conserva el PDF e inténtalo de nuevo; si ya se recibió, recuperaremos su recibo sin repetir la firma.');
const accepted = (value:any, digest:string):value is Receipt => value?.state==='accepted'
  && typeof value.receipt_id==='string' && typeof value.version_id==='string' && value.sha256===digest;

export async function submitValidatedVersion(o:Options):Promise<Receipt> {
  const reserved=await o.client.rpc('begin_signature_validation',{
    p_workflow_id:o.workflowId,p_session_hash:o.sessionHash,p_parent_id:o.parentId,p_signed_sha256:o.digest,p_byte_size:o.bytes.length,
  });
  if(reserved.error)throw new Error('Tu entrega no está disponible o ya se está comprobando. Conserva el PDF e inténtalo de nuevo en un momento.');
  if(accepted(reserved.data,o.digest))return reserved.data;
  const ticket=reserved.data;
  if(ticket?.state!=='reserved'||typeof ticket.claim_id!=='string'||typeof ticket.lease_token!=='string'||typeof ticket.storage_path!=='string')throw pending();
  let report:InventoryReport;
  try {report=await o.validate();}
  catch(error){
    // No PDF upload has started: releasing this fenced reservation is safe and
    // lets the user correct a file without waiting for the 120-second lease.
    try {await o.client.rpc('release_signature_validation',{p_claim_id:ticket.claim_id,p_lease_token:ticket.lease_token});}catch {/* Lease still expires normally. */}
    throw error;
  }
  await o.reserveUpload();
  const uploaded=await o.client.storage.from('firmador-documents').upload(ticket.storage_path,o.bytes,{contentType:'application/pdf',upsert:false});
  if(uploaded.error)throw new Error('No pudimos guardar el PDF firmado. Conserva el archivo e inténtalo de nuevo.');
  // Never delete on uncertain commit: the transaction may have accepted the file.
  try {
    const result=await o.client.rpc('commit_signature_validation',{
      p_claim_id:ticket.claim_id,p_lease_token:ticket.lease_token,p_report:report,
      p_page_count:o.profile.pageCount,p_page_dimensions:o.profile.pageDimensions,
    });
    if(!result.error&&accepted(result.data,o.digest))return result.data;
  } catch { /* Recover by capability, not by an expired or advanced turn. */ }
  try {
    const result=await o.client.rpc('get_signature_receipt',{
      p_workflow_id:o.workflowId,p_session_hash:o.sessionHash,p_signed_sha256:o.digest,
    });
    if(!result.error&&accepted(result.data,o.digest))return result.data;
  } catch { /* No evidence of acceptance, do not advance the UI. */ }
  throw pending();
}
