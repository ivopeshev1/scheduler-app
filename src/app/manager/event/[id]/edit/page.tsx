import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { PositionsEditor, type PositionData, type InvitedStaff } from "@/components/PositionsEditor";
import { nanoid } from "nanoid";
import {
  notifyEventDetailsChanged,
  notifyPositionRemoved,
} from "@/lib/event-notifications";
import { sendEmail } from "@/lib/notifications";
import { revalidatePath } from "next/cache";

async function saveEventEditAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const eventId = String(formData.get("eventId"));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) throw new Error("Not found");

  const newValues = {
    date: String(formData.get("date")),
    clientName: String(formData.get("clientName") ?? "").trim(),
    venue: str(formData.get("venue")),
    city: str(formData.get("city")),
    eventType: str(formData.get("eventType")),
    planner: str(formData.get("planner")),
    guestCount: num(formData.get("guestCount")),
    numBars: num(formData.get("numBars")),
    checkInTime: str(formData.get("checkInTime")),
    endTime: str(formData.get("endTime")),
    staffNotes: str(formData.get("staffNotes")),
    internalNotes: str(formData.get("internalNotes")),
    vanDrivingInstructions: str(formData.get("vanDrivingInstructions")),
  };

  const changes: string[] = [];
  if (newValues.date !== event.date) changes.push(`Date: ${event.date} → ${newValues.date}`);
  if (newValues.checkInTime !== event.checkInTime) changes.push(`Check-in time updated`);
  if (newValues.endTime !== event.endTime) changes.push(`End time updated`);
  if (newValues.venue !== event.venue) changes.push(`Venue: ${event.venue ?? ""} → ${newValues.venue ?? ""}`);
  if (newValues.city !== event.city) changes.push(`City: ${event.city ?? ""} → ${newValues.city ?? ""}`);
  if (newValues.staffNotes !== event.staffNotes) changes.push(`Staff notes updated`);

  await db.update(schema.events).set(newValues).where(eq(schema.events.id, eventId));

  // ----- Positions -----
  const existingPositions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, eventId));
  const keptPositionIds = new Set<string>();

  // Collect all unique row keys by looking at role[<key>] entries
  const rowKeys = new Set<string>();
  for (const [k] of formData.entries()) {
    const m = /^role\[(.+)\]$/.exec(k);
    if (m) rowKeys.add(m[1]);
  }

  for (const key of rowKeys) {
    const role = str(formData.get(`role[${key}]`));
    if (!role) continue;
    const needed = Math.max(1, num(formData.get(`needed[${key}]`)) ?? 1);
    const rawBaseRateMode = str(formData.get(`baseRateMode[${key}]`));
    const baseRateMode: "flat" | "hourly" | "standard" =
      rawBaseRateMode === "hourly" ? "hourly"
      : rawBaseRateMode === "flat" ? "flat"
      : "standard";
    // In standard mode, baseRate is ignored (each invitee gets their onboarded rate).
    const baseRate = baseRateMode === "standard" ? null : num(formData.get(`baseRate[${key}]`));
    const vanRate = num(formData.get(`vanRate[${key}]`)) ?? 0;
    const travelRate = num(formData.get(`travelRate[${key}]`)) ?? 0;
    const requiresVan = formData.get(`vanReq[${key}]`) === "on";

    if (key.startsWith("new-")) {
      const pid = nanoid();
      await db.insert(schema.positions).values({
        id: pid, eventId, role: role as any, mode: "pool", needed,
        sortOrder: existingPositions.length + 1,
        baseRate, baseRateMode, vanDrivingRate: vanRate, travelRate,
        requiresVanDriving: requiresVan, rateType: "flat",
      });
      for (let s = 0; s < needed; s++) {
        await db.insert(schema.slots).values({ id: nanoid(), positionId: pid, index: s });
      }
    } else {
      keptPositionIds.add(key);

      // Partial-removal: un-invite selected users + notify them + free their slots
      const unInviteIds = formData.getAll(`unInvite[${key}]`).map((v) => String(v));
      if (unInviteIds.length > 0) {
        const [pos] = await db.select().from(schema.positions).where(eq(schema.positions.id, key));
        for (const uid of unInviteIds) {
          const [inv] = await db.select().from(schema.invitations).where(
            and(eq(schema.invitations.positionId, key), eq(schema.invitations.userId, uid)),
          );
          if (inv) {
            // Free their slot if they were accepted
            if (inv.slotId) {
              await db.update(schema.slots)
                .set({ acceptedUserId: null, acceptedAt: null })
                .where(eq(schema.slots.id, inv.slotId));
            }
            await db.delete(schema.invitations).where(eq(schema.invitations.id, inv.id));
            // Notify them
            if (pos && inv.sentAt) {
              const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid));
              const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, uid));
              if (u) {
                await sendEmail({
                  to: u.email,
                  subject: `Shift removed: ${event.clientName} on ${event.date}`,
                  body: [
                    `Hi ${profile?.firstName ?? ""},`, ``,
                    `Your ${pos.role} slot for this event has been removed.`,
                    `You no longer need to attend.`, ``,
                    `Client: ${event.clientName}`,
                    `Date:   ${event.date}`,
                  ].join("\n"),
                  companyId: session.companyId,
                  userId: uid,
                });
              }
            }
          }
        }
      }

      await db.update(schema.positions).set({
        role: role as any, needed, baseRate, baseRateMode,
        vanDrivingRate: vanRate, travelRate, requiresVanDriving: requiresVan,
      }).where(eq(schema.positions.id, key));
    }
  }

  // Full-removal: any existing position NOT in the form gets deleted, and its invited/accepted get notified
  for (const existing of existingPositions) {
    if (keptPositionIds.has(existing.id)) continue;
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, existing.id));
    await notifyPositionRemoved(event, existing.role, invites, session.companyId);
    await db.delete(schema.positions).where(eq(schema.positions.id, existing.id));
  }

  if (changes.length > 0) {
    const [updated] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
    if (updated) {
      await notifyEventDetailsChanged(updated, session.companyId, "Changes:\n" + changes.map((c) => `  • ${c}`).join("\n"));
    }
  }

  revalidatePath(`/manager/event/${eventId}`);
  redirect(`/manager/event/${eventId}`);
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }
function num(v: FormDataEntryValue | null): number | null { const s = v?.toString().trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, params.id));
  if (!event || event.companyId !== session.companyId) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  const positions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, event.id));
  positions.sort((a, b) => a.sortOrder - b.sortOrder);

  // Load invited staff (pending or accepted) for each position
  const positionsWithStaff: PositionData[] = [];
  for (const p of positions) {
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, p.id));
    const active = invites.filter((i) => i.status === "pending" || i.status === "accepted");
    const invitedStaff: InvitedStaff[] = [];
    for (const inv of active) {
      const [u] = await db.select().from(schema.users).where(eq(schema.users.id, inv.userId));
      const [profile] = await db.select().from(schema.staffProfiles).where(eq(schema.staffProfiles.userId, inv.userId));
      if (profile) {
        invitedStaff.push({
          userId: inv.userId,
          firstName: profile.firstName,
          lastName: profile.lastName,
          status: inv.status as any,
        });
      }
    }
    positionsWithStaff.push({
      id: p.id,
      role: p.role as any,
      needed: p.needed,
      baseRate: p.baseRate,
      baseRateMode: (p.baseRateMode ?? "standard") as "standard" | "flat" | "hourly",
      vanDrivingRate: p.vanDrivingRate,
      travelRate: p.travelRate,
      requiresVanDriving: p.requiresVanDriving,
      invitedStaff,
    });
  }

  const autocomplete = await db.select().from(schema.autocompleteValues).where(eq(schema.autocompleteValues.companyId, session.companyId));
  const suggestions = {
    venue: autocomplete.filter((a) => a.field === "venue").map((a) => a.value).sort(),
    city: autocomplete.filter((a) => a.field === "city").map((a) => a.value).sort(),
    planner: autocomplete.filter((a) => a.field === "planner").map((a) => a.value).sort(),
    eventType: autocomplete.filter((a) => a.field === "eventType").map((a) => a.value).sort(),
    clientName: autocomplete.filter((a) => a.field === "clientName").map((a) => a.value).sort(),
  };

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href={`/manager/event/${event.id}`} className="text-sm text-gray-500 hover:underline">← Back to event</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-6">Modify event</h1>

        <form action={saveEventEditAction} className="space-y-6">
          <input type="hidden" name="eventId" value={event.id} />

          <section className="grid md:grid-cols-2 gap-4">
            <Field label="Date" name="date" type="date" defaultValue={event.date} required />
            <AutocompleteField label="Client name" name="clientName" listId="ac-clientName" options={suggestions.clientName} defaultValue={event.clientName ?? ""} required />
            <AutocompleteField label="Venue" name="venue" listId="ac-venue" options={suggestions.venue} defaultValue={event.venue ?? ""} />
            <AutocompleteField label="City" name="city" listId="ac-city" options={suggestions.city} defaultValue={event.city ?? ""} />
            <AutocompleteField label="Event type" name="eventType" listId="ac-eventType" options={suggestions.eventType} defaultValue={event.eventType ?? ""} />
            <AutocompleteField label="Planner" name="planner" listId="ac-planner" options={suggestions.planner} defaultValue={event.planner ?? ""} />
            <Field label="Guest count" name="guestCount" type="number" defaultValue={event.guestCount ?? ""} />
            <Field label="Number of bars" name="numBars" type="number" defaultValue={event.numBars ?? ""} />
            <Field label="Check-in time" name="checkInTime" type="time" defaultValue={event.checkInTime ?? ""} />
            <Field label="End time" name="endTime" type="time" defaultValue={event.endTime ?? ""} />
          </section>

          <section>
            <h2 className="font-semibold mb-2">Positions</h2>
            <PositionsEditor positions={positionsWithStaff} />
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="staffNotes">Staff notes</label><textarea id="staffNotes" name="staffNotes" className="input" rows={3} defaultValue={event.staffNotes ?? ""} /></div>
            <div><label className="label" htmlFor="internalNotes">Internal notes</label><textarea id="internalNotes" name="internalNotes" className="input" rows={3} defaultValue={event.internalNotes ?? ""} /></div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="vanDrivingInstructions">Van driving instructions</label>
              <textarea id="vanDrivingInstructions" name="vanDrivingInstructions" className="input" rows={3} defaultValue={event.vanDrivingInstructions ?? ""} />
            </div>
          </section>

          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary">Save changes</button>
            <Link href={`/manager/event/${event.id}`} className="btn btn-secondary">Cancel</Link>
          </div>
        </form>
      </main>
    </div>
  );
}

function Field({ label, name, type = "text", required, defaultValue }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string | number;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} required={required} defaultValue={defaultValue} className="input" />
    </div>
  );
}

function AutocompleteField({ label, name, listId, options, required, defaultValue }: {
  label: string; name: string; listId: string; options: string[]; required?: boolean; defaultValue?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} list={listId} autoComplete="off" required={required} defaultValue={defaultValue} className="input" />
      <datalist id={listId}>
        {options.map((o) => (<option key={o} value={o} />))}
      </datalist>
    </div>
  );
}
