import './signature-inventory.css';

type Inventory = {signature_count:number;inherited_count:number;added_signature_id:string;policy:string};
type Signature = {signature_id:string;record:{field:string;declaredSigningTime:string|null;
  certificate:{subject:string;issuer:string};algorithms:{digest:string;signature:string};
  integrity:string;trust:string;revocation:string;certificateValidity:string}};

export function SignatureInventory({hash,inventory,signatures=[]}:{hash:string;inventory?:Inventory|null;signatures?:Signature[]}) {
  return <section className="signature-inventory" aria-label="Firmas digitales de esta versión">
    <p className="inventory-hash">SHA-256 <code title={hash}>{hash.slice(0,12)}…</code></p>
    {!inventory ? <p>No hay información de firmas disponible para esta versión.</p> : <>
      <p><strong>{inventory.signature_count} {inventory.signature_count===1?'firma detectada':'firmas detectadas'}</strong> · {inventory.inherited_count} anteriores · 1 añadida</p>
      <details>
        <summary>Ver detalles de las firmas</summary>
        <ul className="inventory-signatures">{signatures.map(signature=><li key={signature.signature_id}>
          <strong>Nombre en la firma: {signature.record.certificate.subject||'Nombre no disponible'}</strong>
          <p>{signature.signature_id===inventory.added_signature_id?'Añadida en esta versión':'Firma heredada'} · {signature.record.field}</p>
        </li>)}</ul>
        <p>No se verifica la validez de las firmas ni la identidad de sus titulares. Los nombres se leen del documento.</p>
      </details>
    </>}
  </section>;
}
