export type SignatureProgress = {
  status: "detected" | "no_new_signature" | "unreadable";
  names: string[];
  addedNames: string[];
  signatureCount: number;
  previousCount: number | null;
};

const unreadable = (previous: Uint8Array | null | undefined): SignatureProgress => ({
  status: "unreadable",
  names: [],
  addedNames: [],
  signatureCount: 0,
  previousCount: previous ? 0 : null,
});

const clean = (value: string) =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

const latin1 = (bytes: Uint8Array) => {
  let text = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return text;
};

const unescapePdf = (value: string) =>
  value.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (match, code: string) => {
    if (code === "n") return "\n";
    if (code === "r") return "\r";
    if (code === "t") return "\t";
    if (code === "b") return "\b";
    if (code === "f") return "\f";
    if (code === "(" || code === ")" || code === "\\") return code;
    return String.fromCharCode(parseInt(code, 8));
  });

const hexBytes = (hex: string) => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

const declaredName = (dict: string) => {
  const literal = /\/Name\s*\(((?:\\.|[^\\)])*)\)/.exec(dict);
  if (literal) return clean(unescapePdf(literal[1]));
  const hex = /\/Name\s*<([0-9A-Fa-f\s]+)>/.exec(dict);
  if (!hex) return "";
  const compact = hex[1].replace(/\s+/g, "");
  if (!compact || compact.length % 2) return "";
  return clean(new TextDecoder().decode(hexBytes(compact)));
};

const readLength = (bytes: Uint8Array, offset: number) => {
  if (offset >= bytes.length) return null;
  const first = bytes[offset];
  if (first < 128) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (!count || count > 2 || offset + 1 + count > bytes.length) return null;
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset + 1 + index];
  if (offset + 1 + count + length > bytes.length) return null;
  return { length, next: offset + 1 + count };
};

const commonNames = (hex: string) => {
  const bytes = hexBytes(hex);
  const names: string[] = [];
  const oid = [0x06, 0x03, 0x55, 0x04, 0x03];
  for (let index = 0; index <= bytes.length - oid.length - 2; index += 1) {
    if (!oid.every((byte, offset) => bytes[index + offset] === byte)) continue;
    const tag = bytes[index + oid.length];
    const parsed = readLength(bytes, index + oid.length + 1);
    if (!parsed || (tag !== 0x0c && tag !== 0x13 && tag !== 0x16 && tag !== 0x1e)) continue;
    const raw = bytes.slice(parsed.next, parsed.next + parsed.length);
    const text = tag === 0x1e
      ? String.fromCharCode(...Array.from({ length: Math.floor(raw.length / 2) }, (_, pair) => (raw[pair * 2] << 8) | raw[pair * 2 + 1]))
      : new TextDecoder().decode(raw);
    const name = clean(text);
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
};

const institutional = (name: string) =>
  /autoridad|certificaci[oó]n|\bra[ií]z\b|\broot\b|\bsubca\b|\bca\b|\bca\d|\btsa\b|\btsu\d*\b|sello de tiempo|freetsa|timestamp/i.test(name);

const signerName = (hex: string, cleartext: string) => {
  const names = commonNames(hex);
  const people = names.filter((name) => !institutional(name));
  if (people.length) return people[people.length - 1];
  const declared = declaredName(cleartext);
  if (declared && !institutional(declared)) return declared;
  return declared || "Nombre no disponible";
};

const usableHex = (hex: string) => {
  const compact = hex.replace(/\s+/g, "").toLowerCase();
  if (compact.length < 128 || compact.length % 2 || /^0+$/.test(compact)) return "";
  return compact;
};

const digest = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const timestamp = (cleartext: string) => /\/Type\s*\/DocTimeStamp/.test(cleartext) || /\/SubFilter\s*\/ETSI\.RFC3161/.test(cleartext);

const byteRangeRecords = (text: string) => {
  const records: { at: number; hex: string; name: string }[] = [];
  const pattern = /\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g;
  for (const match of text.matchAll(pattern)) {
    const [a, b, c, d] = match.slice(1).map(Number);
    if (a < 0 || b <= 0 || c <= a + b || d < 0 || c > text.length || c + d > text.length) continue;
    const gap = text.slice(a + b, c);
    const contents = /<([0-9A-Fa-f\s]+)>/.exec(gap);
    const hex = contents ? usableHex(contents[1]) : "";
    if (!hex) continue;
    const afterEnd = text.indexOf("endobj", c);
    const dictStart = text.lastIndexOf("<<", match.index);
    const cleartext = `${text.slice(dictStart < 0 ? match.index : dictStart, a + b)}\n${text.slice(c, afterEnd < 0 ? c + 700 : afterEnd)}`;
    if (timestamp(cleartext)) continue;
    records.push({ at: match.index, hex, name: signerName(hex, cleartext) });
  }
  return records;
};

const nearbyRecords = (text: string) => {
  const records: { at: number; hex: string; name: string }[] = [];
  const types = /\/Type\s*\/Sig(?![A-Za-z])/g;
  for (const match of text.matchAll(types)) {
    const window = text.slice(match.index, Math.min(text.length, match.index + 2500));
    let closest: { hex: string; distance: number } | null = null;
    for (const contents of window.matchAll(/\/Contents\s*<([0-9A-Fa-f\s]+)>/g)) {
      const hex = usableHex(contents[1]);
      if (hex && (!closest || contents.index < closest.distance)) closest = { hex, distance: contents.index };
    }
    if (!closest) continue;
    records.push({ at: match.index, hex: closest.hex, name: signerName(closest.hex, window) });
  }
  return records;
};

const catalog = async (bytes: Uint8Array) => {
  const text = latin1(bytes);
  const ranged = byteRangeRecords(text);
  const found = ranged.length ? ranged : nearbyRecords(text);
  const seen = new Set<string>();
  const records: { id: string; name: string }[] = [];
  for (const record of found.sort((left, right) => left.at - right.at)) {
    if (seen.has(record.hex)) continue;
    seen.add(record.hex);
    records.push({ id: await digest(record.hex), name: record.name });
    if (records.length === 64) break;
  }
  return records;
};

export async function readSignatureProgress(candidate: Uint8Array, previous?: Uint8Array | null): Promise<SignatureProgress> {
  try {
    if (!candidate?.length || candidate.length > 10 * 1024 * 1024 || latin1(candidate.subarray(0, 5)) !== "%PDF-") return unreadable(previous);
    const current = await catalog(candidate);
    const prior = previous && previous.length && latin1(previous.subarray(0, 5)) === "%PDF-" ? await catalog(previous) : null;
    const known = new Set((prior ?? []).map((record) => record.id));
    const added = prior ? current.filter((record) => !known.has(record.id)) : current;
    return {
      status: added.length ? "detected" : "no_new_signature",
      names: current.map((record) => record.name),
      addedNames: added.map((record) => record.name),
      signatureCount: current.length,
      previousCount: prior ? prior.length : null,
    };
  } catch {
    return unreadable(previous);
  }
}
