import { db } from "./client";
import { companies, users, staffProfiles, events, positions, slots } from "./schema";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

async function seed() {
  // idempotent: if seed already ran, bail
  const existing = await db.select().from(companies).where(eq(companies.slug, "flair-projects-sb"));
  if (existing.length > 0) {
    console.log("ℹ  Seed already exists for flair-projects-sb; skipping.");
    return;
  }

  const companyId = nanoid();
  await db.insert(companies).values({ id: companyId, name: "Flair Projects SB", slug: "flair-projects-sb" });

  const managerId = nanoid();
  await db.insert(users).values({
    id: managerId,
    companyId,
    email: "info@flairprojectsb.com",
    passwordHash: bcrypt.hashSync("password123", 10),
    role: "manager",
    inviteAcceptedAt: new Date(),
  });

  const staff = [
    { first: "Boris",   last: "Petrov",   position: "Lead" as const,      rate: 400, city: "Santa Barbara" },
    { first: "Maria",   last: "Lopez",    position: "Bartender" as const, rate: 35,  city: "Santa Barbara" },
    { first: "Peter",   last: "Johnson",  position: "Bar Back" as const,  rate: 28,  city: "Santa Barbara" },
    { first: "Kyle",    last: "Kent",     position: "Bartender" as const, rate: 35,  city: "Los Angeles"   },
    { first: "Olivia",  last: "Cooper",   position: "Server" as const,    rate: 25,  city: "Santa Barbara" },
    { first: "Silvia",  last: "Antoin",   position: "Cashier" as const,   rate: 25,  city: "Los Angeles"   },
  ];

  for (const s of staff) {
    const uid = nanoid();
    await db.insert(users).values({
      id: uid, companyId, email: `${s.first.toLowerCase()}@example.com`,
      role: "staff", inviteAcceptedAt: new Date(),
    });
    await db.insert(staffProfiles).values({
      userId: uid, firstName: s.first, lastName: s.last, phone: null, city: s.city,
      position: s.position, defaultRate: s.rate,
      defaultRateType: s.position === "Lead" ? "flat" : "hourly",
    });
  }

  const eventId = nanoid();
  await db.insert(events).values({
    id: eventId, companyId, date: "2026-01-01", clientName: "Marisa Cooper",
    venue: "Private Estate", city: "Santa Barbara", eventType: "Wedding",
    planner: "Tamara Jensen", guestCount: 1000, numBars: 2,
    checkInTime: "17:00", endTime: "22:00",
    staffNotes: "Every staff member with white shirt", internalNotes: "No van driving",
    createdBy: managerId,
  });

  const posDefs = [
    { role: "Bar Lead" as const,  mode: "individual" as const, needed: 2, base: 400, van: 0,   vanReq: false, rateType: "flat" as const },
    { role: "Bar Back" as const,  mode: "pool" as const,       needed: 1, base: 180, van: 0,   vanReq: false, rateType: "flat" as const },
    { role: "Server" as const,    mode: "pool" as const,       needed: 3, base: 25,  van: 0,   vanReq: false, rateType: "hourly" as const },
    { role: "Cashier" as const,   mode: "pool" as const,       needed: 3, base: 25,  van: 0,   vanReq: false, rateType: "hourly" as const },
    { role: "Bartender" as const, mode: "pool" as const,       needed: 4, base: 35,  van: 100, vanReq: true,  rateType: "hourly" as const },
  ];
  for (const [i, p] of posDefs.entries()) {
    const pid = nanoid();
    await db.insert(positions).values({
      id: pid, eventId, role: p.role, mode: p.mode, needed: p.needed,
      sortOrder: i, baseRate: p.base, vanDrivingRate: p.van,
      requiresVanDriving: p.vanReq, rateType: p.rateType,
    });
    for (let idx = 0; idx < p.needed; idx++) {
      await db.insert(slots).values({ id: nanoid(), positionId: pid, index: idx });
    }
  }
  console.log("✓ Seed complete");
  console.log("  Login: info@flairprojectsb.com / password123");
}

seed().catch((err) => { console.error(err); process.exit(1); });
