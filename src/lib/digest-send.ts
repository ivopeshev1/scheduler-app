import { db, schema } from "@/db/client";
import { eq, and, gte, inArray, isNull } from "drizzle-orm";
import { sendEmail } from "@/lib/notifications";
import { shellWrap, greeting, paragraph, signoff } from "@/lib/email-html";
import { mergeNotificationSettings } from "@/lib/notification-settings";
import { classifyDigest, type DigestInput, type DigestBuckets } from "@/lib/digest";

/**
 * Load the digest input for one company: every invitation on an upcoming
 * event (next 30 days + anything that resolved in the last 24h). Flattens
 * everything the pure classifier needs so classifyDigest stays pure.
 */
async function loadDigestInput(companyId: string, now: Date): Promise<DigestInput> {
  const todayISO = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const rows = await db
    .select({
      inv: schema.invitations,
      pos: schema.positions,
      ev: schema.events,
      prof: schema.staffProfiles,
    })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .innerJoin(schema.events, eq(schema.positions.eventId, schema.events.id))
    .leftJoin(schema.staffProfiles, eq(schema.invitations.userId, schema.staffProfiles.userId))
    .where(and(
      eq(schema.events.companyId, companyId),
      gte(schema.events.date, todayISO),
      isNull(schema.events.cancelledAt),
    ));

  // Pre-compute per-position aggregates so the pure classifier gets them
  // without re-querying.
  const acceptedByPosition = new Map<string, number>();
  const pendingBackupByPosition = new Set<string>();
  for (const { inv, pos } of rows) {
    if (inv.status === "accepted" && !inv.cancelledAt && !inv.isOnCall) {
      acceptedByPosition.set(pos.id, (acceptedByPosition.get(pos.id) ?? 0) + 1);
    }
    if (inv.status === "pending" && inv.tier > 0 && !inv.cancelledAt && !inv.isOnCall) {
      pendingBackupByPosition.add(pos.id);
    }
  }

  const settings = await loadCompanySettings(companyId);

  return {
    now,
    urgentThresholdHours: settings.manager.urgentThresholdHours,
    invites: rows
      .filter((r) => r.ev.date <= horizon)
      .map((r) => ({
        invitationId: r.inv.id,
        status: r.inv.status,
        tier: r.inv.tier,
        sentAt: r.inv.sentAt,
        respondedAt: r.inv.respondedAt,
        cancelledAt: r.inv.cancelledAt,
        isOnCall: r.inv.isOnCall,
        userFirstName: r.prof?.firstName ?? "?",
        userLastName: r.prof?.lastName ?? "",
        eventId: r.ev.id,
        eventClientName: r.ev.clientName,
        eventDate: r.ev.date,
        eventCheckInTime: r.ev.checkInTime,
        positionRole: r.pos.role,
        positionNeeded: r.pos.needed,
        positionAcceptedCount: acceptedByPosition.get(r.pos.id) ?? 0,
        positionHasPendingBackup: pendingBackupByPosition.has(r.pos.id),
      })),
  };
}

async function loadCompanySettings(companyId: string) {
  const [company] = await db
    .select({ settings: schema.companies.notificationSettings })
    .from(schema.companies)
    .where(eq(schema.companies.id, companyId));
  return mergeNotificationSettings(company?.settings ?? null);
}

/**
 * Build the digest HTML + plain text. Pure except for emoji glyphs.
 */
