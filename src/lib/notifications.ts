import { db, schema } from "@/db/client";
import { nanoid } from "nanoid";

type SendEmailInput = {
  to: string;
  subject: string;
  body: string;       // plain-text fallback (always provided)
  html?: string;      // optional HTML body — rendered by most clients
  companyId: string;
  userId?: string;
  relatedInvitationId?: string;
};

export async function sendEmail(input: SendEmailInput) {
  const hasResend = !!process.env.RESEND_API_KEY;

  if (!hasResend) {
    console.log(`\n─── DEV EMAIL ───\nTo: ${input.to}\nSubject: ${input.subject}\n${input.body}\n────────────────\n`);
    await db.insert(schema.notifications).values({
      id: nanoid(),
      companyId: input.companyId,
      userId: input.userId,
      channel: "email",
      subject: input.subject,
      body: input.body,
      status: "dev-logged",
      relatedInvitationId: input.relatedInvitationId,
    });
    return { ok: true as const };
  }

  try {
    const payload: Record<string, unknown> = {
      from: process.env.EMAIL_FROM ?? "Scheduler <onboarding@resend.dev>",
      to: input.to,
      subject: input.subject,
      text: input.body,
    };
    if (input.html) payload.html = input.html;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const status = res.ok ? "sent" : "failed";
    await db.insert(schema.notifications).values({
      id: nanoid(),
      companyId: input.companyId,
      userId: input.userId,
      channel: "email",
      subject: input.subject,
      body: input.body,
      status,
      errorMessage: res.ok ? null : await res.text(),
      relatedInvitationId: input.relatedInvitationId,
    });
    return { ok: res.ok };
  } catch (err) {
    return { ok: false as const, error: String(err) };
  }
}

/**
 * Tiny helper: HTML-escape user-supplied strings so we don't break the layout
 * if someone puts "<" or "&" in a venue name.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function composeRateLines(args: {
  baseRate: number | null;
  vanDrivingRate: number | null;
  travelRate?: number | null;
  requiresVanDriving: boolean;
  rateType?: "hourly" | "flat";
}) {
  const base = args.baseRate ?? 0;
  const van = args.requiresVanDriving ? (args.vanDrivingRate ?? 0) : 0;
  const travel = args.travelRate ?? 0;
  const total = base + van + travel;
  // Compact one-line headline for the manager-side table (still useful there).
  const headline = `Rate for this event is $${total}.`;
  // Emails list each component separately — no total, staff can add it up themselves.
  const lines: string[] = [`Base rate:      $${base}`];
  if (args.requiresVanDriving) lines.push(`Van driving:    $${van}`);
  if (travel > 0) lines.push(`Travel comp:    $${travel}`);
  return {
    headline,
    breakdown: lines.join("\n"),
    requiresVanDriving: args.requiresVanDriving,
  };
}
