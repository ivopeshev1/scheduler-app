import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, asc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { PositionsEditor, type PositionData, type InvitedStaff } from "@/components/PositionsEditor";
import { AttachmentsField } from "@/components/AttachmentsField";
import { nanoid } from "nanoid";
import { PRESET_BY_KEY } from "@/lib/event-fields";
import {
  notifyEventDetailsChanged,
  notifyPositionChanged,
  notifyPositionRemoved,
} from "@/lib/event-notifications";
import { sendEmail } from "@/lib/notifications";
import { formatDate } from "@/lib/format";
import { shellWrap, kvRow, kvTable, greeting, paragraph, banner, signoff } from "@/lib/email-html";
import { revalidatePath } from "next/cache";

async function saveEventEditAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const eventId = String(formData.get("eventId"));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) throw new Error("Not found");

  // Only overwrite a column when the form sent that field — otherwise leave
  // the existing value intact. (Disabled fields in Settings → Event fields
  // don't render on the edit form, so we don't want to null them out.)
  const pick = <T,>(key: string, transform: (v: FormDataEntryValue | null) => T, existing: T): T =>
    formData.has(key) ? transform(formData.get(key)) : existing;

  const newValues = {
    date: pick("date", (v) => String(v ?? event.date), event.date),
    clientName: pick("clientName", (v) => String(v ?? "").trim() || event.clientName, event.clientName),
    clientContactInfo: pick("clientContactInfo", str, event.clientContactInfo ?? null),
    venue: pick("venue", str, event.venue ?? null),
    city: pick("city", str, event.city ?? null),
    eventType: pick("eventType", str, event.eventType ?? null),
    planner: pick("planner", str, event.planner ?? null),
    plannerContactInfo: pick("plannerContactInfo", str, event.plannerContactInfo ?? null),
    guestCount: pick("guestCount", num, event.guestCount ?? null),
    numBars: pick("numBars", num, event.numBars ?? null),
    checkInTime: pick("checkInTime", str, event.checkInTime ?? null),
    eventStartTime: pick("eventStartTime", str, event.eventStartTime ?? null),
    endTime: pick("endTime", str, event.endTime ?? null),
    staffNotes: pick("staffNotes", str, event.staffNotes ?? null),
    internalNotes: pick("internalNotes", str, event.internalNotes ?? null),
    vanDrivingInstructions: event.vanDrivingInstructions ?? null,
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
  // Collect per-position changes to notify invited staff AFTER all DB updates settle
  const pendingPositionNotifications: Array<{ positionId: string; changes: string[] }> = [];

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

    if (key.startsWith("new-")) {
      const pid = nanoid();
      await db.insert(schema.positions).values({
        id: pid, eventId, role: role as any, mode: "pool", needed,
        sortOrder: existingPositions.length + 1,
        // Van fields: UI is gone, set the defaults so the column stays usable
        // until the Add-ons feature replaces them.
        baseRate, baseRateMode, vanDrivingRate: 0, travelRate: 0,
        requiresVanDriving: false, rateType: "flat",
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
              const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
              const companyName = company?.name ?? "Scheduler";
              const prettyDate = formatDate(event.date);
              if (u) {
                const textBody = [
                  `Hi ${profile?.firstName ?? ""},`, ``,
                  `Your ${pos.role} slot for this shift has been removed.`,
                  `You no longer need to attend.`, ``,
                  `Role:   ${pos.role}`,
                  `Date:   ${prettyDate}`,
                  `Client: ${event.clientName}`, ``,
                  `– ${companyName}`,
                ].join("\n");
                const htmlBody = shellWrap([
                  greeting(profile?.firstName, `Your ${pos.role} slot for this shift has been removed.`),
                  banner("⚠  Shift removed - you no longer need to attend.", "warning"),
                  kvTable([
                    kvRow("Role", pos.role),
                    kvRow("Date", prettyDate),
                    kvRow("Client", event.clientName),
                  ]),
                  paragraph("If you have questions, reach out to your manager.", { muted: true }),
                  signoff(companyName),
                ].join("\n"));
                await sendEmail({
                  to: u.email,
                  subject: `Shift removed: ${event.clientName} on ${prettyDate}`,
                  body: textBody,
                  html: htmlBody,
                  companyId: session.companyId,
                  userId: uid,
                });
              }
            }
          }
        }
      }

      // Detect changes that matter to invited staff on THIS position
      const existing = existingPositions.find((p) => p.id === key);
      const positionChangeLines: string[] = [];
      if (existing) {
        // Base rate: treat mode + amount as a combined concept so "Standard → $500" reads naturally
        const oldRateLabel = describeBaseRate(existing.baseRateMode, existing.baseRate);
        const newRateLabel = describeBaseRate(baseRateMode, baseRate);
        if (oldRateLabel !== newRateLabel) {
          positionChangeLines.push(`Base rate: ${oldRateLabel} → ${newRateLabel}`);
        }
      }
      pendingPositionNotifications.push({ positionId: key, changes: positionChangeLines });

      // Only update the fields the form still owns. Van-driver columns are
      // left untouched so existing rows don't get clobbered by the reduced
      // UI.
      await db.update(schema.positions).set({
        role: role as any, needed, baseRate, baseRateMode,
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

  // Upsert custom field values (fieldKey='custom[<key>]') from the form.
  for (const [k, v] of formData.entries()) {
    const m = /^custom\[(.+)\]$/.exec(k);
    if (!m) continue;
    const fieldKey = m[1];
    const value = str(v);
    const [existing] = await db
      .select()
      .from(schema.eventCustomValues)
      .where(and(eq(schema.eventCustomValues.eventId, eventId), eq(schema.eventCustomValues.fieldKey, fieldKey)));
    if (existing) {
      await db
        .update(schema.eventCustomValues)
        .set({ value })
        .where(and(eq(schema.eventCustomValues.eventId, eventId), eq(schema.eventCustomValues.fieldKey, fieldKey)));
    } else if (value) {
      await db.insert(schema.eventCustomValues).values({ eventId, fieldKey, value });
    }
  }

  // Attachments: handle removes, then new uploads (JSON from AttachmentsField).
  const removeRaw = String(formData.get("removeAttachments") ?? "[]");
  try {
    const removeIds = JSON.parse(removeRaw) as string[];
    for (const rid of removeIds) {
      await db.delete(schema.eventAttachments).where(eq(schema.eventAttachments.id, rid));
    }
  } catch {}
  const newAttachmentsRaw = String(formData.get("newAttachments") ?? "[]");
  try {
    const uploads = JSON.parse(newAttachmentsRaw) as Array<{ name: string; type: string; size: number; dataUrl: string }>;
    for (const u of uploads) {
      if (!u.dataUrl) continue;
      await db.insert(schema.eventAttachments).values({
        id: nanoid(),
        eventId,
        fileName: u.name,
        fileType: u.type,
        fileSize: u.size,
        fileData: u.dataUrl,
      });
    }
  } catch {}

  // Upsert per-event add-on descriptions. Only add-ons the company has
  // configured with includeDescription=true send this field from the UI.
  const companyAddOnsForEvent = await db.select().from(schema.addOns).where(eq(schema.addOns.companyId, session.companyId));
  for (const a of companyAddOnsForEvent) {
    if (!a.includeDescription) continue;
    const description = str(formData.get(`addonDesc[${a.id}]`));
    const [existing] = await db
      .select()
      .from(schema.eventAddOns)
      .where(and(eq(schema.eventAddOns.eventId, eventId), eq(schema.eventAddOns.addOnId, a.id)));
    if (existing) {
      await db
        .update(schema.eventAddOns)
        .set({ description })
        .where(and(eq(schema.eventAddOns.eventId, eventId), eq(schema.eventAddOns.addOnId, a.id)));
    } else {
      await db.insert(schema.eventAddOns).values({ eventId, addOnId: a.id, description });
    }
  }

  if (changes.length > 0) {
    const [updated] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
    if (updated) {
      await notifyEventDetailsChanged(updated, session.companyId, "Changes:\n" + changes.map((c) => `  • ${c}`).join("\n"));
    }
  }

  // Re-fetch the final event + position state so the email reflects reality post-save
  const [updatedEvent] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  const finalPositions = await db.select().from(schema.positions).where(eq(schema.positions.eventId, eventId));

  for (const notif of pendingPositionNotifications) {
    const pos = finalPositions.find((p) => p.id === notif.positionId);
    if (!pos) continue;
    if (notif.changes.length === 0) continue;
    if (updatedEvent) {
      // Van-instructions param is null now that the UI no longer owns it.
      await notifyPositionChanged(updatedEvent, pos, notif.changes, null, session.companyId);
    }
  }

  revalidatePath(`/manager/event/${eventId}`);
  redirect(`/manager/event/${eventId}`);
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }
function num(v: FormDataEntryValue | null): number | null { const s = v?.toString().trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

/** Render a position's base-rate choice as a human-readable phrase for change summaries. */
function describeBaseRate(mode: string | null, amount: number | null): string {
  if (mode === "standard") return "Standard (onboarded rate)";
  if (mode === "hourly") return `$${amount ?? 0}/hr`;
  return `$${amount ?? 0} flat`;
}

export default async function EditEventPage({ params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, params.id));
  if (!event || event.companyId !== session.companyId) notFound();

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessCalendar) redirect("/manager?denied=calendar");

  // Role picklist for the position dropdown - managed under Settings → Roles.
  const roleRows = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId));
  roleRows.sort((a, b) => a.sortOrder - b.sortOrder);
  const roles = roleRows.map((r) => r.name);

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

  // Company add-ons with descriptions + any saved per-event descriptions.
  const allAddOns = await db
    .select()
    .from(schema.addOns)
    .where(eq(schema.addOns.companyId, session.companyId));
  allAddOns.sort((a, b) => a.sortOrder - b.sortOrder);
  const addOnsWithDescription = allAddOns.filter((a) => a.includeDescription);
  const existingEventAddOns = await db
    .select()
    .from(schema.eventAddOns)
    .where(eq(schema.eventAddOns.eventId, event.id));
  const descriptionByAddOnId = new Map(existingEventAddOns.map((e) => [e.addOnId, e.description]));

  // Event field configs drive which inputs render.
  const fieldConfigs = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, session.companyId))
    .orderBy(asc(schema.eventFieldConfigs.sortOrder));
  const cfgByKey = new Map(fieldConfigs.map((c) => [c.fieldKey, c]));
  const isEnabled = (key: string) => {
    const cfg = cfgByKey.get(key);
    if (cfg) return cfg.enabled;
    return PRESET_BY_KEY[key]?.bucket === "required";
  };
  const isRequired = (key: string) => {
    const cfg = cfgByKey.get(key);
    return cfg ? cfg.required : PRESET_BY_KEY[key]?.bucket === "required";
  };
  const customFields = fieldConfigs.filter((c) => c.isCustom && c.enabled);
  const customValues = await db
    .select()
    .from(schema.eventCustomValues)
    .where(eq(schema.eventCustomValues.eventId, event.id));
  const customValueByKey = new Map(customValues.map((v) => [v.fieldKey, v.value ?? ""]));
  const attachmentsEnabled = isEnabled("attachments");
  const existingAttachments = attachmentsEnabled
    ? (await db
        .select({ id: schema.eventAttachments.id, fileName: schema.eventAttachments.fileName, fileType: schema.eventAttachments.fileType, fileSize: schema.eventAttachments.fileSize })
        .from(schema.eventAttachments)
        .where(eq(schema.eventAttachments.eventId, event.id)))
    : [];

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
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canAccessCalendar={!!user.canAccessCalendar} canAccessStaff={!!user.canAccessStaff} canAccessLog={!!user.canAccessLog} canAccessTeam={!!user.canAccessTeam} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href={`/manager/event/${event.id}`} className="text-sm text-gray-500 hover:underline">← Back to event</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-6">Modify event</h1>

        <form action={saveEventEditAction} className="space-y-6" encType="multipart/form-data">
          <input type="hidden" name="eventId" value={event.id} />

          <section className="grid md:grid-cols-2 gap-4">
            {isEnabled("date") && (
              <Field label="Date" name="date" type="date" defaultValue={event.date} required={isRequired("date")} />
            )}
            {isEnabled("clientName") && (
              <AutocompleteField label="Client name" name="clientName" listId="ac-clientName" options={suggestions.clientName} defaultValue={event.clientName ?? ""} required={isRequired("clientName")} />
            )}
            {isEnabled("cityAddress") && (
              <AutocompleteField label="Address / City" name="city" listId="ac-city" options={suggestions.city} defaultValue={event.city ?? ""} required={isRequired("cityAddress")} />
            )}
            {isEnabled("eventType") && (
              <AutocompleteField label="Event type" name="eventType" listId="ac-eventType" options={suggestions.eventType} defaultValue={event.eventType ?? ""} required={isRequired("eventType")} />
            )}
            {isEnabled("checkInTime") && (
              <Field label="Staff check-in time" name="checkInTime" type="time" defaultValue={event.checkInTime ?? ""} required={isRequired("checkInTime")} />
            )}
            {isEnabled("eventStartTime") && (
              <Field label="Event start time" name="eventStartTime" type="time" defaultValue={event.eventStartTime ?? ""} required={isRequired("eventStartTime")} />
            )}
            {isEnabled("endTime") && (
              <Field label="Event end time" name="endTime" type="time" defaultValue={event.endTime ?? ""} required={isRequired("endTime")} />
            )}
            {isEnabled("venue") && (
              <AutocompleteField label="Venue" name="venue" listId="ac-venue" options={suggestions.venue} defaultValue={event.venue ?? ""} required={isRequired("venue")} />
            )}
            {isEnabled("clientContactInfo") && (
              <Field label="Client contact info" name="clientContactInfo" type="text" defaultValue={event.clientContactInfo ?? ""} required={isRequired("clientContactInfo")} />
            )}
            {isEnabled("plannerName") && (
              <AutocompleteField label="Planner name" name="planner" listId="ac-planner" options={suggestions.planner} defaultValue={event.planner ?? ""} required={isRequired("plannerName")} />
            )}
            {isEnabled("plannerContactInfo") && (
              <Field label="Planner contact info" name="plannerContactInfo" type="text" defaultValue={event.plannerContactInfo ?? ""} required={isRequired("plannerContactInfo")} />
            )}
            {isEnabled("guestCount") && (
              <Field label="Number of guests" name="guestCount" type="number" defaultValue={event.guestCount ?? ""} required={isRequired("guestCount")} />
            )}
            {isEnabled("numBars") && (
              <Field label="Number of bars" name="numBars" type="number" defaultValue={event.numBars ?? ""} required={isRequired("numBars")} />
            )}
            {customFields.map((c) => (
              <div key={c.fieldKey}>
                <label className="label" htmlFor={`custom-${c.fieldKey}`}>{c.label}</label>
                <input
                  id={`custom-${c.fieldKey}`}
                  name={`custom[${c.fieldKey}]`}
                  type="text"
                  required={c.required}
                  defaultValue={customValueByKey.get(c.fieldKey) ?? ""}
                  className="input"
                />
              </div>
            ))}
          </section>

          {attachmentsEnabled && (
            <section>
              <AttachmentsField existing={existingAttachments} label="Attachments (BEO, manuals, etc.)" />
            </section>
          )}

          <section>
            <h2 className="font-semibold mb-2">Positions</h2>
            <PositionsEditor positions={positionsWithStaff} roles={roles} />
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="staffNotes">Staff notes</label><textarea id="staffNotes" name="staffNotes" className="input" rows={3} defaultValue={event.staffNotes ?? ""} /></div>
            <div><label className="label" htmlFor="internalNotes">Internal notes</label><textarea id="internalNotes" name="internalNotes" className="input" rows={3} defaultValue={event.internalNotes ?? ""} /></div>
          </section>

          {addOnsWithDescription.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Add-on descriptions</h2>
              <p className="text-sm text-gray-500 mb-4">
                Notes below only email to the staff you assign the matching add-on task to.
              </p>
              <div className="space-y-3">
                {addOnsWithDescription.map((a) => (
                  <div key={a.id}>
                    <label htmlFor={`addon-${a.id}`} className="label">{a.name}</label>
                    <textarea
                      id={`addon-${a.id}`}
                      name={`addonDesc[${a.id}]`}
                      rows={2}
                      className="input"
                      defaultValue={descriptionByAddOnId.get(a.id) ?? ""}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

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
