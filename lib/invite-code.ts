const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function normalizeInviteCode(value: unknown) {
  return String(value ?? "").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function generateInviteCode() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const raw = Array.from(bytes, (byte) => INVITE_ALPHABET[byte % INVITE_ALPHABET.length]).join("");
  return raw.match(/.{1,5}/g)!.join("-");
}
