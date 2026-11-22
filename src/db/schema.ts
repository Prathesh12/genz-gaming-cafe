/**
 * Dr. Games — database schema (Drizzle ORM / PostgreSQL)
 *
 * MONEY
 * Every monetary column is an `integer` holding the amount in **minor units**
 * (piastres). 120.50 EGP is stored as 12050. This removes floating point drift from
 * all billing arithmetic. Convert only at the UI boundary via src/lib/money.ts.
 *
 * HISTORY
 * Financial rows (transactions, payments, food order items) carry *snapshots*
 * of names and prices, so editing a pricing rule or renaming a station never
 * rewrites past bills. Stations, categories and menu items are soft-deleted
 * (isActive = false) so historical foreign keys stay valid forever.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* -------------------------------------------------------------------------- */
/* Enums                                                                      */
/* -------------------------------------------------------------------------- */

export const roleEnum = pgEnum("role", ["ADMIN", "MANAGER", "STAFF"]);
export const colorStyleEnum = pgEnum("color_style", ["SOLID", "GRADIENT"]);
/**
 * How played time becomes money. PER_MINUTE divides the hourly price by sixty
 * and charges for the minutes actually played; SLAB charges the cheapest cover
 * from the configured durations, which rounds time up to a whole slab.
 */
export const billingModeEnum = pgEnum("billing_mode", ["PER_MINUTE", "SLAB"]);
export const pricingModelEnum = pgEnum("pricing_model", ["PER_PLAYER", "ROOM"]);
export const playstationTypeEnum = pgEnum("playstation_type", ["PS4", "PS5"]);
export const stationStatusEnum = pgEnum("station_status", [
  "AVAILABLE",
  "OCCUPIED",
  "RESERVED",
  "MAINTENANCE",
]);
export const customerTypeEnum = pgEnum("customer_type", ["REGULAR", "MEMBER"]);
export const timeBandEnum = pgEnum("time_band", ["NORMAL", "NIGHT"]);
export const pricingKindEnum = pgEnum("pricing_kind", ["SLAB", "DAY_PASS"]);
export const sessionStatusEnum = pgEnum("session_status", [
  "ACTIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
]);
export const foodOrderStatusEnum = pgEnum("food_order_status", [
  "ORDERED",
  "PREPARING",
  "READY",
  "SERVED",
  "CANCELLED",
]);
export const paymentMethodEnum = pgEnum("payment_method", ["CASH", "UPI", "SPLIT"]);
export const paymentChannelEnum = pgEnum("payment_channel", ["CASH", "UPI"]);
export const transactionStatusEnum = pgEnum("transaction_status", [
  "COMPLETED",
  "REFUNDED",
  "VOID",
]);
export const discountTypeEnum = pgEnum("discount_type", ["NONE", "FLAT", "PERCENT"]);
export const reservationStatusEnum = pgEnum("reservation_status", [
  "BOOKED",
  "STARTED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
]);

/* -------------------------------------------------------------------------- */
/* Users                                                                      */
/* -------------------------------------------------------------------------- */

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: roleEnum("role").notNull().default("STAFF"),
    isActive: boolean("is_active").notNull().default(true),
    /** Fine-grained overrides layered on top of the role defaults. */
    canDiscount: boolean("can_discount").notNull().default(false),
    /** 0-100. Caps percentage discounts this user may apply. */
    maxDiscountPercent: integer("max_discount_percent").notNull().default(0),
    /** Permission to unmask Aadhaar numbers. */
    canViewSensitive: boolean("can_view_sensitive").notNull().default(false),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_key").on(sql`lower(${t.email})`), index("users_role_idx").on(t.role)],
);

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

