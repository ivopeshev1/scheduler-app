import { pgTable, text, integer, real, boolean, timestamp, index, uniqueIndex, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const companies = pgTable("companies", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  // Auto-expire priority invites after this many days if no response. NULL means
  // never auto-expire (manager handles manually). Set per-company via Settings.
  priorityExpireDays: integer("priority_expire_days"),
  // Blob of opt-in channel + frequency settings for every notification type
  // that can be sent to staff or to the manager. Shape is defined by
  // NotificationSettings in src/lib/notification-settings.ts. NULL means
  // "use all defaults".
  notificationSettings: jsonb("notification_settings"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    passwordHash: text("password_hash"),
    role: text("role", { enum: ["manager", "staff"] }).notNull(),
    // Company owner (the account that signed up). There's at most one per company.
    // Owners have unconditional access to every nav area, regardless of the
    // per-area flags below.
    isOwner: boolean("is_owner").notNull().default(false),
    // Per-area access flags for non-owner managers. Each corresponds to a top
    // nav item; the owner toggles these when adding a manager (or later on
    // the Team page). Calendar/Staff/Log default to granted - those are the
    // usual day-to-day tabs - Team + Settings default denied.
    // canEditSettings covers both /manager/settings and /manager/notifications
    // (the notification rules live inside Settings now).
    canAccessCalendar: boolean("can_access_calendar").notNull().default(true),
    canAccessStaff: boolean("can_access_staff").notNull().default(true),
    canAccessLog: boolean("can_access_log").notNull().default(true),
    canAccessTeam: boolean("can_access_team").notNull().default(false),
    canEditSettings: boolean("can_edit_settings").notNull().default(false),
    inviteToken: text("invite_token"),
    inviteAcceptedAt: timestamp("invite_accepted_at", { withTimezone: true }),
    // Soft-delete: when archived, filtered out of staff list and all pickers.
    // Pending invitations can still exist in the DB; manager handles any
    // accepted shifts through Edit Event before archiving.
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailCompanyIdx: uniqueIndex("users_email_company_idx").on(t.email, t.companyId),
    inviteTokenIdx: index("users_invite_token_idx").on(t.inviteToken),
  })
);

export const staffProfiles = pgTable("staff_profiles", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  phone: text("phone"),
  city: text("city"),
  position: text("position", { enum: ["Lead", "Bartender", "Bar Back", "Server", "Cashier"] }).notNull(),
  defaultRate: real("default_rate"),
  defaultRateType: text("default_rate_type", { enum: ["hourly", "flat", "both"] }),
  canDriveVan: boolean("can_drive_van").default(false),
  dateOfBirth: text("date_of_birth"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  uniformSize: text("uniform_size"),
});

// Per-company catalog of optional event "add-on" tasks (van driver, setup
// crew, early-arrival lead, whatever). Each add-on defines a default
// compensation template and whether events should expose an extra description
// textarea when the add-on is enabled. Companies start with zero add-ons and
// add what fits their business.
export const addOns = pgTable(
  "add_ons",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // Same three-mode pattern positions.baseRate uses: "standard" means no
    // default amount is set (manager fills it in per event), "flat" or
    // "hourly" means the amount below is the preset.
    compensationMode: text("compensation_mode", { enum: ["standard", "flat", "hourly"] }).notNull().default("standard"),
    compensationAmount: real("compensation_amount"),
    includeDescription: boolean("include_description").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("add_ons_company_idx").on(t.companyId, t.sortOrder),
  })
);

// Per-company catalog of event roles (Bar Lead, Bartender, etc). Managers
// maintain this from Settings → Roles. The positions table stores the role as
// a plain string (not an FK), so removing a role from this catalog doesn't
// break historical events - it just hides the role from future dropdowns.
export const roles = pgTable(
  "roles",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyIdx: index("roles_company_idx").on(t.companyId, t.sortOrder),
  })
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    clientName: text("client_name").notNull(),
    venue: text("venue"),
    city: text("city"),
    eventType: text("event_type"),
    planner: text("planner"),
    guestCount: integer("guest_count"),
    numBars: integer("num_bars"),
    checkInTime: text("check_in_time"),
    endTime: text("end_time"),
    staffNotes: text("staff_notes"),
    internalNotes: text("internal_notes"),
    vanDrivingInstructions: text("van_driving_instructions"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdBy: text("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dateIdx: index("events_company_date_idx").on(t.companyId, t.date),
  })
);

