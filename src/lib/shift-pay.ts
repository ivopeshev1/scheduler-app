/**
 * Shift pay math shared between Payroll, Compare, and the per-staff log.
 *
 * Pure functions — no DB, no React. Everything that matters:
 *   - resolveRate: given an invitation + its position + the staffer's
 *     profile + their per-role rate catalog, picks the effective rate.
 *   - shiftPay: given a resolved rate + hours worked + gratuity (or an
 *     on-call standby fee), returns the dollars for that shift.
 *
 * Priority ladder for resolveRate (first match wins):
 *   1. Per-invitee override on the invitation (e.g. "this one shift pays $500")
 *   2. Position-level flat/hourly rate ("the shift pays $200 flat")
 *   3. "Standard" position mode → look up this staffer's per-role rate
 *   4. Final fallback → the staffer's profile default rate
 */

export type Mode = "standard" | "flat" | "hourly";
export type RateType = "flat" | "hourly";

export type ResolveInvitationInput = {
  rateOverrideAmount: number | null;
  rateOverrideMode: RateType | null;
};

export type ResolvePositionInput = {
  role: string;
  baseRateMode: Mode | null;
  baseRate: number | null;
};

export type ResolveProfileInput = {
  defaultRate: number | null;
  defaultRateType: RateType | "both" | null;
};

export type ResolvedRate = { rate: number; rateType: RateType };

/**
 * Pick the rate + type for this shift, following the override → position
 * → per-role → profile fallback chain.
 */
export function resolveRate(
  inv: ResolveInvitationInput,
  pos: ResolvePositionInput,
  profile: ResolveProfileInput,
  perRoleRate: { rate: number; rateType: RateType } | null,
): ResolvedRate {
  if (inv.rateOverrideAmount != null) {
    return {
      rate: inv.rateOverrideAmount,
      rateType: inv.rateOverrideMode === "flat" ? "flat" : "hourly",
    };
  }
  if (pos.baseRateMode === "flat") {
    return { rate: pos.baseRate ?? 0, rateType: "flat" };
  }
  if (pos.baseRateMode === "hourly") {
    return { rate: pos.baseRate ?? 0, rateType: "hourly" };
  }
  if (perRoleRate) return perRoleRate;
  return {
    rate: profile.defaultRate ?? 0,
    // "both" is a legacy value from the old onboarding flow; treat as hourly
    // in the fallback since that's the common choice for staffers who didn't
    // commit to one mode.
    rateType: profile.defaultRateType === "flat" ? "flat" : "hourly",
  };
}

/**
 * Compute a shift's pay in dollars.
 *   - On-call standby: returns the company's standby fee, ignoring rate/hours.
 *     Fee defaults to 0 if the company hasn't set one.
 *   - Flat shift: rate + gratuity.
 *   - Hourly shift: rate × hours + gratuity.
 * `hours` and `gratuity` default to 0 so a shift with no clock stamps still
 * returns the base (useful for payroll preview before the manager fills in
 * clock-in/clock-out).
 */
export function shiftPay(params: {
  isOnCall?: boolean;
  onCallFee?: number | null;
  rate: number;
  rateType: RateType;
  hours?: number;
  gratuity?: number | null;
}): number {
  if (params.isOnCall) return params.onCallFee ?? 0;
  const gratuity = params.gratuity ?? 0;
  if (params.rateType === "flat") return params.rate + gratuity;
  const hours = params.hours ?? 0;
  return params.rate * hours + gratuity;
}
