/**
 * Pure helpers for the phone-verification challenge. The actual DB
 * writes + email send live in the profile server action; everything
 * here is testable in isolation.
 */

export const CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/** 6-digit numeric code, zero-padded. Cryptographically random enough
 *  for a short-lived (10 min) challenge; not a password. */
export function generateCode(randomSource: () => number = Math.random): string {
  const n = Math.floor(randomSource() * 1_000_000);
  return String(n).padStart(6, "0");
}

export type VerifyAttempt =
  | { ok: true }
  | { ok: false; reason: "no-code" | "expired" | "mismatch" };

/**
 * Decide whether a submitted code is accepted. Keeps the branching
 * out of the server action so every outcome can be unit-tested.
 */
export function verifyCode(
  storedCode: string | null,
  storedExpires: Date | null,
  submitted: string,
  now: Date = new Date(),
): VerifyAttempt {
  if (!storedCode || !storedExpires) return { ok: false, reason: "no-code" };
  if (storedExpires.getTime() < now.getTime()) return { ok: false, reason: "expired" };
  const normalized = submitted.trim();
  if (normalized !== storedCode) return { ok: false, reason: "mismatch" };
  return { ok: true };
}

/** Normalize a phone to a comparable string so a cosmetic re-save ("(555)" →
 *  "555") doesn't invalidate verification. Keeps only digits + leading "+". */
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const trimmed = raw.trim();
  const kept = trimmed.replace(/[^\d+]/g, "");
  if (kept.startsWith("+")) return "+" + kept.slice(1).replace(/\D/g, "");
  return kept.replace(/\D/g, "");
}

/** True when the staffer typed a materially different number than what
 *  we have on file (i.e. verification needs to be re-challenged). */
export function phoneChanged(oldPhone: string | null, newPhone: string | null): boolean {
  return normalizePhone(oldPhone) !== normalizePhone(newPhone);
}
