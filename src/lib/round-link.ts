const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMPACT_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function compactRoundId(id: string) {
  if (!UUID_PATTERN.test(id)) return id;
  const pairs = id.replaceAll("-", "").match(/.{2}/g);
  if (!pairs) return id;
  const binary = pairs.map((pair) => String.fromCharCode(Number.parseInt(pair, 16))).join("");
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function expandRoundId(identifier: string) {
  if (UUID_PATTERN.test(identifier)) return identifier.toLowerCase();
  if (!COMPACT_PATTERN.test(identifier)) return "";
  try {
    const base64 = identifier.replaceAll("-", "+").replaceAll("_", "/") + "==";
    const hex = Array.from(atob(base64), (character) =>
      character.charCodeAt(0).toString(16).padStart(2, "0"),
    ).join("");
    if (hex.length !== 32) return "";
    const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    return UUID_PATTERN.test(uuid) ? uuid : "";
  } catch {
    return "";
  }
}

export function roundPath(id: string) {
  return `/r/${compactRoundId(id)}`;
}
