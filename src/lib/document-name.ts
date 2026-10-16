const removableWords = new Set([
  "firmado", "firmada", "firmados", "firmadas", "firma", "signed", "signature",
  "sign", "signing", "final", "finalizado", "finalizada", "version", "copia", "copy",
  "digital", "electronica", "electronico", "electronic", "electronically", "esign",
  "esigned", "completed", "complete", "executed", "validado", "validada", "validated",
  "aprobado", "aprobada", "approved", "certified", "sellado", "sellada", "stamped",
  "escaneado", "escaneada", "scanned", "scan", "docusign", "adobesign", "smallpdf",
]);

export function documentFilename(value: string) {
  const stem = value
    .replace(/\.pdf$/i, "")
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+|[. ]+$/g, "")
    .slice(0, 150)
    .trim();
  return `${stem || "Documento"}.pdf`;
}

export function normalizeDocumentName(value: string) {
  return value
    .replace(/\.pdf$/i, "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !removableWords.has(word) && !/^v\d+$/.test(word))
    .join("");
}

function editDistance(first: string, second: string) {
  const row = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    let previous = row[0];
    row[0] = firstIndex;
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const saved = row[secondIndex];
      row[secondIndex] = Math.min(
        row[secondIndex] + 1,
        row[secondIndex - 1] + 1,
        previous + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1),
      );
      previous = saved;
    }
  }
  return row[second.length];
}

export function isRelatedDocumentName(expected: string, candidate: string) {
  const expectedName = normalizeDocumentName(expected);
  const candidateName = normalizeDocumentName(candidate);
  if (!expectedName || !candidateName) return false;
  if (expectedName === candidateName) return true;
  const longest = Math.max(expectedName.length, candidateName.length);
  return longest >= 5 && 1 - editDistance(expectedName, candidateName) / longest >= 0.70;
}
