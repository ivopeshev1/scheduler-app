import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and, asc } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { PositionRows } from "@/components/PositionRows";
import { AttachmentsField } from "@/components/AttachmentsField";
import { nanoid } from "nanoid";
import { PRESET_BY_KEY } from "@/lib/event-fields";

async function createEventAction(formData: FormData) {
  "use server";
  const session = await (await import("@/lib/auth")).getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");

  const eventId = nanoid();
  const date = String(formData.get("date"));
  const clientName = String(formData.get("clientName") ?? "").trim();
  if (!date || !clientName) throw new Error("Date and client name are required");

  await db.insert(schema.events).values({
    id: eventId, companyId: session.companyId, date, clientName,
    clientContactInfo: str(formData.get("clientContactInfo")),
    venue: str(formData.get("venue")), city: str(formData.get("city")),
    eventType: str(formData.get("eventType")), planner: str(formData.get("planner")),
    plannerContactInfo: str(formData.get("plannerContactInfo")),
    guestCount: num(formData.get("guestCount")), numBars: num(formData.get("numBars")),
    checkInTime: str(formData.get("checkInTime")),
    eventStartTime: str(formData.get("eventStartTime")),
    endTime: str(formData.get("endTime")),
    staffNotes: str(formData.get("staffNotes")), internalNotes: str(formData.get("internalNotes")),
    // Van instructions UI was removed; field kept on the row as null for
    // backwards compat until the generalized Add-ons feature ships.
    vanDrivingInstructions: null,
    createdBy: session.userId,
  });

  // Persist any custom-field values (fieldKey='custom_xxx') the form sent.
  for (const [k, v] of formData.entries()) {
    const m = /^custom\[(.+)\]$/.exec(k);
    if (!m) continue;
    const value = str(v);
    if (value) {
      await db.insert(schema.eventCustomValues).values({
        eventId,
        fieldKey: m[1],
        value,
      }).onConflictDoNothing();
    }
  }

  // Persist newly-uploaded attachments. `newAttachments` is JSON from
  // AttachmentsField: array of { name, type, size, dataUrl }.
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

  // Scan form data for position rows - there's no fixed count now
  const positionIndexes = new Set<number>();
  for (const [key] of formData.entries()) {
    const m = /^role(\d+)$/.exec(key);
    if (m) positionIndexes.add(Number(m[1]));
  }

  let sortOrder = 0;
  for (const i of Array.from(positionIndexes).sort((a, b) => a - b)) {
    const role = str(formData.get(`role${i}`));
    if (!role) continue;
    const needed = Math.max(1, num(formData.get(`needed${i}`)) ?? 1);
    const rawBaseRateMode = str(formData.get(`baseRateMode${i}`));
    const baseRateMode: "flat" | "hourly" | "standard" =
      rawBaseRateMode === "hourly" ? "hourly"
      : rawBaseRateMode === "flat" ? "flat"
      : "standard";
    // Standard mode ignores the typed $ amount - each invitee gets their onboarded rate.
    const baseRate = baseRateMode === "standard" ? null : num(formData.get(`baseRate${i}`));
    const vanDrivingRate = num(formData.get(`vanRate${i}`)) ?? 0;
    const requiresVanDriving = formData.get(`vanReq${i}`) === "on";

    const pid = nanoid();
    await db.insert(schema.positions).values({
      id: pid, eventId, role: role as any,
      mode: "pool", // legacy column; always the same now - Priority/Backup tiers cover it
      needed, sortOrder,
      baseRate, baseRateMode, vanDrivingRate, travelRate: 0, requiresVanDriving,
      rateType: "flat",
    });
    for (let s = 0; s < needed; s++) {
      await db.insert(schema.slots).values({ id: nanoid(), positionId: pid, index: s });
    }
    sortOrder += 1;
  }

  // Per-event add-on descriptions. For each add-on with includeDescription,
  // the form sends addonDesc[<addOnId>]. Even blank descriptions get a row
  // so the add-on is considered "wired up" on this event (gives the staff
  // picker something to attach to).
  const companyAddOns = await db.select().from(schema.addOns).where(eq(schema.addOns.companyId, session.companyId));
  for (const a of companyAddOns) {
    const key = `addonDesc[${a.id}]`;
    if (!formData.has(key) && !a.includeDescription) continue;
    const description = a.includeDescription ? str(formData.get(key)) : null;
    await db.insert(schema.eventAddOns).values({
      eventId,
      addOnId: a.id,
      description,
    }).onConflictDoNothing();
  }

  // Persist autocomplete values for next time
  const ac = [
    { field: "venue" as const, value: str(formData.get("venue")) },
    { field: "city" as const, value: str(formData.get("city")) },
    { field: "planner" as const, value: str(formData.get("planner")) },
    { field: "clientName" as const, value: clientName },
    { field: "eventType" as const, value: str(formData.get("eventType")) },
  ];
  for (const { field, value } of ac) {
    if (!value) continue;
    const existing = await db
      .select()
      .from(schema.autocompleteValues)
      .where(and(eq(schema.autocompleteValues.companyId, session.companyId), eq(schema.autocompleteValues.field, field), eq(schema.autocompleteValues.value, value)));
    if (existing.length === 0) {
      await db.insert(schema.autocompleteValues).values({ id: nanoid(), companyId: session.companyId, field, value });
    }
  }

  redirect(`/manager/event/${eventId}`);
}

