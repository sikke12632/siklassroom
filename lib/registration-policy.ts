// registration_tokens.expires_at is retained for compatibility with deployed
// databases. Personal QR cards are valid until explicit revocation/replacement.
export const REGISTRATION_QR_PERSISTENT_EXPIRES_AT = Date.UTC(9999, 11, 31, 23, 59, 59);

// A scan for ordinary activation/login may remain open long enough for a child
// to enter a password. Password-reset authorization remains strictly 10 minutes.
export const REGISTRATION_CHALLENGE_LIFETIME_MS = 30 * 60 * 1000;
export const REGISTRATION_RESET_CHALLENGE_LIFETIME_MS = 10 * 60 * 1000;

export function isCurrentUnrevokedRegistration<T extends {
  revoked_at: number | null;
  generation: number;
  qr_generation: number;
}>(record: T | null): record is T {
  return record !== null
    && !record.revoked_at
    && Number(record.generation) === Number(record.qr_generation);
}
