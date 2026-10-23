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

const skipLiteral = (text: string, start: number) => {
  let depth = 1;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\\") {
      index += 1;
      continue;
    }
    if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index + 1;
  }
  return text.length;
};

const skipHex = (text: string, start: number) => {
  const end = text.indexOf(">", start + 1);
  return end < 0 ? text.length : end + 1;
};

const dictionaries = (text: string) => {
  const found: string[] = [];
  const stack: number[] = [];
  for (let index = 0; index < text.length && found.length < 64; index += 1) {
    const char = text[index];
    if (char === "%") {
      const newline = text.indexOf("\n", index);
      index = newline < 0 ? text.length : newline;
      continue;
    }
    if (char === "(") {
      index = skipLiteral(text, index) - 1;
      continue;
    }
    if (char === "<" && text[index + 1] === "<") {
      stack.push(index);
      index += 1;
      continue;
    }
    if (char === "<") {
      index = skipHex(text, index) - 1;
      continue;
    }
    if (char === ">" && text[index + 1] === ">" && stack.length) {
      const start = stack.pop()!;
      const dict = text.slice(start, index + 2);
      if (/\/Type\s*\/Sig(?![A-Za-z])/.test(dict) && !/\/ETSI\.RFC3161/.test(dict)) found.push(dict);
      index += 1;
    }
  }
  return found;
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

const certificateName = (hex: string) => {
  const bytes = hexBytes(hex);
  for (let index = 0; index <= bytes.length - 7; index += 1) {
    if (bytes[index] !== 0x06 || bytes[index + 1] !== 0x03 || bytes[index + 2] !== 0x55 || bytes[index + 3] !== 0x04 || bytes[index + 4] !== 0x03) continue;
    const tag = bytes[index + 5];
    const length = bytes[index + 6];
    if (length >= 128 || index + 7 + length > bytes.length) continue;
    const raw = bytes.slice(index + 7, index + 7 + length);
    let text = "";
    if (tag === 0x0c || tag === 0x13 || tag === 0x16) text = new TextDecoder().decode(raw);
    else if (tag === 0x1e) {
      const codes: number[] = [];
      for (let pair = 0; pair + 1 < raw.length; pair += 2) codes.push((raw[pair] << 8) | raw[pair + 1]);
      text = String.fromCharCode(...codes);
    }
    text = clean(text);
    if (text) return text;
  }
  return "";
};

const contentsHex = (dict: string) => {
  const match = /\/Contents\s*<([0-9A-Fa-f\s]+)>/.exec(dict);
  if (!match) return "";
  const hex = match[1].replace(/\s+/g, "").toLowerCase();
  if (hex.length < 128 || hex.length % 2 || /^0+$/.test(hex)) return "";
  return hex;
};

const digest = async (value: string) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

const catalog = async (bytes: Uint8Array) => {
  const records: { id: string; name: string }[] = [];
  for (const dict of dictionaries(latin1(bytes))) {
    const hex = contentsHex(dict);
    if (!hex) continue;
    const name = certificateName(hex) || declaredName(dict) || "Nombre no disponible";
    records.push({ id: await digest(hex), name });
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