function str(v: FormDataEntryValue | null): string | null { const s = (v?.toString() ?? "").trim(); return s || null; }
function num(v: FormDataEntryValue | null): number | null { const s = v?.toString().trim(); if (!s) return null; const n = Number(s); return Number.isFinite(n) ? n : null; }

export default async function NewEventPage({ searchParams }: { searchParams: { date?: string } }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "manager") redirect("/staff");

  const [company] = await db.select().from(schema.companies).where(eq(schema.companies.id, session.companyId));
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, session.userId));
  if (!user) redirect("/login");
  if (!user.isOwner && !user.canAccessCalendar) redirect("/manager?denied=calendar");
  const defaultDate = searchParams.date ?? new Date().toISOString().slice(0, 10);

  // Pull the role picklist from Settings → Roles so the dropdowns stay in sync
  // with whatever the owner currently has configured.
  const roleRows = await db
    .select()
    .from(schema.roles)
    .where(eq(schema.roles.companyId, session.companyId));
  roleRows.sort((a, b) => a.sortOrder - b.sortOrder);
  const roles = roleRows.map((r) => r.name);

  // Company add-ons that exposed a description textbox when configured in
  // Settings. Only these render on the event setup page — add-ons without a
  // description are purely a per-invitation assignment handled on the staff
  // picker.
  const allAddOns = await db
    .select()
    .from(schema.addOns)
    .where(eq(schema.addOns.companyId, session.companyId));
  allAddOns.sort((a, b) => a.sortOrder - b.sortOrder);
  const addOnsWithDescription = allAddOns.filter((a) => a.includeDescription);

  // Event field configs: which preset fields are enabled, plus any custom
  // fields the owner has added. Drives what renders on the form below.
  const fieldConfigs = await db
    .select()
    .from(schema.eventFieldConfigs)
    .where(eq(schema.eventFieldConfigs.companyId, session.companyId))
    .orderBy(asc(schema.eventFieldConfigs.sortOrder));
  const cfgByKey = new Map(fieldConfigs.map((c) => [c.fieldKey, c]));
  const isEnabled = (key: string) => {
    const cfg = cfgByKey.get(key);
    if (cfg) return cfg.enabled;
    // Preset fields that default to required+enabled show even without a
    // row (should be rare after migrations run, but defensive).
    return PRESET_BY_KEY[key]?.bucket === "required";
  };
  const isRequired = (key: string) => {
    const cfg = cfgByKey.get(key);
    return cfg ? cfg.required : PRESET_BY_KEY[key]?.bucket === "required";
  };
  const customFields = fieldConfigs.filter((c) => c.isCustom && c.enabled);
  const attachmentsEnabled = isEnabled("attachments");

  const autocomplete = await db
    .select()
    .from(schema.autocompleteValues)
    .where(eq(schema.autocompleteValues.companyId, session.companyId));
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
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-6">New event</h1>
        <form action={createEventAction} className="space-y-6" encType="multipart/form-data">
          <section className="grid md:grid-cols-2 gap-4">
            {isEnabled("date") && (
              <Field label="Date" name="date" type="date" defaultValue={defaultDate} required={isRequired("date")} />
            )}
            {isEnabled("clientName") && (
              <AutocompleteField label="Client name" name="clientName" listId="ac-clientName" options={suggestions.clientName} required={isRequired("clientName")} />
            )}
            {isEnabled("cityAddress") && (
              <AutocompleteField label="Address / City" name="city" listId="ac-city" options={suggestions.city} required={isRequired("cityAddress")} />
            )}
            {isEnabled("eventType") && (
              <AutocompleteField label="Event type" name="eventType" listId="ac-eventType" options={suggestions.eventType} required={isRequired("eventType")} />
            )}
            {isEnabled("checkInTime") && (
              <Field label="Staff check-in time" name="checkInTime" type="time" required={isRequired("checkInTime")} />
            )}
            {isEnabled("eventStartTime") && (
              <Field label="Event start time" name="eventStartTime" type="time" required={isRequired("eventStartTime")} />
            )}
            {isEnabled("endTime") && (
              <Field label="Event end time" name="endTime" type="time" required={isRequired("endTime")} />
            )}
            {isEnabled("venue") && (
              <AutocompleteField label="Venue" name="venue" listId="ac-venue" options={suggestions.venue} required={isRequired("venue")} />
            )}
            {isEnabled("clientContactInfo") && (
              <Field label="Client contact info" name="clientContactInfo" type="text" required={isRequired("clientContactInfo")} />
            )}
            {isEnabled("plannerName") && (
              <AutocompleteField label="Planner name" name="planner" listId="ac-planner" options={suggestions.planner} required={isRequired("plannerName")} />
            )}
            {isEnabled("plannerContactInfo") && (
              <Field label="Planner contact info" name="plannerContactInfo" type="text" required={isRequired("plannerContactInfo")} />
            )}
            {isEnabled("guestCount") && (
              <Field label="Number of guests" name="guestCount" type="number" required={isRequired("guestCount")} />
            )}
            {isEnabled("numBars") && (
              <Field label="Number of bars" name="numBars" type="number" required={isRequired("numBars")} />
            )}
            {customFields.map((c) => (
              <div key={c.fieldKey}>
                <label className="label" htmlFor={`custom-${c.fieldKey}`}>{c.label}</label>
                <input
                  id={`custom-${c.fieldKey}`}
                  name={`custom[${c.fieldKey}]`}
                  type="text"
                  required={c.required}
                  className="input"
                />
              </div>
            ))}
          </section>

          {attachmentsEnabled && (
            <section>
              <AttachmentsField existing={[]} label="Attachments (BEO, manuals, etc.)" />
            </section>
          )}

          <section>
            <h2 className="font-semibold mb-2">Positions</h2>
            <p className="text-sm text-gray-500 mb-4">
              Add as many positions as you need. <strong>Pool</strong> = multiple staff compete, first-accept-wins. <strong>Individual</strong> = specific person per slot.
            </p>
            <PositionRows roles={roles} />
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="staffNotes">Staff notes (visible to all invited staff)</label><textarea id="staffNotes" name="staffNotes" className="input" rows={3} /></div>
            <div><label className="label" htmlFor="internalNotes">Internal notes (manager only)</label><textarea id="internalNotes" name="internalNotes" className="input" rows={3} /></div>
          </section>

          {addOnsWithDescription.length > 0 && (
            <section>
              <h2 className="font-semibold mb-2">Add-on descriptions</h2>
              <p className="text-sm text-gray-500 mb-4">
                These text boxes come from add-ons you configured in Settings → Add-ons with
                &quot;include description&quot;. Anything you write here only emails to the specific
                staff you assign the add-on task to on the invite step.
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
                      placeholder={`Notes for the ${a.name.toLowerCase()}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          )}

          <div className="flex gap-3">
            <button type="submit" className="btn btn-primary">Create event</button>
            <Link href="/manager" className="btn btn-secondary">Cancel</Link>
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

function AutocompleteField({ label, name, listId, options, required }: {
  label: string; name: string; listId: string; options: string[]; required?: boolean;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} list={listId} autoComplete="off" required={required} className="input" />
      <datalist id={listId}>
        {options.map((o) => (<option key={o} value={o} />))}
      </datalist>
    </div>
  );
}
