import { neon } from "@neondatabase/serverless";
import { nanoid } from "nanoid";

// Keep the neon() return-type inferred rather than importing a named type
// that might rename between package versions.
type Sql = ReturnType<typeof neon>;

/**
 * All idempotent DDL the app needs to run before any page query hits the DB.
 *
 * Rules of engagement:
 *   - Every CREATE TABLE uses IF NOT EXISTS
 *   - Every ALTER TABLE uses IF NOT EXISTS on the column / IF EXISTS on the
 *     constraint so re-running is a no-op
 *   - Seeding statements are guarded on "target is empty" so they only run once
 *
 * This function is safe to call on every cold start. The memoized wrapper in
 * db-init.ts makes sure we only actually run it once per serverless instance.
 */
export async function runMigrations(sql: Sql) {
  // --- Core tables (initial schema) ---
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
  await sql`CREATE INDEX IF NOT EXISTS events_company_date_idx ON events(company_id, date)`;
  await sql`CREATE TABLE IF NOT EXISTS positions (
    id TEXT PRIMARY KEY,
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('pool','individual')),
    needed INTEGER NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0,
    start_time TEXT, end_time TEXT,
    base_rate REAL, van_driving_rate REAL DEFAULT 0,
    travel_rate REAL DEFAULT 0,
    requires_van_driving BOOLEAN NOT NULL DEFAULT false,
    rate_type TEXT NOT NULL DEFAULT 'flat' CHECK (rate_type IN ('hourly','flat'))
  )`;
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

  // --- Evolutions (additive column / constraint changes shipped over time) ---
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS van_driving_instructions TEXT`;
  await sql`ALTER TABLE events ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS can_drive_van BOOLEAN DEFAULT false`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS date_of_birth TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS emergency_contact_name TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS emergency_contact_phone TEXT`;
  await sql`ALTER TABLE staff_profiles ADD COLUMN IF NOT EXISTS uniform_size TEXT`;
  await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS travel_rate REAL DEFAULT 0`;
  await sql`ALTER TABLE positions ADD COLUMN IF NOT EXISTS base_rate_mode TEXT NOT NULL DEFAULT 'flat'`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT`;
  await sql`ALTER TABLE invitations ADD COLUMN IF NOT EXISTS travel_rate REAL`;
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS priority_expire_days INTEGER`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_owner BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_settings BOOLEAN NOT NULL DEFAULT false`;
  // Any pre-existing manager is also the company owner (there was only one per
  // company before this feature existed). Idempotent on re-run.
  await sql`UPDATE users SET is_owner = true, can_edit_settings = true WHERE role = 'manager' AND is_owner = false`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_access_calendar BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_access_staff BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_access_log BOOLEAN NOT NULL DEFAULT true`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS can_access_team BOOLEAN NOT NULL DEFAULT false`;

  // Per-company role catalog + drop of the legacy positions.role enum check
  await sql`CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS roles_company_idx ON roles(company_id, sort_order)`;
  await sql`ALTER TABLE positions DROP CONSTRAINT IF EXISTS positions_role_check`;

  // Seed defaults for any company with no roles yet — matches the enum we used
  // to ship so existing events keep the same role names.
  const companiesNeedingRoles = (await sql`
    SELECT c.id FROM companies c
    LEFT JOIN roles r ON r.company_id = c.id
    WHERE r.id IS NULL
    GROUP BY c.id
  `) as Array<{ id: string }>;
  const DEFAULT_ROLES = ["Bar Lead", "Bar Back", "Bartender", "Server", "Cashier"];
  for (const { id: companyId } of companiesNeedingRoles) {
    for (let i = 0; i < DEFAULT_ROLES.length; i++) {
      await sql`INSERT INTO roles (id, company_id, name, sort_order)
                VALUES (${nanoid()}, ${companyId}, ${DEFAULT_ROLES[i]}, ${i})`;
    }
  }
}

/**
 * Module-level memoized promise — runs the migrations exactly once per
 * serverless instance (cold start). Subsequent calls no-op. If the run
 * fails (e.g. transient Neon hiccup), the promise is cleared so the next
 * request retries instead of being permanently broken.
 */
let migrationPromise: Promise<void> | null = null;

export function ensureMigrations(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  const dbUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!dbUrl) return Promise.resolve();
  const sql = neon(dbUrl);
  migrationPromise = runMigrations(sql).catch((err) => {
    // eslint-disable-next-line no-console
    console.error("[migrations] failed, will retry on next request:", err);
    migrationPromise = null;
    throw err;
  });
  return migrationPromise;
}