export const stationCategories = pgTable(
  "station_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    description: text("description"),
    /** Null for legacy station categories; required when pricingModel is ROOM. */
    playstationType: playstationTypeEnum("playstation_type"),
    /** Legacy categories retain per-player billing until explicitly converted. */
    pricingModel: pricingModelEnum("pricing_model").notNull().default("PER_PLAYER"),
    color: text("color").notNull().default("#F5C518"),
    /**
     * How many people can share one station of this category. Leave it at 1
     * for a single-seat PC; set it to 4 for PS5 multiplayer so the counter can
     * record every player and charge each of them their own rate.
     */
    maxPlayers: integer("max_players").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("station_categories_name_key").on(sql`lower(${t.name})`)],
);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => stationCategories.id),
    color: text("color").notNull().default("#F5C518"),
    /** SOLID uses `color`; GRADIENT blends `color` into `colorAccent`. */
    colorStyle: colorStyleEnum("color_style").notNull().default("SOLID"),
    colorAccent: text("color_accent").notNull().default("#FF8A00"),
    description: text("description"),
    status: stationStatusEnum("status").notNull().default("AVAILABLE"),
    maintenanceReason: text("maintenance_reason"),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("stations_code_key").on(sql`upper(${t.code})`),
    index("stations_status_idx").on(t.status),
    index("stations_category_idx").on(t.categoryId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export const pricingRules = pgTable(
  "pricing_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => stationCategories.id),
    customerType: customerTypeEnum("customer_type").notNull(),
    timeBand: timeBandEnum("time_band").notNull(),
    kind: pricingKindEnum("kind").notNull().default("SLAB"),
    /** Slab length in minutes. For DAY_PASS this is the pass validity. */
    durationMinutes: integer("duration_minutes").notNull(),
    /** ROOM rules select one total-room price for this many players. */
    playerCount: integer("player_count").notNull().default(1),
    /** Price in minor currency units (piastres for EGP). */
    price: integer("price").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pricing_rules_unique").on(
      t.categoryId,
      t.customerType,
      t.timeBand,
      t.kind,
      t.durationMinutes,
      t.playerCount,
    ),
    index("pricing_rules_category_idx").on(t.categoryId, t.isActive),
  ],
);

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export const members = pgTable(
  "members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberCode: text("member_code").notNull(),
    fullName: text("full_name").notNull(),
    mobile: text("mobile").notNull(),
    dateOfBirth: date("date_of_birth"),
    /**
     * Aadhaar at rest: `aadhaarEnc` is AES-256-GCM ciphertext, `aadhaarLast4`
     * is the only fragment ever rendered by default, `aadhaarHash` is an HMAC
     * blind index used solely for duplicate detection. Never log the plaintext,
     * never place it in a URL, never include it in a default API response.
     */
    aadhaarEnc: text("aadhaar_enc"),
    aadhaarLast4: text("aadhaar_last4"),
    aadhaarHash: text("aadhaar_hash"),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("members_code_key").on(t.memberCode),
    uniqueIndex("members_mobile_key").on(t.mobile),
    uniqueIndex("members_aadhaar_hash_key").on(t.aadhaarHash),
    index("members_name_idx").on(t.fullName),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    memberId: uuid("member_id")
      .notNull()
      .references(() => members.id, { onDelete: "cascade" }),
    startDate: timestamp("start_date", { withTimezone: true }).notNull(),
    endDate: timestamp("end_date", { withTimezone: true }).notNull(),
    /** Amount charged for this membership term, minor units. */
    price: integer("price").notNull().default(0),
    note: text("note"),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("memberships_member_idx").on(t.memberId, t.endDate),
    index("memberships_end_idx").on(t.endDate),
  ],
);

/* -------------------------------------------------------------------------- */
/* Reservations                                                               */
/* -------------------------------------------------------------------------- */

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    customerName: text("customer_name").notNull(),
    mobile: text("mobile"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    notes: text("notes"),
    status: reservationStatusEnum("status").notNull().default("BOOKED"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("reservations_station_idx").on(t.stationId, t.startTime),
    index("reservations_status_idx").on(t.status, t.startTime),
  ],
);

/* -------------------------------------------------------------------------- */
/* Sessions                                                                   */
/* -------------------------------------------------------------------------- */

