"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

/**
 * Section-footer button on the Payroll tab. Flips every shift for a
 * staffer in the current pay period to paid (or back to unpaid). Uses
 * router.refresh after the server action so the toggle UI updates
 * without a hard reload.
 */
export function PayrollMarkAllButton({
  invitationIds,
  mode,
  action,
}: {
  invitationIds: string[];
  // "paid" = flip every shift to paid. "unpaid" = reverse.
  mode: "paid" | "unpaid";
  action: (formData: FormData) => Promise<void>;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const count = invitationIds.length;
  if (count === 0) return null;

  function onClick() {
    const fd = new FormData();
    fd.set("invitationIds", invitationIds.join(","));
    fd.set("mode", mode);
    startTransition(async () => {
      await action(fd);
      router.refresh();
    });
  }

  const label = mode === "paid"
    ? pending ? "Marking…" : `Mark all paid (${count})`
    : pending ? "Reversing…" : `Mark all unpaid (${count})`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={mode === "paid" ? "btn btn-primary text-sm" : "btn btn-secondary text-sm"}
    >
      {label}
    </button>
  );
}
