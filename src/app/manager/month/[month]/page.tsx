import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, gte, lte } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { summarizePosition } from "@/lib/status";
import { formatTime, formatDate } from "@/lib/format";
import { sendEmail, escapeHtml } from "@/lib/notifications";
import { shellWrap, kvRow, kvTable, greeting, paragraph, signoff } from "@/lib/email-html";
import { sanitizePastedHtml } from "@/lib/html-sanitize";
import { nanoid } from "nanoid";
import { revalidatePath } from "next/cache";
import { SendBeoButton } from "@/components/SendBeoButton";

// Max BEO file size - keep it under the Resend attachment limit (40MB total
// per message) with a lot of headroom for the HTML body.
const BEO_MAX_BYTES = 10_000_000;

/**
 * Server action: send the BEO file to every accepted staffer on an event.
 * Called from <SendBeoButton>. Returns {ok, sentTo, error?} so the client
 * can render a success/error banner inline.
 */
async function sendBeoAction(
  formData: FormData,
): Promise<{ ok: boolean; sentTo: number; error?: string }> {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") return { ok: false, sentTo: 0, error: "Unauthorized" };

  const eventId = String(formData.get("eventId") ?? "");
  // Note comes in two flavors: a legacy plain-text 'note' field and the new
  // rich-text 'noteHtml' from the contentEditable paste area. Prefer the
  // HTML version when present; sanitize before injecting into the email.
  const noteHtmlRaw = String(formData.get("noteHtml") ?? "").trim();
  const noteTextRaw = String(formData.get("note") ?? "").trim();
  const noteHtml = noteHtmlRaw ? sanitizePastedHtml(noteHtmlRaw) : "";
  // Plain-text fallback for the text/plain email part. Strip tags.
  const notePlain = noteHtml
    ? noteHtmlRaw.replace(/<[^>]+>/g, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
    : noteTextRaw;

  // Delivery mode: 'all' resends to every accepted staffer and resets
  // their confirmations (treat as a revision), 'only-new' sends only to
  // staff whose beo_sent_at is null (new joiners).
  const modeRaw = String(formData.get("mode") ?? "").toLowerCase();
  const mode: "all" | "only-new" = modeRaw === "only-new" ? "only-new" : "all";
  // When the manager picks an existing revision to re-send, the modal
  // passes its id here. Empty = they're uploading a new file (new version).
  const existingBeoId = String(formData.get("beoId") ?? "").trim();

  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) return { ok: false, sentTo: 0, error: "Event not found" };

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const companyName = company?.name ?? "Scheduler";
  const prettyDate = formatDate(event.date);

  // Figure out which file to send and whether it's a new revision.
  let beoId: string;
  let filename: string;
  let fileSize: number;
  let contentBase64: string;
  let currentVersion: number;
  let isRevision: boolean;

  const file = formData.get("file");
  const hasNewFile = file instanceof File && file.size > 0;

  if (existingBeoId && !hasNewFile) {
    const [existing] = await db.select().from(schema.eventBeos).where(eq(schema.eventBeos.id, existingBeoId));
    if (!existing || existing.eventId !== eventId) {
      return { ok: false, sentTo: 0, error: "BEO revision not found" };
    }
    beoId = existing.id;
    filename = existing.filename;
    fileSize = existing.fileSize;
    contentBase64 = existing.fileData;
    currentVersion = existing.version;
    isRevision = false;
    if (noteHtml && noteHtml !== (existing.noteHtml ?? "")) {
      await db.update(schema.eventBeos)
        .set({ noteHtml })
        .where(eq(schema.eventBeos.id, existing.id));
    }
  } else if (hasNewFile) {
    if ((file as File).size > BEO_MAX_BYTES) return { ok: false, sentTo: 0, error: "File too large (max 10 MB)" };
    const bytes = new Uint8Array(await (file as File).arrayBuffer());
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    contentBase64 = Buffer.from(binary, "binary").toString("base64");
    filename = (file as File).name || "BEO.pdf";
    fileSize = (file as File).size;
    const existingRevs = await db.select().from(schema.eventBeos).where(eq(schema.eventBeos.eventId, eventId));
    currentVersion = (existingRevs.reduce((m, r) => Math.max(m, r.version), 0)) + 1;
    isRevision = currentVersion > 1;
    beoId = nanoid();
    await db.insert(schema.eventBeos).values({
      id: beoId, eventId, version: currentVersion, filename, fileSize, fileData: contentBase64, noteHtml: noteHtml || null,
    });
  } else {
    return { ok: false, sentTo: 0, error: "No BEO file selected" };
  }

  // Pull every accepted invite on the event, then filter by delivery mode.
  const accepted = await db
    .select({ inv: schema.invitations, pos: schema.positions })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .where(and(
      eq(schema.positions.eventId, eventId),
      eq(schema.invitations.status, "accepted"),
    ));
  if (accepted.length === 0) {
    return { ok: false, sentTo: 0, error: "No accepted staff on this event yet" };
  }
  const recipients = mode === "only-new"
    ? accepted.filter((r) => !r.inv.beoSentAt)
    : accepted;
  if (recipients.length === 0) {
    return { ok: false, sentTo: 0, error: mode === "only-new" ? "No new staff to send to" : "No recipients" };
  }

  const publicBase = process.env.PUBLIC_APP_URL ?? "";
  const now = new Date();
  let sentTo = 0;
  for (const { inv, pos } of recipients) {
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
    if (!u) continue;
    const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
    const firstName = profile?.firstName ?? "";

    // One-way confirmation URL. Clicking it marks beoReceivedAt. Each invite
    // gets its own token so we can tell which staff member clicked.
    let token = inv.beoToken;
    if (!token) {
      token = nanoid(32);
      await db.update(schema.invitations).set({ beoToken: token }).where(eq(schema.invitations.id, inv.id));
    }
    const confirmUrl = `${publicBase}/beo/confirm/${token}`;

    const lead = isRevision && inv.beoSentAt
      ? `An updated BEO for your upcoming shift is attached. Please review the latest version and confirm receipt below.`
      : `The BEO (Banquet Event Order) for your upcoming shift is attached. Please review it and confirm receipt below.`;
    const kv: Array<[string, string]> = [
      ["Client", event.clientName],
      ["Date", prettyDate],
      ["Role", pos.role],
    ];
    if (event.venue) kv.push(["Venue", event.venue]);

    const textBody = [
      `Hi ${firstName || "there"},`,
      "",
      lead,
      "",
      ...kv.map(([k, v]) => `${k}: ${v}`),
      ...(notePlain ? ["", `Note from manager:`, notePlain] : []),
      "",
      `Confirm you received it: ${confirmUrl}`,
      "",
      `- ${companyName}`,
    ].join("\n");

    const htmlBody = shellWrap([
      greeting(firstName || "there", lead),
      kvTable(kv.map(([k, v]) => kvRow(k, escapeHtml(v)))),
      noteHtml
        ? `<div style="margin:16px 0 12px;padding:14px 16px;background:#f9fafb;border-left:3px solid #d1d5db;color:#374151;"><div style="font-weight:600;color:#111;margin-bottom:6px;">Note from manager</div><div style="line-height:1.5;">${noteHtml}</div></div>`
        : "",
      `<p style="margin:24px 0 12px;"><a href="${confirmUrl}" style="display:inline-block;background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:600;">Confirm I received the BEO</a></p>`,
      `<p style="margin:0 0 12px;color:#777;font-size:13px;">Button not working? Copy this into your browser:<br><a href="${confirmUrl}" style="color:#2563eb;word-break:break-all;">${confirmUrl}</a></p>`,
      signoff(companyName),
    ].join("\n"));

    const subject = isRevision && inv.beoSentAt
      ? `BEO updated: ${event.clientName} on ${prettyDate}`
      : `BEO: ${event.clientName} on ${prettyDate}`;
    const sendResult = await sendEmail({
      to: u.email,
      subject,
      body: textBody,
      html: htmlBody,
      companyId: session.companyId,
      userId: inv.userId,
      relatedInvitationId: inv.id,
      attachments: [{ filename, contentBase64 }],
    });
    if (sendResult.ok) {
      // Revisions reset confirmations; new-staff sends don't touch anyone
      // who's already confirmed.
      const update: {
        beoSentAt: Date;
        beoReceivedAt?: Date | null;
        beoVersionSent?: number;
      } = { beoSentAt: now, beoVersionSent: currentVersion };
      if (isRevision) update.beoReceivedAt = null;
      await db.update(schema.invitations)
        .set(update)
        .where(eq(schema.invitations.id, inv.id));
      sentTo += 1;
    }
  }

  revalidatePath(`/manager/month/${event.date.slice(0, 7)}`);
  revalidatePath(`/manager/event/${eventId}`);
  return { ok: sentTo > 0, sentTo };
}

