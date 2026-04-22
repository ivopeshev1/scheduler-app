import { NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";

/**
 * One-time DB bootstrap. Visit /api/setup?key=<AUTH_SECRET> once after
 * attaching Vercel Postgres. Creates all tables + seeds demo data.
 * Idempotent: safe to call multiple times.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = url.searchParams.get("key");
  if (!key || key !== process.env.AUTH_SECRET) {
    return NextResponse.json({ error: "Unauthorized — append ?key=AUTH_SECRET" }, { status: 401 });
  }

  const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!dbUrl) {
    return NextResponse.json({ error: "No DATABASE_URL. Attach Postgres in Vercel Storage." }, { status: 500 });
  }

  const sql = neon(dbUrl);

  // Create tables
  await sql`CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    email TEXT NOT NULL, password_hash TEXT,
    role TEXT NOT NULL CHECK (role IN ('manager','staff')),
    invite_token TEXT, invite_accepted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_email_company_idx ON users(email, company_id)`;
  await sql`CREATE INDEX IF NOT EXISTS users_invite_token_idx ON users(invite_token)`;
  await sql`CREATE TABLE IF NOT EXISTS staff_profiles (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    first_name TEXT NOT NULL, last_name TEXT NOT NULL,
    phone TEXT, city TEXT,
    position TEXT NOT NULL CHECK (position IN ('Lead','Bartender','Bar Back','Server','Cashier')),
    default_rate REAL,
    default_rate_type TEXT CHECK (default_rate_type IN ('hourly','flat','both'))
  )`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    date TEXT NOT NULL, client_name TEXT NOT NULL,
    venue TEXT, city TEXT, event_type TEXT, planner TEXT,
    guest_count INTEGER, num_bars INTEGER,
    check_in_time TEXT, end_time TEXT,
    staff_notes TEXT, internal_notes TEXT,
    van_driving_instructions TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS van_driving_instructions TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
  // New staff-profile fields added for the onboarding flow
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS can_drive_van BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS date_of_birth TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS uniform_size TEXT`;
  await sql`CREATE INDEX IF NOT EXISTS events_company_date_idx ON events(company_id, date)`;
  await sql`CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Bar Lead','Bar Back','Bartender','Server','Cashier')),
    mode TEXT NOT NULL CHECK (mode IN ('pool','individual')),
    needed INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    start_time TEXT, end_time TEXT,
    base_rate REAL, van_driving_rate REAL DEFAULT 0,
    travel_rate REAL DEFAULT 0,
    requires_van_driving BOOLEAN NOT NULL DEFAULT false,
    rate_type TEXT NOT NULL DEFAULT 'flat' CHECK (rate_type IN ('hourly','flat'))
  )`;
  // Backfill: add travel_rate if positions table was created before this column existed
  await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS travel_rate REAL DEFAULT 0`;
  // Backfill: base_rate_mode lets managers mark a position as "Standard" (use each
  // invitee's onboarded rate) instead of a flat dollar amount per shift.
  await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS base_rate_mode TEXT NOT NULL DEFAULT 'flat'`;
  // Backfill: logo_url for company branding (shown in the header)
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT`;
  // Travel comp moves from position-level to per-invitation (varies per staff)
  await sql`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS travel_rate REAL`;
  await sql`CREATE TABLE IF NOT EXISTS slots (
    id TEXT PRIMARY KEY,
    position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    index INTEGER NOT NULL,
    accepted_user_id TEXT REFERENCES users(id),
    accepted_at TIMESTAMPTZ
  )`;
  await sql`CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY,
    position_id TEXT NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tier INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','expired','filled')),
    slot_id TEXT REFERENCES slots(id),
    sent_at TIMESTAMPTZ, responded_at TIMESTAMPTZ,
    token TEXT NOT NULL UNIQUE
  )`;
  await sql`CREATE INDEX IF NOT EXISTS invitations_position_tier_idx ON invitations(position_id, tier)`;
  await sql`CREATE INDEX IF NOT EXISTS invitations_user_status_idx ON invitations(user_id, status)`;
  await sql`CREATE TABLE IF NOT EXISTS availability_blocks (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL, reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS availability_user_date_idx ON availability_blocks(user_id, date)`;
  await sql`CREATE TABLE IF NOT EXISTS autocomplete_values (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    field TEXT NOT NULL CHECK (field IN ('venue','city','planner','clientName','eventType')),
    value TEXT NOT NULL,
    last_used_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS autocomplete_lookup_idx ON autocomplete_values(company_id, field, value)`;
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
    subject TEXT, body TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('queued','sent','failed','dev-logged')),
    error_message TEXT,
    related_invitation_id TEXT REFERENCES invitations(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;

  // Seed (only if empty)
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
    message: "Database ready. Seed login: info@flairprojectsb.com / password123",
  });
}