export const positions = pgTable("positions", {
  id: text("id").primaryKey(),
  eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
  // Role is open text now - the per-company `roles` table is the canonical
  // picklist, but we store the string directly on positions so deleting a role
  // from Settings doesn't invalidate historical events.
  role: text("role").notNull(),
  mode: text("mode", { enum: ["pool", "individual"] }).notNull(),
  needed: integer("needed").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  startTime: text("start_time"),
  endTime: text("end_time"),
  baseRate: real("base_rate"),
  // How to interpret baseRate:
  //   "standard" → ignore baseRate; use each invitee's onboarded profile rate
  //   "flat"     → baseRate is the flat dollar amount for the whole shift
  //   "hourly"   → baseRate is the hourly rate (overrides the staff's onboarded rate)
  baseRateMode: text("base_rate_mode", { enum: ["flat", "hourly", "standard"] }).notNull().default("standard"),
  vanDrivingRate: real("van_driving_rate").default(0),
  travelRate: real("travel_rate").default(0),
  requiresVanDriving: boolean("requires_van_driving").notNull().default(false),
  rateType: text("rate_type", { enum: ["hourly", "flat"] }).notNull().default("flat"),
});

export const slots = pgTable("slots", {
  id: text("id").primaryKey(),
  positionId: text("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
  index: integer("index").notNull(),
  acceptedUserId: text("accepted_user_id").references(() => users.id),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
});

export const invitations = pgTable(
  "invitations",
  {
    id: text("id").primaryKey(),
    positionId: text("position_id").notNull().references(() => positions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    tier: integer("tier").notNull().default(0),
    status: text("status", { enum: ["pending", "accepted", "rejected", "expired", "filled"] }).notNull().default("pending"),
    slotId: text("slot_id").references(() => slots.id),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    token: text("token").notNull().unique(),
    // Per-invitee travel comp. Manager sets it in the StaffPicker when drafting
    // the invite, because travel cost depends on where the individual is coming
    // from - it's not a property of the position.
    travelRate: real("travel_rate"),
  },
  (t) => ({
    positionTierIdx: index("invitations_position_tier_idx").on(t.positionId, t.tier),
    userStatusIdx: index("invitations_user_status_idx").on(t.userId, t.status),
  })
);

// Per-event per-add-on configuration. The description field is the shared
// text that goes out to every invitee assigned to that add-on on this event
// (replaces the old van_driving_instructions column, generalized). Row
// exists only for add-ons the event actually uses.
export const eventAddOns = pgTable(
  "event_add_ons",
  {
    eventId: text("event_id").notNull().references(() => events.id, { onDelete: "cascade" }),
    addOnId: text("add_on_id").notNull().references(() => addOns.id, { onDelete: "cascade" }),
    description: text("description"),
  },
  (t) => ({
    pk: uniqueIndex("event_add_ons_pk").on(t.eventId, t.addOnId),
  })
);

// Per-invitation add-on assignments. Row = "this invitee is doing that task
// on this event." compensationAmount is the $ the manager typed in the staff
// picker for this specific person + task combo; null means they ticked the
// box but haven't entered an amount (treated as $0 in emails).
export const invitationAddOns = pgTable(
  "invitation_add_ons",
  {
    invitationId: text("invitation_id").notNull().references(() => invitations.id, { onDelete: "cascade" }),
    addOnId: text("add_on_id").notNull().references(() => addOns.id, { onDelete: "cascade" }),
    compensationAmount: real("compensation_amount"),
  },
  (t) => ({
    pk: uniqueIndex("invitation_add_ons_pk").on(t.invitationId, t.addOnId),
  })
);

export const availabilityBlocks = pgTable(
  "availability_blocks",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: text("date").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userDateIdx: uniqueIndex("availability_user_date_idx").on(t.userId, t.date),
  })
);

export const autocompleteValues = pgTable(
  "autocomplete_values",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    field: text("field", { enum: ["venue", "city", "planner", "clientName", "eventType"] }).notNull(),
    value: text("value").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: uniqueIndex("autocomplete_lookup_idx").on(t.companyId, t.field, t.value),
  })
);

export const notifications = pgTable("notifications", {
  id: text("id").primaryKey(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id),
  channel: text("channel", { enum: ["email", "sms"] }).notNull(),
  subject: text("subject"),
  body: text("body").notNull(),
  status: text("status", { enum: ["queued", "sent", "failed", "dev-logged"] }).notNull(),
  errorMessage: text("error_message"),
  relatedInvitationId: text("related_invitation_id").references(() => invitations.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
