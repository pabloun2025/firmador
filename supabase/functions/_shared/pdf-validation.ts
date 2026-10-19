import { PDFArray, PDFDict, PDFDocument, PDFName, PDFObject, PDFStream } from "npm:pdf-lib@1.17.1";

export type PdfProfile = {
  pageCount: number;
  pageDimensions: Array<{ width: number; height: number }>;
};

const dangerousMarkers = ["/JavaScript", "/JS", "/Launch", "/EmbeddedFiles"];
const dangerousNames = new Set(dangerousMarkers.map(marker => marker.slice(1)));
const unsafePdfMessage = "El PDF contiene contenido activo o archivos adjuntos y no puede incorporarse.";

function rejectActiveObjects(pdf: PDFDocument) {
  // pdf-lib expands compressed object streams when loading. Inspect the parsed
  // names too, so compression and escaped PDF names cannot bypass the raw scan.
  // Never save/serialize the document: signed bytes must remain unchanged.
  const pending: PDFObject[] = pdf.context.enumerateIndirectObjects().map(([, object]) => object);
  const seen = new WeakSet<PDFObject>();
  while (pending.length) {
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    if (object instanceof PDFName && dangerousNames.has(object.decodeText())) throw new Error(unsafePdfMessage);
    if (object instanceof PDFDict) {
      for (const [key, value] of object.entries()) pending.push(key, value);
    } else if (object instanceof PDFArray) {
      for (const value of object.asArray()) pending.push(value);
    }
    else if (object instanceof PDFStream) pending.push(object.dict);
  }
}

function containsAscii(bytes: Uint8Array, value: string) {
  const needle = new TextEncoder().encode(value);
  outer: for (let index = 0; index <= bytes.length - needle.length; index += 1) {
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (bytes[index + offset] !== needle[offset]) continue outer;
    }
    return true;
  }
  return false;
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfProfile> {
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error("El archivo no parece ser un PDF válido.");
  }
  for (const marker of dangerousMarkers) {
    if (containsAscii(bytes, marker)) {
      throw new Error(unsafePdfMessage);
    }
  }
  try {
    const pdf = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
    rejectActiveObjects(pdf);
    const pages = pdf.getPages();
    if (!pages.length || pages.length > 500) throw new Error("Cantidad de páginas no válida.");
    return {
      pageCount: pages.length,
      pageDimensions: pages.map((page) => {
        const { width, height } = page.getSize();
        return { width: Math.round(width * 10) / 10, height: Math.round(height * 10) / 10 };
      }),
    };
  } catch (error) {
    if (error instanceof Error && (error.message === "Cantidad de páginas no válida." || error.message === unsafePdfMessage)) throw error;
    throw new Error("El PDF está cifrado, dañado o no se puede leer.");
  }
}

export function comparePdfProfiles(parent: PdfProfile, candidate: PdfProfile) {
  if (parent.pageCount !== candidate.pageCount) {
    throw new Error("El PDF firmado debe conservar el mismo número de páginas que el documento descargado.");
  }
  const changed = parent.pageDimensions.some((page, index) => {
    const next = candidate.pageDimensions[index];
    return !next || Math.abs(page.width - next.width) > 1 || Math.abs(page.height - next.height) > 1;
  });
  if (changed) {
    throw new Error("El PDF firmado cambió el tamaño o el orden de sus páginas.");
  }
}

export function validateRelatedSize(parentBytes: number, candidateBytes: number) {
  const minimum = Math.floor(parentBytes * 0.8);
  const maximum = parentBytes + Math.max(3 * 1024 * 1024, Math.floor(parentBytes * 0.75));
  if (candidateBytes < minimum) {
    throw new Error("El PDF cargado es considerablemente más pequeño que el documento descargado.");
  }
  if (candidateBytes > maximum) {
    throw new Error("El PDF cargado es demasiado grande en relación con el documento descargado.");
  }
}