export const gameSessions = pgTable(
  "game_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    memberId: uuid("member_id").references(() => members.id),
    membershipId: uuid("membership_id").references(() => memberships.id),
    customerName: text("customer_name"),
    customerMobile: text("customer_mobile"),
    customerType: customerTypeEnum("customer_type").notNull().default("REGULAR"),
    /**
     * How many people are on this station. The columns above describe player 1
     * (which keeps every existing query working); the full list lives in
     * `session_players`, and each player is charged at their own rate.
     */
    playerCount: integer("player_count").notNull().default(1),
    /** Billing model agreed at start; legacy sessions remain PER_PLAYER. */
    pricingModel: pricingModelEnum("pricing_model").notNull().default("PER_PLAYER"),
    /**
     * Active-session pricing snapshot. Stage 2 writes the applicable immutable
     * rule set here; null preserves the legacy lookup path for existing rows.
     */
    pricingSnapshot: jsonb("pricing_snapshot"),
    status: sessionStatusEnum("status").notNull().default("ACTIVE"),
    /** Source of truth for the timer. Never store a running counter. */
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** Optional target duration, grown by the "add time" action. */
    plannedMinutes: integer("planned_minutes"),
    /** Accumulated seconds from *closed* pause segments. */
    pausedSeconds: integer("paused_seconds").notNull().default(0),
    notes: text("notes"),
    startedById: uuid("started_by_id")
      .notNull()
      .references(() => users.id),
    endedById: uuid("ended_by_id").references(() => users.id),
    reservationId: uuid("reservation_id").references(() => reservations.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("game_sessions_code_key").on(t.code),
    index("game_sessions_status_idx").on(t.status),
    index("game_sessions_station_status_idx").on(t.stationId, t.status),
    index("game_sessions_started_idx").on(t.startedAt),
    // NOTE: a partial unique index guaranteeing one live session per station is
    // added in the SQL migration (Drizzle cannot express `WHERE` on uniques).
  ],
);

/**
 * Everyone sharing a station for one session.
 *
 * A single-seat session has exactly one row here — player 1 — mirroring the
 * member columns on `game_sessions`. A four-player PS5 session has four, and
 * the bill is the sum of each player priced at their own rate: whoever holds a
 * valid membership pays member rates, everyone else pays regular rates.
 *
 * `customerType`, `name` and `membershipValidUntil` are snapshots taken when
 * the player is added, so renewing or cancelling a membership afterwards can
 * never rewrite a past bill.
 */
export const sessionPlayers = pgTable(
  "session_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    /** 1-based position, used for display order and stable labels. */
    slot: integer("slot").notNull(),
    memberId: uuid("member_id").references(() => members.id),
    membershipId: uuid("membership_id").references(() => memberships.id),
    customerType: customerTypeEnum("customer_type").notNull().default("REGULAR"),
    /** Member's name at the time, or a guest name typed by the counter. */
    name: text("name"),
    membershipValidUntil: timestamp("membership_valid_until", { withTimezone: true }),
    /**
     * This player's share of the final bill, in paise. Written at checkout:
     * their own gaming charge plus an equal share of food, tax and discount.
     * Null while the session is still running.
     */
    amount: integer("amount"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("session_players_slot_key").on(t.sessionId, t.slot),
    index("session_players_session_idx").on(t.sessionId),
    index("session_players_member_idx").on(t.memberId),
    // NOTE: the SQL migration adds a partial unique index stopping the same
    // member being added twice to one session, and a CHECK that a MEMBER row
    // always carries a member id (Drizzle cannot express either here).
  ],
);

export const sessionPauses = pgTable(
  "session_pauses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    pausedAt: timestamp("paused_at", { withTimezone: true }).notNull(),
    resumedAt: timestamp("resumed_at", { withTimezone: true }),
    reason: text("reason"),
  },
  (t) => [index("session_pauses_session_idx").on(t.sessionId)],
);

export const sessionExtensions = pgTable(
  "session_extensions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    minutes: integer("minutes").notNull(),
    createdById: uuid("created_by_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_extensions_session_idx").on(t.sessionId)],
);

/* -------------------------------------------------------------------------- */
/* Food                                                                       */
/* -------------------------------------------------------------------------- */

export const foodCategories = pgTable(
  "food_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("food_categories_name_key").on(sql`lower(${t.name})`)],
);

