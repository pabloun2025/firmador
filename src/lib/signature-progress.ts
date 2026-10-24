export type SignatureView = {
  status?: string;
  names?: string[];
  addedNames?: string[];
};

const list = (values?: string[]) => (values ?? []).filter((value) => value.trim()).join(", ");

export function signatureHeadline(signatures?: SignatureView | null) {
  if (!signatures?.status) return null;
  const names = (signatures.names ?? []).map((value) => value.trim()).filter(Boolean);
  const added = (signatures.addedNames ?? []).map((value) => value.trim()).filter(Boolean);
  const present = names.join(", ");
  const addedText = added.join(", ");
  const earlier = names.filter((name) => !added.includes(name)).join(", ");
  if (signatures.status === "unreadable") {
    return { label: "Firmas de este PDF", name: "No se pudieron leer", note: "El documento se aceptó. Ábrelo para revisarlo.", caveat: "" };
  }
  if (signatures.status === "no_new_signature") {
    return {
      label: "Firma nueva",
      name: "No hay una firma nueva",
      note: present ? `Estos nombres ya estaban en el PDF: ${present}.` : "No aparece una firma nueva en este PDF.",
      caveat: "",
    };
  }
  if (signatures.status !== "detected") return null;
  return {
    label: addedText ? (added.length > 1 ? "Las firmas añadidas en esta versión son" : "La última firma añadida es") : "Firmas leídas del PDF",
    name: addedText || present || "Nombre no disponible",
    note: earlier ? `También figuran: ${earlier}.` : addedText ? "Es la única firma que aparece en este PDF." : present ? `En el PDF figuran: ${present}.` : "",
    caveat: "LeapSign lee el nombre del PDF. No certifica la firma.",
  };
}

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
