import { isRelatedDocumentName } from "./document-name";

export function reviewSignedUpload(
  file: { name: string; size: number },
  expectedFilename: string,
  parentByteSize: number | null,
) {
  if (expectedFilename && !isRelatedDocumentName(expectedFilename, file.name)) {
    return "El nombre del archivo que intentas subir no corresponde al nombre original.";
  }
  if (
    parentByteSize &&
    (file.size < parentByteSize * 0.8 ||
      file.size > parentByteSize + Math.max(3 * 1024 * 1024, parentByteSize * 0.75))
  ) {
    return "Este archivo tiene un tamaño muy distinto al PDF descargado. Comprueba que seleccionaste el documento correcto.";
  }
  return "";
}
