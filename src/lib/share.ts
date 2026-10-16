export function whatsappShareUrl(title: string, url: string, note = "") {
  const documentTitle = title.trim() || "este documento";
  const personalNote = note.trim();
  const message = [
    `Hola, te invito a firmar «${documentTitle}» mediante LeapSign.`,
    personalNote ? `Mensaje: ${personalNote}` : "",
    `Accede al documento aquí: ${url}`,
  ].filter(Boolean).join("\n\n");

  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
