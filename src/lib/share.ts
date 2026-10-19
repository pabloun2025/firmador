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

export function finalShareMessage(title: string, url: string, expiresAt: string) {
  const expires = new Date(expiresAt);
  const deadline = expires.toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' });
  return `Hola, aquí tienes la versión final de «${title.trim() || 'Documento'}».\n\nDescarga el PDF finalizado: ${url}\n\nDisponible hasta el ${deadline} (hora de Madrid). No es una invitación para firmar.`;
}
export function finalWhatsappUrl(title: string, url: string, expiresAt: string) {
  return `https://wa.me/?text=${encodeURIComponent(finalShareMessage(title,url,expiresAt))}`;
}
export function finalEmailUrl(title: string, url: string, expiresAt: string) {
  return `mailto:?subject=${encodeURIComponent(`PDF finalizado · ${title.trim() || 'Documento'}`)}&body=${encodeURIComponent(finalShareMessage(title,url,expiresAt))}`;
}
