import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { userWantsNotification, type NotificationKey } from "./notification-prefs";

type SendEmailAttachment = {
  filename: string;
  // Raw file bytes as base64 (no data: prefix). Resend will decode and attach.
  contentBase64: string;
};

type SendEmailInput = {
  to: string;
  subject: string;
  body: string;       // plain-text fallback (always provided)
  html?: string;      // optional HTML body - rendered by most clients
  companyId: string;
  userId?: string;
  relatedInvitationId?: string;
  // Which notification channel this falls under. When set together with
  // userId, we honor the recipient's per-user opt-out: if they muted this
  // channel, we skip the send entirely and log a notifications row with
  // status "muted" for the audit trail. alwaysOn keys ignore the pref.
  notificationKey?: NotificationKey;
  // Optional file attachments (BEO PDFs, Word docs, images, etc).
  attachments?: SendEmailAttachment[];
};

export async function sendEmail(input: SendEmailInput) {
  // Honor per-user notification preferences when the caller supplied both
  // the recipient's userId and the channel key.
  if (input.userId && input.notificationKey) {
    const [u] = await db
      .select({ prefs: schema.users.notificationPreferences })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (u && !userWantsNotification(u.prefs, input.notificationKey)) {
      await db.insert(schema.notifications).values({
        id: nanoid(),
        companyId: input.companyId,
        userId: input.userId,
        channel: "email",
        subject: input.subject,
        body: input.body,
        status: "muted",
        relatedInvitationId: input.relatedInvitationId,
      });
      return { ok: true as const, muted: true as const };
    }
  }

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
    if (input.attachments && input.attachments.length > 0) {
      // Resend accepts attachments as {filename, content} where content is
      // base64 of the raw file bytes.
      payload.attachments = input.attachments.map((a) => ({
        filename: a.filename,
        content: a.contentBase64,
      }));
    }
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

type SendSmsInput = {
  // E.164-formatted recipient number (e.g. "+18005551234"). We don't try
  // to reformat in here - callers hand us the exact string Twilio will
  // see. Null/empty short-circuits (no phone on file).
  to: string | null | undefined;
  body: string;
  companyId: string;
  userId?: string;
  relatedInvitationId?: string;
  notificationKey?: NotificationKey;
};

/**
 * Send an SMS via Twilio's Messaging Service. The Messaging Service SID
 * (TWILIO_MESSAGING_SERVICE_SID) is what we talk to rather than a raw
 * phone number, so Twilio handles sender-pool failover, A2P 10DLC
 * campaign routing, STOP/HELP keyword responses, and carrier filtering
 * for us - we just hand over body + to.
 *
 * Opt-in enforcement happens HERE, in one place, so individual callers
 * can't accidentally text someone who hasn't consented:
 *   - staffProfiles.smsOptedIn must be true
 *   - staffProfiles.phoneVerifiedAt must be set (we only text verified
 *     numbers so a typo doesn't spam a stranger)
 *   - the recipient's notification preference for this key must not be
 *     muted (same rule sendEmail uses)
 * Any of those failing logs a "muted"/"skipped" notification row for
 * the audit trail and returns without hitting Twilio.
 *
 * When TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN is missing (local dev,
 * preview deploys before env vars land), we log to console + db like
 * sendEmail does for the no-Resend path.
 */
export async function sendSms(input: SendSmsInput) {
  const to = input.to?.trim() || "";
  if (!to) return { ok: false as const, reason: "no-phone" as const };

  // Per-user notification preference check (same as email).
  if (input.userId && input.notificationKey) {
    const [u] = await db
      .select({ prefs: schema.users.notificationPreferences })
      .from(schema.users)
      .where(eq(schema.users.id, input.userId));
    if (u && !userWantsNotification(u.prefs, input.notificationKey)) {
      await db.insert(schema.notifications).values({
        id: nanoid(),
        companyId: input.companyId,
        userId: input.userId,
        channel: "sms",
        subject: "(sms)",
        body: input.body,
        status: "muted",
        relatedInvitationId: input.relatedInvitationId,
      });
      return { ok: true as const, muted: true as const };
    }
  }

  // Opt-in + verification gate (SMS-only). Staffers whose profile hasn't
  // opted in, or who haven't verified their phone, are skipped.
  if (input.userId) {
    const [profile] = await db
      .select({
        smsOptedIn: schema.staffProfiles.smsOptedIn,
        phoneVerifiedAt: schema.staffProfiles.phoneVerifiedAt,
      })
      .from(schema.staffProfiles)
      .where(eq(schema.staffProfiles.userId, input.userId));
    if (profile && (profile.smsOptedIn !== true || !profile.phoneVerifiedAt)) {
      await db.insert(schema.notifications).values({
        id: nanoid(),
        companyId: input.companyId,
        userId: input.userId,
        channel: "sms",
        subject: "(sms)",
        body: input.body,
        status: "muted",
        errorMessage: profile.smsOptedIn !== true ? "not opted in" : "phone not verified",
        relatedInvitationId: input.relatedInvitationId,
      });
      return { ok: true as const, muted: true as const };
    }
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const haveCreds = !!(sid && token && (messagingServiceSid || from));

  if (!haveCreds) {
    console.log(`\n─── DEV SMS ───\nTo: ${to}\n${input.body}\n───────────────\n`);
    await db.insert(schema.notifications).values({
      id: nanoid(),
      companyId: input.companyId,
      userId: input.userId,
      channel: "sms",
      subject: "(sms)",
      body: input.body,
      status: "dev-logged",
      relatedInvitationId: input.relatedInvitationId,
    });
    return { ok: true as const };
  }

  try {
    // Lazy-require so we don't drag the Twilio SDK into every cold start
    // of routes that never send SMS.
    const twilio = (await import("twilio")).default;
    const client = twilio(sid, token);
    const message = await client.messages.create(
      messagingServiceSid
        ? { to, body: input.body, messagingServiceSid }
        : { to, body: input.body, from: from! },
    );
    await db.insert(schema.notifications).values({
      id: nanoid(),
      companyId: input.companyId,
      userId: input.userId,
      channel: "sms",
      subject: "(sms)",
      body: input.body,
      status: "sent",
      errorMessage: null,
      relatedInvitationId: input.relatedInvitationId,
    });
    return { ok: true as const, sid: message.sid };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await db.insert(schema.notifications).values({
      id: nanoid(),
      companyId: input.companyId,
      userId: input.userId,
      channel: "sms",
      subject: "(sms)",
      body: input.body,
      status: "failed",
      errorMessage,
      relatedInvitationId: input.relatedInvitationId,
    });
    return { ok: false as const, error: errorMessage };
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
  // Emails list each component separately - no total, staff can add it up themselves.
  const lines: string[] = [`Base rate:      $${base}`];
  if (args.requiresVanDriving) lines.push(`Van driving:    $${van}`);
  if (travel > 0) lines.push(`Travel comp:    $${travel}`);
  return {
    headline,
    breakdown: lines.join("\n"),
    requiresVanDriving: args.requiresVanDriving,
  };
}
