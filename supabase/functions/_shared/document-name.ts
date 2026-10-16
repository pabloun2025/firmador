const removableWords = new Set([
  "firmado", "firmada", "firmados", "firmadas", "firma", "signed", "signature",
  "sign", "final", "copia", "copy", "digital", "electronica", "electronico",
]);

export function safeDocumentName(value: string) {
  const stem = value.replace(/\.pdf$/i, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 150) || "documento";
  return `${stem}.pdf`;
}

function normalize(value: string) {
  return value.replace(/\.pdf$/i, "").replace(/\s*\(\d+\)\s*$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(word => word && !removableWords.has(word)).join("");
}

function editDistance(first: string, second: string) {
  const row = Array.from({ length: second.length + 1 }, (_, index) => index);
  for (let firstIndex = 1; firstIndex <= first.length; firstIndex += 1) {
    let previous = row[0]; row[0] = firstIndex;
    for (let secondIndex = 1; secondIndex <= second.length; secondIndex += 1) {
      const saved = row[secondIndex];
      row[secondIndex] = Math.min(row[secondIndex] + 1, row[secondIndex - 1] + 1, previous + (first[firstIndex - 1] === second[secondIndex - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[second.length];
}

export function validateRelatedDocumentName(expected: string, candidate: string) {
  const expectedName = normalize(expected); const candidateName = normalize(candidate);
  const longest = Math.max(expectedName.length, candidateName.length);
  const related = Boolean(expectedName && candidateName) && (
    expectedName === candidateName
    || (Math.min(expectedName.length, candidateName.length) >= 5 && (expectedName.includes(candidateName) || candidateName.includes(expectedName)))
    || (longest >= 5 && 1 - editDistance(expectedName, candidateName) / longest >= 0.68)
  );
  if (!related) throw new Error(`El nombre del archivo no se parece al documento descargado (${safeDocumentName(expected)}). Conserva el nombre y añade, si quieres, “firmado” o “signed”.`);
}
