import { PDFDocument, PDFName, PDFString } from 'npm:pdf-lib@1.17.1';
import { comparePdfProfiles, inspectPdf, validateRelatedSize } from '../supabase/functions/_shared/pdf-validation.ts';

function assert(condition: boolean, message: string) { if (!condition) throw new Error(message); }
async function expectFailure(operation: () => unknown | Promise<unknown>, message: string) {
  try { await operation(); } catch (error) {
    assert(error instanceof Error && error.message.includes(message), `Unexpected error: ${error}`);
    return;
  }
  throw new Error(`Expected rejection: ${message}`);
}

Deno.test('reads the page profile without altering any input PDF bytes', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([200, 300]);
  const bytes = await pdf.save(); const original = bytes.slice();
  const profile = await inspectPdf(bytes);
  assert(profile.pageCount === 1 && profile.pageDimensions[0].width === 200 && profile.pageDimensions[0].height === 300, 'Wrong profile');
  assert(bytes.every((byte, index) => byte === original[index]), 'PDF bytes were modified');
});
Deno.test('rejects invalid and corrupt PDF bytes', async () => {
  await expectFailure(() => inspectPdf(new TextEncoder().encode('not a PDF')), 'PDF válido');
  await expectFailure(() => inspectPdf(new TextEncoder().encode('%PDF-1.7 broken')), 'dañado');
});
Deno.test('rejects JavaScript inside compressed PDF object streams', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([200, 300]);
  const action = pdf.context.obj({ Type: 'Action', S: 'JavaScript', JS: PDFString.of('void 0;') });
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.register(action));
  const bytes = await pdf.save({ useObjectStreams: true });
  await expectFailure(() => inspectPdf(bytes), 'contenido activo');
});
Deno.test('rejects attachments encoded in compressed PDF objects', async () => {
  const pdf = await PDFDocument.create(); pdf.addPage([200, 300]);
  await pdf.attach(new Uint8Array([1, 2, 3]), 'fixture.txt', { mimeType: 'text/plain' });
  const bytes = await pdf.save({ useObjectStreams: true });
  await expectFailure(() => inspectPdf(bytes), 'contenido activo');
});
Deno.test('rejects page changes while allowing the existing dimensional tolerance', async () => {
  const original = { pageCount: 1, pageDimensions: [{ width: 200, height: 300 }] };
  comparePdfProfiles(original, { pageCount: 1, pageDimensions: [{ width: 200.5, height: 300 }] });
  await expectFailure(() => comparePdfProfiles(original, { pageCount: 2, pageDimensions: [{ width: 200, height: 300 }] }), 'número de páginas');
  await expectFailure(() => comparePdfProfiles(original, { pageCount: 1, pageDimensions: [{ width: 210, height: 300 }] }), 'tamaño');
});
Deno.test('rejects implausible size changes without requiring certificate interpretation', async () => {
  validateRelatedSize(1000, 1200);
  await expectFailure(() => validateRelatedSize(1000, 100), 'más pequeño');
  await expectFailure(() => validateRelatedSize(1000, 4000000), 'demasiado grande');
});
