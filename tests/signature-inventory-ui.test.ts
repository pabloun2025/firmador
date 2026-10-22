import { describe,it,expect } from 'vitest';
import { existsSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

async function render(inventory:any=null,signatures:any[]=[]) {
  expect(existsSync('src/components/SignatureInventory.tsx')).toBe(true);
  const { SignatureInventory }=await import('../src/components/SignatureInventory');
  return renderToStaticMarkup(createElement(SignatureInventory,{hash:'a'.repeat(64),inventory,signatures}));
}
const inventory={signature_count:3,inherited_count:2,added_signature_id:'s3',policy:'leapsign-v1.1-integrity-offline-1'};
const signatures=[{signature_id:'s3',record:{id:'s3',field:'Signature3',declaredSigningTime:null,
  certificate:{subject:'<script>Nombre sintético</script>',issuer:'CA de pruebas',serial:'secret-unneeded-serial'},
  algorithms:{digest:'sha256',signature:'ecdsa'},integrity:'valid',trust:'not_evaluated',revocation:'unknown',certificateValidity:'expired'}}];
describe('owner signature inventory UI',()=>{
 it('labels historical versions honestly instead of inventing validation',async()=>{
   const html=await render();expect(html).toContain('Relación no comprobada');expect(html).not.toContain('Integridad verificada');expect(html).toContain('aaaaaaaaaaaa');
 });
 it('separates total signatures from received turns and preserves independent dimensions',async()=>{
   const html=await render(inventory,signatures);expect(html).toContain('3 firmas digitales');expect(html).toContain('2 heredadas');expect(html).toContain('1 añadida');
   expect(html).toContain('Integridad verificada');expect(html).toContain('No evaluada');expect(html).toContain('Desconocida');expect(html).toContain('Vencido');expect(html).toContain('no determina la validez jurídica');
 });
 it('uses a native disclosure and escapes certificate text without showing unnecessary identifiers',async()=>{
   const html=await render(inventory,signatures);expect(html).toContain('<details');expect(html).toContain('<summary');expect(html).not.toContain('<script>');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('secret-unneeded-serial');
 });
});
