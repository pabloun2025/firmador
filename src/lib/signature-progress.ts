export type SignatureView = {
  status?: string;
  names?: string[];
  addedNames?: string[];
};

const list = (values?: string[]) => (values ?? []).filter((value) => value.trim()).join(", ");

export function signatureHeadline(signatures?: SignatureView | null) {
  if (!signatures?.status) return null;
  const present = list(signatures.names);
  const added = list(signatures.addedNames);
  if (signatures.status === "unreadable") {
    return { name: "No se pudieron leer las firmas", note: "El documento se aceptó. Ábrelo para revisarlo." };
  }
  if (signatures.status === "no_new_signature") {
    return {
      name: present || "Sin firma nueva",
      note: present ? "No hay una firma nueva. Estos nombres ya estaban en el PDF." : "No aparece una firma nueva en este PDF.",
    };
  }
  if (signatures.status !== "detected") return null;
  return {
    name: added || present || "Nombre no disponible",
    note: present && added && present !== added
      ? `En el PDF figuran: ${present}.`
      : "Nombre leído del PDF. LeapSign no certifica la firma.",
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
