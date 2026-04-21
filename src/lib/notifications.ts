import { db, schema } from "@/db/client";
import { nanoid } from "nanoid";

type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
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
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Scheduler <onboarding@resend.dev>",
        to: input.to,
        subject: input.subject,
        text: input.body,
      }),
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

export function composeRateLines(args: {
  baseRate: number | null;
  vanDrivingRate: number | null;
  requiresVanDriving: boolean;
  rateType: "hourly" | "flat";
}) {
  const base = args.baseRate ?? 0;
  const van = args.requiresVanDriving ? (args.vanDrivingRate ?? 0) : 0;
  const total = base + van;
  const rateSuffix = args.rateType === "hourly" ? "/hour" : " flat";
  const headline = `Rate for this event is $${total}${rateSuffix}.`;
  const note = args.requiresVanDriving
    ? "This event requires van driving."
    : "This event does not require van driving.";
  return { headline, note, combined: `${headline} ${note}` };
}
