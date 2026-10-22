import './signature-inventory.css';

type Inventory = {signature_count:number;inherited_count:number;added_signature_id:string;policy:string};
type Signature = {signature_id:string;record:{field:string;declaredSigningTime:string|null;
  certificate:{subject:string;issuer:string};algorithms:{digest:string;signature:string};
  integrity:string;trust:string;revocation:string;certificateValidity:string}};
const labels:Record<string,string>={trusted:'Confiable',untrusted:'No confiable',not_evaluated:'No evaluada',
  good:'No revocado según la comprobación',revoked:'Revocado',unknown:'Desconocida',unavailable:'No disponible',
  valid_now:'Vigente actualmente',expired:'Vencido',not_yet_valid:'Todavía no vigente'};
const label=(value:string)=>labels[value]??'Sin información';

export function SignatureInventory({hash,inventory,signatures=[]}:{hash:string;inventory?:Inventory|null;signatures?:Signature[]}) {
  return <section className="signature-inventory" aria-label="Firmas digitales de esta versión">
    <p className="inventory-hash">SHA-256 <code title={hash}>{hash.slice(0,12)}…</code></p>
    {!inventory ? <p>Relación no comprobada: esta versión todavía no tiene un inventario criptográfico verificado.</p> : <>
      <p><strong>{inventory.signature_count} {inventory.signature_count===1?'firma digital':'firmas digitales'}</strong> · {inventory.inherited_count} heredadas · 1 añadida</p>
      <p>Integridad verificada · firmas anteriores conservadas.</p>
      <details>
        <summary>Ver detalles de las firmas</summary>
        <ul className="inventory-signatures">{signatures.map(signature=><li key={signature.signature_id}>
          <strong>{signature.record.certificate.subject||'Titular no indicado'}</strong>
          <p>{signature.signature_id===inventory.added_signature_id?'Añadida en esta versión':'Firma heredada'} · {signature.record.field}</p>
          <dl>
            <div><dt>Integridad criptográfica</dt><dd>{signature.record.integrity==='valid'?'Verificada':'No verificada'}</dd></div>
            <div><dt>Cadena de confianza</dt><dd>{label(signature.record.trust)}</dd></div>
            <div><dt>Vigencia del certificado</dt><dd>{label(signature.record.certificateValidity)}</dd></div>
            <div><dt>Revocación</dt><dd>{label(signature.record.revocation)}</dd></div>
            <div><dt>Emisor</dt><dd>{signature.record.certificate.issuer||'No indicado'}</dd></div>
            <div><dt>Algoritmos</dt><dd>{signature.record.algorithms.signature} / {signature.record.algorithms.digest}</dd></div>
            {signature.record.declaredSigningTime&&<div><dt>Fecha declarada por el firmante</dt><dd>{new Date(signature.record.declaredSigningTime).toLocaleString()}</dd></div>}
          </dl>
        </li>)}</ul>
        <p>La fecha declarada no equivale a un sello de tiempo verificado. Esta comprobación no determina la validez jurídica de la firma.</p>
      </details>
    </>}
  </section>;
}
