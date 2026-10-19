// No public ACL or permanent Storage URL: a capability bound to one final version.
export const FINAL_LINK_ERROR = 'Este enlace no está disponible o ha caducado.';
export async function finalShareToken(secret: string, workflowId: string, versionId: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`leapsign:final-share:v1:${workflowId}:${versionId}`)));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function equalFinalToken(provided: unknown, expected: string) {
  if (typeof provided !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(provided)) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}
export async function finalDocument(admin: any, id: unknown, ownerId?: string) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) throw new Error(FINAL_LINK_ERROR);
  let query = admin.from('workflows').select('id,owner_id,title,status,current_version_id,final_file_delete_at').eq('id',id);
  if (ownerId) query = query.eq('owner_id',ownerId);
  const { data: workflow, error } = await query.maybeSingle();
  if (error || !workflow || workflow.status !== 'completed' || !workflow.current_version_id || !Number.isFinite(Date.parse(workflow.final_file_delete_at)) || Date.parse(workflow.final_file_delete_at) <= Date.now()) throw new Error(FINAL_LINK_ERROR);
  const result = await admin.from('document_versions').select('id,storage_path,byte_size,delete_after').eq('id',workflow.current_version_id).eq('workflow_id',id).eq('validation_status','accepted').is('discarded_at',null).maybeSingle();
  const version = result.data;
  if (result.error || !version || typeof version.storage_path !== 'string' || !version.storage_path.startsWith(`${id}/`) || (version.delete_after && (!Number.isFinite(Date.parse(version.delete_after)) || Date.parse(version.delete_after) <= Date.now()))) throw new Error(FINAL_LINK_ERROR);
  const expiresAt = new Date(Math.min(Date.parse(workflow.final_file_delete_at),version.delete_after ? Date.parse(version.delete_after) : Infinity)).toISOString();
  return { workflow, version, expiresAt };
}