function parseMonth(m: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(m);
  if (!match) return null;
  const y = Number(match[1]); const mo = Number(match[2]);
  if (mo < 1 || mo > 12) return null;
  return { year: y, month: mo };
}
function daysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
const WEEKDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default async function MonthView({ params }: { params: { month: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const parsed = parseMonth(params.month);
  if (!parsed) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!company || !user) redirect("/login");
  if (!user.isOwner && !user.canAccessCalendar) redirect("/manager?denied=calendar");

  const startDate = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-01`;
  const endDate = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${daysInMonth(parsed.year, parsed.month)}`;
  const monthEvents = await db.select().from(schema.events).where(and(
    eq(schema.events.companyId, session.companyId),
    gte(schema.events.date, startDate),
    lte(schema.events.date, endDate),
  ));

  const byDay = new Map<string, typeof monthEvents>();
  for (const ev of monthEvents) {
    if (!byDay.has(ev.date)) byDay.set(ev.date, []);
    byDay.get(ev.date)!.push(ev);
  }

  const prevMonth = new Date(parsed.year, parsed.month - 2, 1);
  const nextMonth = new Date(parsed.year, parsed.month, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = new Date(parsed.year, parsed.month - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  const totalDays = daysInMonth(parsed.year, parsed.month);

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex flex-wrap items-center gap-3 mb-8">
          <Link href={`/manager/month/${fmt(prevMonth)}`} className="btn btn-secondary">← Prev</Link>
          <h1 className="text-2xl font-semibold">{monthLabel}</h1>
          <Link href={`/manager/month/${fmt(nextMonth)}`} className="btn btn-secondary">Next →</Link>
          <div className="ml-auto inline-flex rounded border text-sm overflow-hidden">
            <Link href={`/manager/calendar/${params.month}`} className="px-3 py-1 hover:bg-gray-100 text-gray-700">Grid</Link>
            <span className="px-3 py-1 bg-gray-900 text-white">List</span>
          </div>
        </div>

        <div className="space-y-6">
          {await Promise.all(Array.from({ length: totalDays }, async (_, i) => {
            const day = i + 1;
            const dateStr = `${parsed.year}-${String(parsed.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const events = byDay.get(dateStr) ?? [];
            const dow = new Date(parsed.year, parsed.month - 1, day).getDay();
            return <DayRow key={dateStr} day={day} weekday={WEEKDAY[dow]} dateStr={dateStr} events={events} />;
          }))}
        </div>
      </main>
    </div>
  );
}

async function DayRow({ day, weekday, dateStr, events }: {
  day: number; weekday: string; dateStr: string;
  events: Array<typeof schema.events.$inferSelect>;
}) {
  return (
    <div id={`day-${dateStr}`} className="flex gap-4 border-t pt-4 scroll-mt-24">
      <div className="w-32 flex-shrink-0">
        <div className="text-2xl font-semibold">{day}</div>
        <div className="text-sm text-gray-500 uppercase tracking-wide">{weekday}</div>
      </div>
      {/* Horizontal scroller: fixed-width cards side-by-side, scrolls
          when more than ~2 fit. Fallback stays a single-column dashed
          "Add event" when the day is empty so it reads like before. */}
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex gap-4 min-w-full">
          {(await Promise.all(events.map(async (ev) => ({
            id: ev.id,
            card: await EventCard({ event: ev }),
          })))).map(({ id, card }) => (
            <div key={id} className="w-[480px] flex-shrink-0">
              {card}
            </div>
          ))}
          <Link
            href={`/manager/event/new?date=${dateStr}`}
            className={`border border-dashed rounded-lg p-4 text-gray-400 text-sm hover:border-gray-400 hover:text-gray-600 flex items-center justify-center min-h-[96px] flex-shrink-0 ${events.length === 0 ? "flex-1 min-w-[320px]" : "w-[280px]"}`}
          >
            {events.length === 0 ? "+ Add event for this day" : "+ Add another event"}
          </Link>
        </div>
      </div>
    </div>
  );
}

async function EventCard({ event }: { event: typeof schema.events.$inferSelect }) {
  const positionsList = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  const statuses = await Promise.all(positionsList.map((p) => summarizePosition(p.id)));

  // Pre-compute BEO context for the Send BEO modal: full revision history
  // for this event + accepted-staff counts so the UI can show per-revision
  // Send/View actions and recipient defaults.
  const beoRevisions = await db.select().from(schema.eventBeos).where(eq(schema.eventBeos.eventId, event.id));
  beoRevisions.sort((a, b) => a.version - b.version);
  const acceptedInvsForBeo = await db
    .select({ inv: schema.invitations })
    .from(schema.invitations)
    .innerJoin(schema.positions, eq(schema.invitations.positionId, schema.positions.id))
    .where(and(
      eq(schema.positions.eventId, event.id),
      eq(schema.invitations.status, "accepted"),
    ));
  const totalAccepted = acceptedInvsForBeo.length;
  const newStaffCount = acceptedInvsForBeo.filter((r) => !r.inv.beoSentAt).length;
  const beoContext = {
    revisions: beoRevisions.map((r) => ({
      id: r.id,
      version: r.version,
      filename: r.filename,
      sentAt: r.sentAt.toISOString(),
    })),
    totalAccepted,
    newStaffCount,
  };

  return (
    <div
      key={event.id}
      className={`rounded-lg p-4 ${
        event.cancelledAt
          ? "border-2 border-red-500 bg-red-50"
          : "border bg-white hover:border-gray-400"
      }`}
    >
      <Link href={`/manager/event/${event.id}`} className="block">
      {event.cancelledAt && (
        <div className="text-red-700 text-xs font-bold uppercase mb-2">⚠ Cancelled</div>
      )}
      <div className="flex items-start justify-between">
        <div>
          <div className={`font-semibold ${event.cancelledAt ? "line-through text-gray-500" : ""}`}>{event.clientName}</div>
          <div className="text-sm text-gray-600">
            {event.eventType}
            {event.city ? ` · ${event.city}` : ""}
            {event.guestCount ? ` · ${event.guestCount} guests` : ""}
          </div>
        </div>
        <div className="text-sm text-gray-500">
          {event.checkInTime ? formatTime(event.checkInTime) : ""}
          {event.endTime ? ` – ${formatTime(event.endTime)}` : ""}
        </div>
      </div>
      <table className="w-full mt-3 text-sm">
        <thead className="text-xs text-gray-500 uppercase">
          <tr><th className="text-left w-8">#</th><th className="text-left">Position</th><th className="text-left">Staff / Status</th></tr>
        </thead>
        <tbody>
          {positionsList.map((p, i) => {
            const s = statuses[i];
            return (
              <tr key={p.id} className="border-t align-top">
                <td className="py-1">{p.needed}</td>
                <td className="py-1 font-medium">
                  <div>{p.role}</div>
                  {s.sendIndicator && (
                    <div className="text-xs text-gray-400 font-normal">{s.sendIndicator}</div>
                  )}
                </td>
                <td className="py-1">
                  {s.lines
                    ? s.lines.map((ln, idx) => (
                        <div key={idx} className={ln.state === "pending" ? "status-pending" : "status-confirmed"}>
                          {ln.text}
                          {ln.beo === "received" && (
                            <span className="text-xs text-green-600 font-normal ml-2">BEO received</span>
                          )}
                          {ln.beo === "sent" && (
                            <span className="text-xs text-gray-400 font-normal ml-2">BEO sent</span>
                          )}
                        </div>
                      ))
                    : (
                      <div className={s.state === "pending" ? "status-pending" : "status-confirmed"}>
                        {s.label}
                      </div>
                    )
                  }
                  {s.subLabel && (<div className="text-xs text-gray-400 font-normal">{s.subLabel}</div>)}
                </td>
              </tr>
            );
          })}
          {positionsList.length === 0 && (<tr><td colSpan={3} className="py-2 text-gray-400 italic">No positions defined yet</td></tr>)}
        </tbody>
      </table>
      </Link>
      {!event.cancelledAt && (
        <div className="mt-3 flex justify-center">
          <SendBeoButton eventId={event.id} action={sendBeoAction} context={beoContext} />
        </div>
      )}
    </div>
  );
}