export const foodItems = pgTable(
  "food_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => foodCategories.id),
    /** Price in minor units. */
    price: integer("price").notNull(),
    /**
     * What a member pays for this item, in minor units. Null means members pay
     * the ordinary price — so an item with no member deal needs no thought,
     * and the cafe only fills this in where it actually offers one.
     */
    memberPrice: integer("member_price"),
    description: text("description"),
    imageUrl: text("image_url"),
    /** Whole percent, e.g. 5 for 5% GST. Applied only when tax is enabled. */
    taxPercent: integer("tax_percent").notNull().default(0),
    prepMinutes: integer("prep_minutes"),
    isAvailable: boolean("is_available").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("food_items_name_category_key").on(sql`lower(${t.name})`, t.categoryId),
    index("food_items_available_idx").on(t.isActive, t.isAvailable),
  ],
);

export const foodOrders = pgTable(
  "food_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id, { onDelete: "cascade" }),
    status: foodOrderStatusEnum("status").notNull().default("ORDERED"),
    notes: text("notes"),
    createdById: uuid("created_by_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("food_orders_code_key").on(t.code),
    index("food_orders_session_idx").on(t.sessionId),
    index("food_orders_status_idx").on(t.status),
  ],
);

export const foodOrderItems = pgTable(
  "food_order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => foodOrders.id, { onDelete: "cascade" }),
    foodItemId: uuid("food_item_id")
      .notNull()
      .references(() => foodItems.id),
    /** Snapshots — the menu may change or the item may be retired later. */
    nameSnapshot: text("name_snapshot").notNull(),
    unitPrice: integer("unit_price").notNull(),
    taxPercent: integer("tax_percent").notNull().default(0),
    quantity: integer("quantity").notNull(),
    lineTotal: integer("line_total").notNull(),
    taxAmount: integer("tax_amount").notNull().default(0),
  },
  (t) => [
    index("food_order_items_order_idx").on(t.orderId),
    index("food_order_items_item_idx").on(t.foodItemId),
  ],
);

