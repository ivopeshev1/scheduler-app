/**
 * Pure validators + reason codes for the staff onboarding landing page.
 * Keeping these out of the page component so the branches are easy to
 * unit-test (every outcome a staffer could land on from an invite link).
 */

export type OnboardLookupInput = {
  userExists: boolean;
  isSuspended: boolean;
  isArchived: boolean;
  isOnboarded: boolean; // inviteAcceptedAt was previously set
};

export type OnboardLookupOutcome =
  | { ok: true }
  | { ok: false; reason: "unknown" | "suspended" | "archived" | "already-onboarded" };

export function checkOnboardInvite(input: OnboardLookupInput): OnboardLookupOutcome {
  if (!input.userExists) return { ok: false, reason: "unknown" };
  if (input.isSuspended) return { ok: false, reason: "suspended" };
  if (input.isArchived) return { ok: false, reason: "archived" };
  if (input.isOnboarded) return { ok: false, reason: "already-onboarded" };
  return { ok: true };
}

/**
 * Age at a reference date given a YYYY-MM-DD DOB. Returns null for
 * missing / malformed DOB. The age-gating UI uses this to prevent an
 * under-18 from signing up at all (and the 21+ role gate re-uses it
 * at event-invite time).
 */
export function ageYearsFromDob(dob: string | null, on: Date = new Date()): number | null {
  if (!dob) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  if (!m) return null;
  const [, yStr, moStr, dStr] = m;
  const birth = new Date(Date.UTC(Number(yStr), Number(moStr) - 1, Number(dStr)));
  if (Number.isNaN(birth.getTime())) return null;
  let age = on.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    on.getUTCMonth() < birth.getUTCMonth() ||
    (on.getUTCMonth() === birth.getUTCMonth() && on.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Validate the whole onboarding form. Returns null when it's acceptable,
 * otherwise a short message safe to show the user.
 */
export function validateOnboardForm(input: {
  password: string;
  confirm: string;
  phone: string;
  dob: string;
  emergencyName: string;
  emergencyPhone: string;
  photoUrl?: string | null;
}): string | null {
  if (input.password !== input.confirm) return "The two passwords don't match.";
  if (input.password.length < 8) return "Password must be at least 8 characters.";
  if (!input.phone.trim()) return "Your phone number is required.";
  const age = ageYearsFromDob(input.dob);
  if (age == null) return "Date of birth is required.";
  if (age < 16) return "You must be at least 16 to sign up.";
  if (!input.emergencyName.trim()) return "Emergency contact name is required.";
  if (!input.emergencyPhone.trim()) return "Emergency contact phone is required.";
  // Photo is required so managers + teammates can recognize staffers on
  // event day. (Optional for managers - they're inside-the-app only.)
  if (!input.photoUrl || !input.photoUrl.trim()) return "A profile photo is required so your manager and teammates can recognize you at the event.";
  return null;
}
