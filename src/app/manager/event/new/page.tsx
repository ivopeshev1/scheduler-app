import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq, and } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { PositionRows } from "@/components/PositionRows";
import { nanoid } from "nanoid";

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
    venue: str(formData.get("venue")), city: str(formData.get("city")),
    eventType: str(formData.get("eventType")), planner: str(formData.get("planner")),
    guestCount: num(formData.get("guestCount")), numBars: num(formData.get("numBars")),
    checkInTime: str(formData.get("checkInTime")), endTime: str(formData.get("endTime")),
    staffNotes: str(formData.get("staffNotes")), internalNotes: str(formData.get("internalNotes")),
    vanDrivingInstructions: str(formData.get("vanDrivingInstructions")),
    createdBy: session.userId,
  });

  // Scan form data for position rows — there's no fixed count now
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
    // Standard mode ignores the typed $ amount — each invitee gets their onboarded rate.
    const baseRate = baseRateMode === "standard" ? null : num(formData.get(`baseRate${i}`));
    const vanDrivingRate = num(formData.get(`vanRate${i}`)) ?? 0;
    const requiresVanDriving = formData.get(`vanReq${i}`) === "on";

    const pid = nanoid();
    await db.insert(schema.positions).values({
      id: pid, eventId, role: role as any,
      mode: "pool", // legacy column; always the same now — Priority/Backup tiers cover it
      needed, sortOrder,
      baseRate, baseRateMode, vanDrivingRate, travelRate: 0, requiresVanDriving,
      rateType: "flat",
    });
    for (let s = 0; s < needed; s++) {
      await db.insert(schema.slots).values({ id: nanoid(), positionId: pid, index: s });
    }
    sortOrder += 1;
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
  const defaultDate = searchParams.date ?? new Date().toISOString().slice(0, 10);

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
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" logoUrl={company.logoUrl} isOwner={!!user.isOwner} canEditSettings={!!user.canEditSettings} />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-6">New event</h1>
        <form action={createEventAction} className="space-y-6">
          <section className="grid md:grid-cols-2 gap-4">
            <Field label="Date" name="date" type="date" defaultValue={defaultDate} required />
            <AutocompleteField label="Client name" name="clientName" listId="ac-clientName" options={suggestions.clientName} required />
            <AutocompleteField label="Venue" name="venue" listId="ac-venue" options={suggestions.venue} />
            <AutocompleteField label="City" name="city" listId="ac-city" options={suggestions.city} />
            <AutocompleteField label="Event type" name="eventType" listId="ac-eventType" options={suggestions.eventType} />
            <AutocompleteField label="Planner" name="planner" listId="ac-planner" options={suggestions.planner} />
            <Field label="Guest count" name="guestCount" type="number" />
            <Field label="Number of bars" name="numBars" type="number" />
            <Field label="Check-in time" name="checkInTime" type="time" />
            <Field label="End time" name="endTime" type="time" />
          </section>

          <section>
            <h2 className="font-semibold mb-2">Positions</h2>
            <p className="text-sm text-gray-500 mb-4">
              Add as many positions as you need. <strong>Pool</strong> = multiple staff compete, first-accept-wins. <strong>Individual</strong> = specific person per slot.
            </p>
            <PositionRows />
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="staffNotes">Staff notes (visible to all invited staff)</label><textarea id="staffNotes" name="staffNotes" className="input" rows={3} /></div>
            <div><label className="label" htmlFor="internalNotes">Internal notes (manager only)</label><textarea id="internalNotes" name="internalNotes" className="input" rows={3} /></div>
            <div className="md:col-span-2">
              <label className="label" htmlFor="vanDrivingInstructions">
                Van driving instructions (sent only to the designated van driver)
              </label>
              <textarea
                id="vanDrivingInstructions"
                name="vanDrivingInstructions"
                className="input"
                rows={3}
                placeholder=""
              />
            </div>
          </section>

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
