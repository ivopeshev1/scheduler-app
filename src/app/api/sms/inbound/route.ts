/**
 * Twilio inbound-SMS webhook.
 *
 * Twilio POSTs to this URL every time someone texts our number. CTIA +
 * carrier rules require us to:
 *   - Respect STOP/STOPALL/UNSUBSCRIBE/CANCEL/END/QUIT (opt out)
 *   - Respond to START/UNSTOP/YES (opt back in)
 *   - Respond to HELP/INFO (how to get help / contact info)
 *
 * We also log the inbound message to the notifications table so there's
 * an audit trail. For STOP we flip the matching staff profile's
 * smsOptedIn to false; for START we flip it back to true.
 *
 * We don't verify Twilio's signature here yet - will add
 * `twilio.validateRequest` once we're past the first test. For now the
 * webhook is public (Twilio's URLs are not secret-sensitive; the
 * worst-case misuse is someone flipping their own opt-in state by
 * spoofing their own phone number).
 *
 * The response body is TwiML XML - that's what Twilio expects, and the
 * <Message> inside is what gets sent back to the user automatically.
 */
import { NextResponse } from "next/server";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

const STOP_WORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const START_WORDS = new Set(["START", "UNSTOP", "YES"]);
const HELP_WORDS = new Set(["HELP", "INFO"]);

const BRAND = "Flair Projects";

function twiml(replyBody: string | null): string {
  if (!replyBody) return `<?xml version="1.0" encoding="UTF-8"?><Response/>`;
  // Escape XML specials so a stray & or < doesn't break the response.
  const safe = replyBody
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${safe}</Message></Response>`;
}

function xmlResponse(body: string) {
  return new NextResponse(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/**
 * Normalize any phone shape the user might have on file against the
 * E.164 "+1..." format Twilio hands us in the From field. Strips every
 * non-digit then compares the last 10 digits (US-centric; good enough
 * for the scope of this app).
 */
function last10(s: string | null | undefined): string {
  if (!s) return "";
  const digits = s.replace(/\D/g, "");
  return digits.slice(-10);
}

export async function POST(req: Request) {
  const form = await req.formData();
  const from = String(form.get("From") ?? "").trim();
  const body = String(form.get("Body") ?? "").trim();
  const keyword = body.toUpperCase().split(/\s+/)[0] ?? "";

  if (!from) return xmlResponse(twiml(null));

  // Find the matching staff profile by phone number. Could be multiple
  // (same phone across companies) - we flip all of them for STOP/START
  // because the opt-out is per-number per-CTIA, not per-tenant.
  const fromLast10 = last10(from);
  const profiles = await db.select().from(schema.staffProfiles);
  const matches = profiles.filter((p) => last10(p.phone) === fromLast10);

  // Always log the inbound for audit, even if no match.
  if (matches.length > 0) {
    for (const p of matches) {
      // Look up the user to grab companyId for the notifications row.
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, p.userId));
      if (!u) continue;
      await db.insert(schema.notifications).values({
        id: nanoid(),
        companyId: u.companyId,
        userId: u.id,
        channel: "sms",
        subject: "(inbound sms)",
        body,
        status: "received",
      });
    }
  }

  // STOP: flip opt-in off, auto-reply with carrier-mandated acknowledgement.
  if (STOP_WORDS.has(keyword)) {
    for (const p of matches) {
      await db
        .update(schema.staffProfiles)
        .set({ smsOptedIn: false, smsOptedOutAt: new Date() })
        .where(eq(schema.staffProfiles.userId, p.userId));
    }
    return xmlResponse(
      twiml(
        `${BRAND}: You've been unsubscribed and will no longer receive messages. Reply START to resubscribe.`,
      ),
    );
  }

  // START: flip opt-in back on.
  if (START_WORDS.has(keyword)) {
    for (const p of matches) {
      await db
        .update(schema.staffProfiles)
        .set({ smsOptedIn: true, smsOptedInAt: new Date(), smsOptedOutAt: null })
        .where(eq(schema.staffProfiles.userId, p.userId));
    }
    return xmlResponse(
      twiml(
        `${BRAND}: You're resubscribed to shift notifications. Message frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to opt out.`,
      ),
    );
  }

  // HELP: contact info + opt-out reminder.
  if (HELP_WORDS.has(keyword)) {
    return xmlResponse(
      twiml(
        `${BRAND}: For help with your shifts, contact your manager or email info@flairprojectsb.com. Msg & data rates may apply. Reply STOP to opt out.`,
      ),
    );
  }

  // Anything else: silent. We don't operate a conversational SMS service.
  return xmlResponse(twiml(null));
}