function renderDigestEmail(
  companyName: string,
  firstName: string | null,
  buckets: DigestBuckets,
): { subject: string; text: string; html: string } {
  const urgent = buckets.urgent;
  const subjectTag = urgent.length > 0 ? `🚨 ${urgent.length} urgent · ` : "";
  const subject = `${subjectTag}${companyName} daily shift roundup`;

  const line = (prefix: string, items: typeof buckets.urgent) =>
    items.map((i) => `  ${prefix} ${i.message}`).join("\n");

  const textParts: string[] = [`Hi ${firstName ?? "there"},`, ``];
  if (urgent.length === 0 && buckets.waiting.length === 0 && buckets.resolved.length === 0) {
    textParts.push(`Nothing to report today. All upcoming shifts are either fully staffed or far enough out that no one needs chasing.`);
  }
  if (urgent.length > 0) {
    textParts.push(`🚨 URGENT (needs action today)`, line("•", urgent), ``);
  }
  if (buckets.waiting.length > 0) {
    textParts.push(`⏳ WAITING (keep an eye on)`, line("•", buckets.waiting), ``);
  }
  if (buckets.resolved.length > 0) {
    textParts.push(`✅ RESOLVED IN THE LAST 24 HOURS`, line("•", buckets.resolved), ``);
  }
  textParts.push(
    `📊 OVERVIEW (next 30 days)`,
    `  ${buckets.overview.upcomingEvents} events · ${buckets.overview.totalPositions} positions · ${buckets.overview.confirmedSlots} confirmed · ${buckets.overview.openSlots} open`,
    ``,
    `– ${companyName}`,
  );
  const text = textParts.filter(Boolean).join("\n");

  const section = (
    label: string,
    items: typeof buckets.urgent,
    bg: string,
    border: string,
  ) =>
    items.length === 0
      ? ""
      : `<div style="margin:0 0 20px;padding:14px 18px;background:${bg};border-left:4px solid ${border};border-radius:4px;">
          <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.4px;color:${border};margin-bottom:8px;">${label}</div>
          <ul style="margin:0;padding-left:18px;color:#111827;line-height:1.5;">
            ${items.map((i) => `<li>${escapeHtml(i.message)}</li>`).join("")}
          </ul>
        </div>`;

  const quietDay =
    urgent.length === 0 && buckets.waiting.length === 0 && buckets.resolved.length === 0;

  const html = shellWrap([
    greeting(firstName, `Here's your ${companyName} shift roundup.`),
    quietDay
      ? paragraph("Nothing to report today. All upcoming shifts are either fully staffed or far enough out that no one needs chasing.")
      : "",
    section("🚨 Urgent (needs action today)", urgent, "#fef2f2", "#dc2626"),
    section("⏳ Waiting (keep an eye on)", buckets.waiting, "#fffbeb", "#d97706"),
    section("✅ Resolved in the last 24 hours", buckets.resolved, "#f0fdf4", "#16a34a"),
    `<div style="margin:0 0 20px;padding:14px 18px;background:#f3f4f6;border-radius:4px;">
       <div style="font-weight:700;font-size:13px;text-transform:uppercase;letter-spacing:0.4px;color:#374151;margin-bottom:8px;">📊 Overview (next 30 days)</div>
       <div style="color:#111827;">
         <strong>${buckets.overview.upcomingEvents}</strong> events ·
         <strong>${buckets.overview.totalPositions}</strong> positions ·
         <strong>${buckets.overview.confirmedSlots}</strong> confirmed ·
         <strong>${buckets.overview.openSlots}</strong> open
       </div>
     </div>`,
    signoff(companyName),
  ].join("\n"));

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Scan every onboarded company, build its digest, email every active
 * manager in that company whose settings don't opt out of the digest
 * entirely. Returns a flat log of what was sent for the cron response.
 */
export async function runManagerDigests(): Promise<{ sent: number; skipped: number }> {
  const now = new Date();
  const companies = await db.select().from(schema.companies);
  let sent = 0;
  let skipped = 0;

  for (const c of companies) {
    const input = await loadDigestInput(c.id, now);
    if (input.invites.length === 0) {
      skipped++;
      continue;
    }
    const buckets = classifyDigest(input);

    const managers = await db
      .select({ user: schema.users, profile: schema.managerProfiles })
      .from(schema.users)
      .leftJoin(schema.managerProfiles, eq(schema.managerProfiles.userId, schema.users.id))
      .where(and(
        eq(schema.users.companyId, c.id),
        eq(schema.users.role, "manager"),
        isNull(schema.users.archivedAt),
        isNull(schema.users.suspendedAt),
      ));

    const { subject, text, html } = renderDigestEmail(
      c.name,
      managers[0]?.profile?.firstName ?? null,
      buckets,
    );

    for (const m of managers) {
      // Each manager gets a slightly personalized greeting.
      const perManagerHtml = html; // same body — greeting() already generic
      await sendEmail({
        to: m.user.email,
        subject,
        body: text,
        html: perManagerHtml,
        companyId: c.id,
        userId: m.user.id,
      });
      sent++;
    }
  }
  return { sent, skipped };
}
