import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { runMigrations } from "@/lib/migrations";

/**
 * One-click bootstrap endpoint. The DDL migrations also auto-run on every cold
 * start via the root layout, so hitting this URL is optional going forward -
 * it's mainly here to also seed the Flair Projects SB demo data on a fresh DB.
 * Idempotent: safe to call multiple times.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || key !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized - append ?key=AUTH_SECRET" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "No DATABASE_URL. Attach Postgres in Vercel Storage." }, { status: 500 });
  }

  await runMigrations();
  const sql = neon(dbUrl);

  // Seed the demo company only once - if it already exists, we're done.
  const [existing] = await sql`SELECT id FROM companies WHERE slug = 'flair-projects-sb' LIMIT 1` as any[];
  if (!existing) {
    const companyId = nanoid();
    await sql`INSERT INTO companies (id, name, slug) VALUES (${companyId}, 'Flair Projects SB', 'flair-projects-sb')`;

    const managerId = nanoid();
    const pwHash = bcrypt.hashSync("password123", 10);
    await sql`INSERT INTO users (id, company_id, email, password_hash, role, invite_accepted_at)
              VALUES (${managerId}, ${companyId}, 'info@flairprojectsb.com', ${pwHash}, 'manager', now())`;

    const staff = [
      { first: "Boris",  last: "Petrov",   position: "Lead",      rate: 400, city: "Santa Barbara", type: "flat" },
      { first: "Maria",  last: "Lopez",    position: "Bartender", rate: 35,  city: "Santa Barbara", type: "hourly" },
      { first: "Peter",  last: "Johnson",  position: "Bar Back",  rate: 28,  city: "Santa Barbara", type: "hourly" },
      { first: "Kyle",   last: "Kent",     position: "Bartender", rate: 35,  city: "Los Angeles",   type: "hourly" },
      { first: "Olivia", last: "Cooper",   position: "Server",    rate: 25,  city: "Santa Barbara", type: "hourly" },
      { first: "Silvia", last: "Antoin",   position: "Cashier",   rate: 25,  city: "Los Angeles",   type: "hourly" },
    ];
    for (const s of staff) {
      const uid = nanoid();
      await sql`INSERT INTO users (id, company_id, email, role, invite_accepted_at)
                VALUES (${uid}, ${companyId}, ${s.first.toLowerCase() + "@example.com"}, 'staff', now())`;
      await sql`INSERT INTO staff_profiles (user_id, first_name, last_name, city, position, default_rate, default_rate_type)
                VALUES (${uid}, ${s.first}, ${s.last}, ${s.city}, ${s.position}, ${s.rate}, ${s.type})`;
    }

    const eventId = nanoid();
    await sql`INSERT INTO events (id, company_id, date, client_name, venue, city, event_type, planner, guest_count, num_bars, check_in_time, end_time, staff_notes, internal_notes, created_by)
              VALUES (${eventId}, ${companyId}, '2026-01-01', 'Marisa Cooper', 'Private Estate', 'Santa Barbara', 'Wedding', 'Tamara Jensen', 1000, 2, '17:00', '22:00', 'Every staff member with white shirt', 'No van driving', ${managerId})`;

    const posDefs = [
      { role: "Bar Lead",  mode: "individual", needed: 2, base: 400, van: 0,   vanReq: false, rateType: "flat" },
      { role: "Bar Back",  mode: "pool",       needed: 1, base: 180, van: 0,   vanReq: false, rateType: "flat" },
      { role: "Server",    mode: "pool",       needed: 3, base: 25,  van: 0,   vanReq: false, rateType: "hourly" },
      { role: "Cashier",   mode: "pool",       needed: 3, base: 25,  van: 0,   vanReq: false, rateType: "hourly" },
      { role: "Bartender", mode: "pool",       needed: 4, base: 35,  van: 100, vanReq: true,  rateType: "hourly" },
    ];
    for (const [i, p] of posDefs.entries()) {
      const pid = nanoid();
      await sql`INSERT INTO positions (id, event_id, role, mode, needed, sort_order, base_rate, van_driving_rate, requires_van_driving, rate_type)
                VALUES (${pid}, ${eventId}, ${p.role}, ${p.mode}, ${p.needed}, ${i}, ${p.base}, ${p.van}, ${p.vanReq}, ${p.rateType})`;
      for (let idx = 0; idx < p.needed; idx++) {
        await sql`INSERT INTO slots (id, position_id, index) VALUES (${nanoid()}, ${pid}, ${idx})`;
      }
    }
  }

  return NextResponse.json({
    ok: true,
    message: "Database ready. Migrations auto-run on every cold start - you don't need to call this endpoint again.",
  });
}
