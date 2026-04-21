import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db, schema } from "@/db/client";
import { eq } from "drizzle-orm";
import { AppHeader } from "@/components/AppHeader";
import { nanoid } from "nanoid";

const POSITION_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"] as const;

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
    createdBy: session.userId,
  });

  for (let i = 0; i < 12; i++) {
    const role = str(formData.get(`role${i}`));
    if (!role) continue;
    const mode = (str(formData.get(`mode${i}`)) ?? "pool") as "pool" | "individual";
    const needed = Math.max(1, num(formData.get(`needed${i}`)) ?? 1);
    const baseRate = num(formData.get(`baseRate${i}`));
    const vanDrivingRate = num(formData.get(`vanRate${i}`)) ?? 0;
    const requiresVanDriving = formData.get(`vanReq${i}`) === "on";
    const rateType = (str(formData.get(`rateType${i}`)) ?? "flat") as "flat" | "hourly";

    const pid = nanoid();
    await db.insert(schema.positions).values({
      id: pid, eventId, role: role as any, mode, needed, sortOrder: i,
      baseRate, vanDrivingRate, requiresVanDriving, rateType,
    });
    for (let s = 0; s < needed; s++) {
      await db.insert(schema.slots).values({ id: nanoid(), positionId: pid, index: s });
    }
  }

  const ac = [
    { field: "venue" as const, value: str(formData.get("venue")) },
    { field: "city" as const, value: str(formData.get("city")) },
    { field: "planner" as const, value: str(formData.get("planner")) },
    { field: "clientName" as const, value: clientName },
    { field: "eventType" as const, value: str(formData.get("eventType")) },
  ];
  for (const { field, value } of ac) {
    if (!value) continue;
    const existing = await db.select().from(schema.autocompleteValues).where(eq(schema.autocompleteValues.value, value));
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

  return (
    <div>
      <AppHeader companyName={company.name} userEmail={user.email} role="manager" />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <Link href="/manager" className="text-sm text-gray-500 hover:underline">← Back to calendar</Link>
        <h1 className="text-2xl font-semibold mt-2 mb-6">New event</h1>
        <form action={createEventAction} className="space-y-6">
          <section className="grid md:grid-cols-2 gap-4">
            <Field label="Date" name="date" type="date" defaultValue={defaultDate} required />
            <Field label="Client name" name="clientName" placeholder="Marisa Cooper" required />
            <Field label="Venue" name="venue" placeholder="Private Estate" />
            <Field label="City" name="city" placeholder="Santa Barbara" />
            <Field label="Event type" name="eventType" placeholder="Wedding" />
            <Field label="Planner" name="planner" placeholder="Tamara Jensen" />
            <Field label="Guest count" name="guestCount" type="number" />
            <Field label="Number of bars" name="numBars" type="number" />
            <Field label="Check-in time" name="checkInTime" type="time" />
            <Field label="End time" name="endTime" type="time" />
          </section>

          <section>
            <h2 className="font-semibold mb-2">Positions</h2>
            <p className="text-sm text-gray-500 mb-4">
              Up to 12 position lines. <strong>Pool</strong> = multiple staff compete, first-accept-wins. <strong>Individual</strong> = one specific person per slot.
            </p>
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (<PositionRow key={i} index={i} />))}
            </div>
          </section>

          <section className="grid md:grid-cols-2 gap-4">
            <div><label className="label" htmlFor="staffNotes">Staff notes (visible to invited staff)</label><textarea id="staffNotes" name="staffNotes" className="input" rows={3} placeholder="e.g. White shirt required" /></div>
            <div><label className="label" htmlFor="internalNotes">Internal notes</label><textarea id="internalNotes" name="internalNotes" className="input" rows={3} placeholder="Manager-only reminders" /></div>
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

function Field({ label, name, type = "text", placeholder, required, defaultValue }: {
  label: string; name: string; type?: string; placeholder?: string; required?: boolean; defaultValue?: string | number;
}) {
  return (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      <input id={name} name={name} type={type} placeholder={placeholder} required={required} defaultValue={defaultValue} className="input" />
    </div>
  );
}

function PositionRow({ index }: { index: number }) {
  return (
    <div className="grid grid-cols-12 gap-2 items-end border rounded-lg p-3">
      <div className="col-span-1"><label className="label">#</label><input name={`needed${index}`} type="number" min={1} defaultValue={1} className="input" /></div>
      <div className="col-span-3"><label className="label">Role</label>
        <select name={`role${index}`} className="input" defaultValue="">
          <option value="">—</option>
          {POSITION_ROLES.map((r) => (<option key={r} value={r}>{r}</option>))}
        </select>
      </div>
      <div className="col-span-2"><label className="label">Mode</label>
        <select name={`mode${index}`} className="input" defaultValue="pool">
          <option value="pool">Pool</option><option value="individual">Individual</option>
        </select>
      </div>
      <div className="col-span-2"><label className="label">Base rate</label><input name={`baseRate${index}`} type="number" min={0} step="0.01" className="input" placeholder="0" /></div>
      <div className="col-span-2"><label className="label">Van add-on</label><input name={`vanRate${index}`} type="number" min={0} step="0.01" className="input" placeholder="0" /></div>
      <div className="col-span-1"><label className="label">Type</label>
        <select name={`rateType${index}`} className="input" defaultValue="flat">
          <option value="flat">Flat</option><option value="hourly">Hrly</option>
        </select>
      </div>
      <div className="col-span-1 flex items-center gap-1 pb-2"><input id={`vanReq${index}`} name={`vanReq${index}`} type="checkbox" /><label htmlFor={`vanReq${index}`} className="text-xs">Van</label></div>
    </div>
  );
}
