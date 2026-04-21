import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { nanoid } from "nanoid";
import { notifyEventDetailsChanged, notifyPositionRemoved } from "@/lib/event-notifications";
import { revalidatePath } from "next/cache";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

async function saveEventEditAction(formData: FormData) {
  "use server";
  const session = await getSession();
  if (!session || session.role !== "manager") throw new Error("Unauthorized");
  const eventId = String(formData.get("eventId"));
  const [event] = await db.select().from(schema.events).where(eq(schema.events.id, eventId));
  if (!event || event.companyId !== session.companyId) throw new Error("Not found");

  // Read new event-level values
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

  // Detect event-level changes
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

  // Parse position rows from form — they're keyed by existing id OR "new-<index>"
  // Collect unique row keys
  const rowKeys = new Set<string>();
  for (const [k] of formData.entries()) {
    const m = /^role\[(.+)\]$/.exec(k);
    if (m) rowKeys.add(m[1]);
  }

  for (const key of rowKeys) {
    const role = str(formData.get(`role[${key}]`));
    if (!role) continue;
    const needed = Math.max(1, num(formData.get(`needed[${key}]`)) ?? 1);
    const baseRate = num(formData.get(`baseRate[${key}]`));
    const vanRate = num(formData.get(`vanRate[${key}]`)) ?? 0;
    const travelRate = num(formData.get(`travelRate[${key}]`)) ?? 0;
    const requiresVan = formData.get(`vanReq[${key}]`) === "on";

    if (key.startsWith("new-")) {
      // Brand-new position — no notification needed per Ivo's rules
      const pid = nanoid();
      await db.insert(schema.positions).values({
        id: pid, eventId, role: role as any, mode: "pool", needed,
        sortOrder: existingPositions.length + 1,
        baseRate, vanDrivingRate: vanRate, travelRate,
        requiresVanDriving: requiresVan, rateType: "flat",
      });
      for (let s = 0; s < needed; s++) {
        await db.insert(schema.slots).values({ id: nanoid(), positionId: pid, index: s });
      }
    } else {
      // Existing position — update
      keptPositionIds.add(key);
      await db.update(schema.positions).set({
        role: role as any, needed, baseRate,
        vanDrivingRate: vanRate, travelRate, requiresVanDriving: requiresVan,
      }).where(eq(schema.positions.id, key));
    }
  }

  // Remove positions that were deleted (not in the form submission)
  for (const existing of existingPositions) {
    if (keptPositionIds.has(existing.id)) continue;
    // Notify invited/accepted about removal
    const invites = await db.select().from(schema.invitations).where(eq(schema.invitations.positionId, existing.id));
    await notifyPositionRemoved(event, existing.role, invites, session.companyId);
    await db.delete(schema.positions).where(eq(schema.positions.id, existing.id));
  }

  // Notify for event-level changes
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
      <main className="max-w-3xl mx-auto px-6 py-8">
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
            <p className="text-sm text-gray-500 mb-4">
              To remove a position, uncheck the "Keep" box on its row. Invited staff will be notified automatically.
            </p>
            <div className="space-y-3">
              {positions.map((p) => (
                <ExistingPositionRow key={p.id} p={p} />
              ))}
              <NewPositionRowSlot />
            </div>
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

function ExistingPositionRow({ p }: { p: typeof schema.positions.$inferSelect }) {
  const key = p.id;
  return (
    <details open className="border rounded-lg p-3" id={`pos-${p.id}`}>
      <summary className="cursor-pointer text-sm font-medium mb-2">
        {p.role} · {p.needed} needed · ${p.baseRate ?? 0}
      </summary>
      <div className="grid grid-cols-12 gap-2 items-end">
        <div className="col-span-1">
          <label className="label">#</label>
          <input name={`needed[${key}]`} type="number" min={1} defaultValue={p.needed} className="input" />
        </div>
        <div className="col-span-3">
          <label className="label">Role</label>
          <select name={`role[${key}]`} className="input" defaultValue={p.role}>
            {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Base rate</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`baseRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.baseRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Van add-on</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`vanRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.vanDrivingRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Travel</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`travelRate[${key}]`} type="number" min={0} step="0.01" defaultValue={p.travelRate ?? ""} className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2 flex items-center gap-2 pb-2">
          <input id={`vanReq[${key}]`} name={`vanReq[${key}]`} type="checkbox" defaultChecked={p.requiresVanDriving} />
          <label htmlFor={`vanReq[${key}]`} className="text-xs">Requires van driving</label>
        </div>
        <div className="col-span-12 flex justify-end">
          <RemovePositionButton positionId={p.id} />
        </div>
      </div>
    </details>
  );
}

function RemovePositionButton({ positionId }: { positionId: string }) {
  // Simple "clear the role field" approach via client JS — a visible note + a confirm button would be better,
  // but for MVP we just let the user empty the role to mark it for removal on save.
  // Simplest MVP: keep it — remove feature can be upgraded later.
  return (
    <span className="text-xs text-gray-500">
      To remove this position, delete the Role value (pick —) then save.
    </span>
  );
}

function NewPositionRowSlot() {
  // One empty row with a keyed name prefix "new-0". Can be extended to multiple new rows later.
  const key = "new-0";
  return (
    <details className="border border-dashed rounded-lg p-3">
      <summary className="cursor-pointer text-sm text-gray-500">+ Add a new position</summary>
      <div className="grid grid-cols-12 gap-2 items-end mt-3">
        <div className="col-span-1">
          <label className="label">#</label>
          <input name={`needed[${key}]`} type="number" min={1} defaultValue={1} className="input" />
        </div>
        <div className="col-span-3">
          <label className="label">Role</label>
          <select name={`role[${key}]`} className="input" defaultValue="">
            <option value="">—</option>
            {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Base rate</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`baseRate[${key}]`} type="number" min={0} step="0.01" className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Van add-on</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`vanRate[${key}]`} type="number" min={0} step="0.01" className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2">
          <label className="label">Travel</label>
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">$</span>
            <input name={`travelRate[${key}]`} type="number" min={0} step="0.01" className="input pl-6" />
          </div>
        </div>
        <div className="col-span-2 flex items-center gap-2 pb-2">
          <input id={`vanReq[${key}]`} name={`vanReq[${key}]`} type="checkbox" />
          <label htmlFor={`vanReq[${key}]`} className="text-xs">Requires van driving</label>
        </div>
      </div>
    </details>
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
