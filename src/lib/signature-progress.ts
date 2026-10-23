export type SignatureView = {
  status?: string;
  names?: string[];
  addedNames?: string[];
};

const list = (values?: string[]) => (values ?? []).filter((value) => value.trim()).join(", ");

export function signatureReadout(signatures?: SignatureView | null) {
  if (!signatures?.status) return "";
  if (signatures.status === "unreadable") return "No se pudieron leer las firmas de este PDF.";
  const present = list(signatures.names);
  if (signatures.status === "no_new_signature") {
    return present ? `Sin firma nueva. Firmas ya presentes: ${present}.` : "Sin firma nueva en este PDF.";
  }
  if (signatures.status !== "detected") return "";
  const added = list(signatures.addedNames);
  const detected = present || "Nombre no disponible";
  return added ? `Firmas detectadas: ${detected}. Nueva: ${added}.` : `Firmas detectadas: ${detected}.`;
}