/* -------------------------------------------------------------------------- */
/* Transactions & payments                                                    */
/* -------------------------------------------------------------------------- */

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => gameSessions.id),

    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id),
    stationSnapshot: text("station_snapshot").notNull(),
    categorySnapshot: text("category_snapshot").notNull(),
    memberId: uuid("member_id").references(() => members.id),
    customerName: text("customer_name"),
    customerMobile: text("customer_mobile"),
    customerType: customerTypeEnum("customer_type").notNull().default("REGULAR"),
    /** How many people shared the station. The per-player detail is in `breakdown`. */
    playerCount: integer("player_count").notNull().default(1),

    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }).notNull(),
    /** Wall-clock minutes between start and end. */
    durationMinutes: integer("duration_minutes").notNull(),
    /** Minutes actually charged (wall clock minus paused time). */
    billedMinutes: integer("billed_minutes").notNull(),

    gamingAmount: integer("gaming_amount").notNull(),
    foodAmount: integer("food_amount").notNull(),
    taxAmount: integer("tax_amount").notNull().default(0),
    subtotal: integer("subtotal").notNull(),
    discountType: discountTypeEnum("discount_type").notNull().default("NONE"),
    /** Percent (0-100) or flat minor units, depending on discountType. */
    discountValue: integer("discount_value").notNull().default(0),
    discountAmount: integer("discount_amount").notNull().default(0),
    discountReason: text("discount_reason"),
    discountById: uuid("discount_by_id").references(() => users.id),
    totalAmount: integer("total_amount").notNull(),

    paymentMethod: paymentMethodEnum("payment_method").notNull(),
    cashAmount: integer("cash_amount").notNull().default(0),
    upiAmount: integer("upi_amount").notNull().default(0),

    status: transactionStatusEnum("status").notNull().default("COMPLETED"),
    /** Full pricing engine explanation, retained for audit. */
    breakdown: jsonb("breakdown"),
    staffId: uuid("staff_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("transactions_code_key").on(t.code),
    uniqueIndex("transactions_session_key").on(t.sessionId),
    index("transactions_created_idx").on(t.createdAt),
    index("transactions_station_created_idx").on(t.stationId, t.createdAt),
    index("transactions_method_idx").on(t.paymentMethod),
    index("transactions_status_idx").on(t.status),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transactionId: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    channel: paymentChannelEnum("channel").notNull(),
    amount: integer("amount").notNull(),
    reference: text("reference"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("payments_transaction_idx").on(t.transactionId),
    index("payments_channel_idx").on(t.channel, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Audit & settings                                                           */
/* -------------------------------------------------------------------------- */

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    userLabel: text("user_label"),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata"),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_created_idx").on(t.createdAt),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_user_idx").on(t.userId),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

export const businessSettings = pgTable("business_settings", {
  id: integer("id").primaryKey().default(1),
  cafeName: text("cafe_name").notNull().default("Dr. Games"),
  address: text("address"),
  phone: text("phone"),
  email: text("email"),
  gstNumber: text("gst_number"),
  taxEnabled: boolean("tax_enabled").notNull().default(false),
  currencySymbol: text("currency_symbol").notNull().default("EGP"),
  /** "HH:mm" local times delimiting the night gaming band. */
  nightStart: text("night_start").notNull().default("23:00"),
  nightEnd: text("night_end").notNull().default("06:00"),
  dayPassEnabled: boolean("day_pass_enabled").notNull().default(true),
  dayPassMinutes: integer("day_pass_minutes").notNull().default(720),
  membershipDays: integer("membership_days").notNull().default(365),
  membershipPrice: integer("membership_price").notNull().default(100000),
  membershipExpiryWarningDays: integer("membership_expiry_warning_days").notNull().default(30),
  /** Sessions shorter than this are not charged at all. */
  billingMode: billingModeEnum("billing_mode").notNull().default("PER_MINUTE"),
  minimumBillMinutes: integer("minimum_bill_minutes").notNull().default(1),
  /**
   * The cafe logo, uploaded from the Settings screen.
   *
   * Held in the database rather than on disk because the app runs on Vercel,
   * where the filesystem is read-only and wiped on every deploy — a file
   * written at runtime would vanish. Stored base64-encoded and always
   * re-encoded to PNG on upload, so whatever the owner picks is normalised to
   * something safe and small before it is ever served back.
   */
  logoMime: text("logo_mime"),
  logoData: text("logo_data"),
  logoUpdatedAt: timestamp("logo_updated_at", { withTimezone: true }),
  receiptFooter: text("receipt_footer").notNull().default("Thank you for gaming with us!"),
  invoicePrefix: text("invoice_prefix").notNull().default("DG"),
  invoiceCounter: integer("invoice_counter").notNull().default(0),
  /** IANA timezone used for "today", night bands and reports. */
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const stationCategoriesRelations = relations(stationCategories, ({ many }) => ({
  stations: many(stations),
  pricingRules: many(pricingRules),
}));

export const stationsRelations = relations(stations, ({ one, many }) => ({
  category: one(stationCategories, {
    fields: [stations.categoryId],
    references: [stationCategories.id],
  }),
  sessions: many(gameSessions),
  reservations: many(reservations),
}));

export const pricingRulesRelations = relations(pricingRules, ({ one }) => ({
  category: one(stationCategories, {
    fields: [pricingRules.categoryId],
    references: [stationCategories.id],
  }),
}));

export const membersRelations = relations(members, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(gameSessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  member: one(members, { fields: [memberships.memberId], references: [members.id] }),
  createdBy: one(users, { fields: [memberships.createdById], references: [users.id] }),
}));

export const gameSessionsRelations = relations(gameSessions, ({ one, many }) => ({
  station: one(stations, { fields: [gameSessions.stationId], references: [stations.id] }),
  member: one(members, { fields: [gameSessions.memberId], references: [members.id] }),
  membership: one(memberships, {
    fields: [gameSessions.membershipId],
    references: [memberships.id],
  }),
  startedBy: one(users, { fields: [gameSessions.startedById], references: [users.id] }),
  endedBy: one(users, { fields: [gameSessions.endedById], references: [users.id] }),
  reservation: one(reservations, {
    fields: [gameSessions.reservationId],
    references: [reservations.id],
  }),
  pauses: many(sessionPauses),
  extensions: many(sessionExtensions),
  players: many(sessionPlayers),
  foodOrders: many(foodOrders),
}));

export const sessionPlayersRelations = relations(sessionPlayers, ({ one }) => ({
  session: one(gameSessions, {
    fields: [sessionPlayers.sessionId],
    references: [gameSessions.id],
  }),
  member: one(members, { fields: [sessionPlayers.memberId], references: [members.id] }),
  membership: one(memberships, {
    fields: [sessionPlayers.membershipId],
    references: [memberships.id],
  }),
}));

export const sessionPausesRelations = relations(sessionPauses, ({ one }) => ({
  session: one(gameSessions, {
    fields: [sessionPauses.sessionId],
    references: [gameSessions.id],
  }),
}));

export const sessionExtensionsRelations = relations(sessionExtensions, ({ one }) => ({
  session: one(gameSessions, {
    fields: [sessionExtensions.sessionId],
    references: [gameSessions.id],
  }),
}));

export const foodCategoriesRelations = relations(foodCategories, ({ many }) => ({
  items: many(foodItems),
}));

export const foodItemsRelations = relations(foodItems, ({ one, many }) => ({
  category: one(foodCategories, {
    fields: [foodItems.categoryId],
    references: [foodCategories.id],
  }),
  orderItems: many(foodOrderItems),
}));

export const foodOrdersRelations = relations(foodOrders, ({ one, many }) => ({
  session: one(gameSessions, {
    fields: [foodOrders.sessionId],
    references: [gameSessions.id],
  }),
  createdBy: one(users, { fields: [foodOrders.createdById], references: [users.id] }),
  items: many(foodOrderItems),
}));

export const foodOrderItemsRelations = relations(foodOrderItems, ({ one }) => ({
  order: one(foodOrders, { fields: [foodOrderItems.orderId], references: [foodOrders.id] }),
  foodItem: one(foodItems, {
    fields: [foodOrderItems.foodItemId],
    references: [foodItems.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one, many }) => ({
  session: one(gameSessions, {
    fields: [transactions.sessionId],
    references: [gameSessions.id],
  }),
  station: one(stations, { fields: [transactions.stationId], references: [stations.id] }),
  member: one(members, { fields: [transactions.memberId], references: [members.id] }),
  staff: one(users, { fields: [transactions.staffId], references: [users.id] }),
  payments: many(payments),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  transaction: one(transactions, {
    fields: [payments.transactionId],
    references: [transactions.id],
  }),
}));

export const reservationsRelations = relations(reservations, ({ one }) => ({
  station: one(stations, { fields: [reservations.stationId], references: [stations.id] }),
  createdBy: one(users, { fields: [reservations.createdById], references: [users.id] }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type StationCategory = typeof stationCategories.$inferSelect;
export type Station = typeof stations.$inferSelect;
export type PricingRule = typeof pricingRules.$inferSelect;
export type Member = typeof members.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type GameSession = typeof gameSessions.$inferSelect;
export type SessionPause = typeof sessionPauses.$inferSelect;
export type SessionPlayer = typeof sessionPlayers.$inferSelect;
export type FoodCategory = typeof foodCategories.$inferSelect;
export type FoodItem = typeof foodItems.$inferSelect;
export type FoodOrder = typeof foodOrders.$inferSelect;
export type FoodOrderItem = typeof foodOrderItems.$inferSelect;
export type Transaction = typeof transactions.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type Reservation = typeof reservations.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type BusinessSettings = typeof businessSettings.$inferSelect;

export type Role = (typeof roleEnum.enumValues)[number];
export type StationStatus = (typeof stationStatusEnum.enumValues)[number];
export type ColorStyle = (typeof colorStyleEnum.enumValues)[number];
export type CustomerType = (typeof customerTypeEnum.enumValues)[number];
export type TimeBand = (typeof timeBandEnum.enumValues)[number];
export type PricingKind = (typeof pricingKindEnum.enumValues)[number];
export type SessionStatus = (typeof sessionStatusEnum.enumValues)[number];
export type FoodOrderStatus = (typeof foodOrderStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
export type PaymentChannel = (typeof paymentChannelEnum.enumValues)[number];
export type TransactionStatus = (typeof transactionStatusEnum.enumValues)[number];
export type DiscountType = (typeof discountTypeEnum.enumValues)[number];
export type ReservationStatus = (typeof reservationStatusEnum.enumValues)[number];
