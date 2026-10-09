/**
 * Pure helpers for the password-reset flow. The server actions in
 * src/app/forgot-password + /reset-password glue these to the DB and
 * email sender; here we keep the logic in one testable place.
 */

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export type ResetTokenRow = {
  token: string;
  userId: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
};

export type TokenCheckResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "unknown" | "expired" | "used" };

/**
 * Validate a token row that was just loaded from the DB. Pure — pass `now`
 * so tests can control it.
 */
export function checkResetToken(row: ResetTokenRow | null, now: Date): TokenCheckResult {
  if (!row) return { ok: false, reason: "unknown" };
  if (row.usedAt) return { ok: false, reason: "used" };
  if (row.expiresAt.getTime() <= now.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, userId: row.userId };
}

/** Convenience: compute the expiry stamp for a token minted at `now`. */
export function tokenExpiry(now: Date): Date {
  return new Date(now.getTime() + TOKEN_TTL_MS);
}

/**
 * Password rules: at least 8 characters, no whitespace-only, no leading/
 * trailing spaces. Returns null when the password is acceptable, otherwise
 * a message safe to show the user.
 */
export function validateNewPassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (pw.trim().length < pw.length) return "Password cannot start or end with a space.";
  if (!pw.trim()) return "Password cannot be empty.";
  return null;
}
