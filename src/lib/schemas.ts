import { z } from "zod";

import { ValidationError } from "@/lib/errors";

/* -------------------------------------------------------------------------- */
/* Primitives                                                                 */
/* -------------------------------------------------------------------------- */

export const uuidSchema = z.uuid("Invalid identifier.");

export const mobileSchema = z
  .string()
  .trim()
  .regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number.");

export const optionalMobileSchema = z
  .union([z.literal(""), mobileSchema])
  .optional()
  .transform((value) => (value ? value : null));

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Pick a colour in #RRGGBB format.");

export const hhmmSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, "Enter a time as HH:mm (24 hour).");

/** Rupees typed by a human -> paise. Rejects more than two decimal places. */
export const rupeesSchema = z
  .coerce.number({ error: "Enter a valid amount." })
  .min(0, "Amount cannot be negative.")
  .max(10_000_000, "That amount looks too large.")
  .refine((value) => Number.isFinite(value) && Math.round(value * 100) === Number((value * 100).toFixed(0)), {
    message: "Use at most two decimal places.",
  })
  .transform((value) => Math.round(value * 100));

export const minutesSchema = z.coerce
  .number({ error: "Enter a duration in minutes." })
  .int("Use whole minutes.")
  .min(1, "Duration must be at least 1 minute.")
  .max(60 * 24 * 7, "Duration cannot exceed 7 days.");

const emptyToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);

export const optionalText = (max = 500) =>
  z.preprocess(emptyToNull, z.string().trim().max(max).nullable().default(null));

export const checkboxSchema = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

export const loginSchema = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password."),
});

export const passwordSchema = z
  .string()
  .min(8, "Use at least 8 characters.")
  .max(100, "Password is too long.")
  .refine((value) => /[a-zA-Z]/.test(value) && /\d/.test(value), {
    message: "Include at least one letter and one number.",
  });

export const staffCreateSchema = z.object({
  name: z.string().trim().min(2, "Enter the staff member's name.").max(80),
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: passwordSchema,
  role: z.enum(["ADMIN", "MANAGER", "STAFF"]),
  canDiscount: checkboxSchema.default(false),
  maxDiscountPercent: z.coerce.number().int().min(0).max(100).default(0),
  canViewSensitive: checkboxSchema.default(false),
});

export const staffUpdateSchema = staffCreateSchema
  .extend({
    id: uuidSchema,
    password: z.union([z.literal(""), passwordSchema]).optional(),
    isActive: checkboxSchema.default(true),
  })
  .omit({ email: true });

/* -------------------------------------------------------------------------- */
/* Stations                                                                   */
/* -------------------------------------------------------------------------- */

export const stationCategorySchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(2, "Category name is required.").max(50),
  description: optionalText(200),
  color: hexColorSchema.default("#F5C518"),
  /**
   * Seats per station. Leave it at 1 for a single-player PC; set 4 for PS5
   * multiplayer so the counter can record each player and charge them their
   * own rate.
   */
  maxPlayers: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? 1 : value),
    z.coerce
      .number()
      .int()
      .min(1, "A station seats at least one player.")
      .max(12, "Twelve players is the most a station can seat.")
      .default(1),
  ),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const stationSchema = z.object({
  id: uuidSchema.optional(),
  code: z
    .string()
    .trim()
    .min(2, "Station code is required.")
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/, "Use letters, numbers and hyphens only (e.g. PC-01)."),
  name: z.string().trim().min(1, "Station name is required.").max(60),
  categoryId: uuidSchema,
  color: hexColorSchema.default("#F5C518"),
  colorStyle: z.enum(["SOLID", "GRADIENT"]).default("SOLID"),
  colorAccent: hexColorSchema.default("#FF8A00"),
  description: optionalText(200),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const stationStatusSchema = z.object({
  stationId: uuidSchema,
  status: z.enum(["AVAILABLE", "MAINTENANCE"]),
  maintenanceReason: optionalText(200),
});

/* -------------------------------------------------------------------------- */
/* Pricing                                                                    */
/* -------------------------------------------------------------------------- */

export const pricingRuleSchema = z.object({
  id: uuidSchema.optional(),
  categoryId: uuidSchema,
  customerType: z.enum(["REGULAR", "MEMBER"]),
  timeBand: z.enum(["NORMAL", "NIGHT"]),
  kind: z.enum(["SLAB", "DAY_PASS"]).default("SLAB"),
  durationMinutes: minutesSchema,
  price: rupeesSchema,
});

/* -------------------------------------------------------------------------- */
/* Members                                                                    */
/* -------------------------------------------------------------------------- */

export const aadhaarSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\s+/g, ""))
  .refine((value) => /^\d{12}$/.test(value), { message: "Aadhaar must be 12 digits." });

export const memberSchema = z.object({
  id: uuidSchema.optional(),
  fullName: z.string().trim().min(2, "Enter the member's full name.").max(80),
  mobile: mobileSchema,
  dateOfBirth: z.preprocess(
    emptyToNull,
    z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the date picker.")
      .nullable()
      .default(null),
  ),
  aadhaar: z.union([z.literal(""), aadhaarSchema]).optional(),
  address: optionalText(300),
  notes: optionalText(300),
});

export const membershipSchema = z.object({
  memberId: uuidSchema,
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date."),
  // The "Default term" option submits an empty string. Treat that as "not
  // chosen" rather than coercing it to 0 and failing the minimum.
  months: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? undefined : value),
    z.coerce.number().int().min(1, "Choose a duration.").max(60).optional(),
  ),
  price: rupeesSchema,
  note: optionalText(200),
});

/* -------------------------------------------------------------------------- */
/* Food                                                                       */
/* -------------------------------------------------------------------------- */

export const foodCategorySchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(2, "Category name is required.").max(50),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export const foodItemSchema = z.object({
  id: uuidSchema.optional(),
  name: z.string().trim().min(2, "Item name is required.").max(60),
  categoryId: uuidSchema,
  price: rupeesSchema,
  /** Blank means members pay the ordinary price for this item. */
  memberPrice: z.preprocess(
    (value) => (value === "" || value === null || value === undefined ? null : value),
    z
      .union([z.null(), rupeesSchema])
      .default(null),
  ),
  description: optionalText(200),
  imageUrl: z.preprocess(emptyToNull, z.url("Enter a valid image URL.").nullable().default(null)),
  taxPercent: z.coerce.number().int().min(0).max(50).default(0),
  prepMinutes: z.preprocess(emptyToNull, z.coerce.number().int().min(0).max(240).nullable().default(null)),
  isAvailable: checkboxSchema.default(true),
})
  .refine((item) => item.memberPrice === null || item.memberPrice <= item.price, {
    message: "The member price cannot be higher than the normal price.",
    path: ["memberPrice"],
  });

export const foodOrderSchema = z.object({
  sessionId: uuidSchema,
  notes: optionalText(200),
  items: z
    .array(
      z.object({
        foodItemId: uuidSchema,
        quantity: z.coerce.number().int().min(1, "Quantity must be at least 1.").max(99),
      }),
    )
    .min(1, "Add at least one item to the order."),
});

/* -------------------------------------------------------------------------- */
/* Sessions & checkout                                                        */
/* -------------------------------------------------------------------------- */

/** One seat on a shared station. A null member means a guest at regular rates. */
export const sessionPlayerSchema = z.object({
  memberId: z.preprocess(emptyToNull, uuidSchema.nullable().default(null)),
  name: optionalText(80),
});

/**
 * The roster, sent from the browser as JSON in a single form field. Absent for
 * ordinary one-seat stations, where the member and customer fields describe the
 * only player.
 */
export const sessionPlayersSchema = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const text = value.trim();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      // Hand the raw string to Zod so the failure is reported, not swallowed.
      return value;
    }
  },
  z
    .array(sessionPlayerSchema)
    .min(1, "A session needs at least one player.")
    .max(12, "Twelve players is the most a station can seat.")
    .refine(
      (players) => {
        const ids = players.map((player) => player.memberId).filter(Boolean);
        return new Set(ids).size === ids.length;
      },
      { message: "The same member is listed twice. Each player must be a different person." },
    )
    .optional(),
);

export const startSessionSchema = z.object({
  stationId: uuidSchema,
  customerName: optionalText(80),
  customerMobile: optionalMobileSchema,
  memberId: z.preprocess(emptyToNull, uuidSchema.nullable().default(null)),
  plannedMinutes: z.preprocess(emptyToNull, z.coerce.number().int().min(5).max(1440).nullable().default(null)),
  notes: optionalText(200),
  reservationId: z.preprocess(emptyToNull, uuidSchema.nullable().default(null)),
  players: sessionPlayersSchema,
});

export const setSessionPlayersSchema = z.object({
  sessionId: uuidSchema,
  players: z.array(sessionPlayerSchema).min(1).max(12),
});

export const addTimeSchema = z.object({
  sessionId: uuidSchema,
  minutes: z.coerce.number().int().min(5, "Add at least 5 minutes.").max(1440),
});

export const checkoutSchema = z
  .object({
    sessionId: uuidSchema,
    discountType: z.enum(["NONE", "FLAT", "PERCENT"]).default("NONE"),
    discountValue: z.coerce.number().min(0).default(0),
    discountReason: optionalText(160),
    paymentMethod: z.enum(["CASH", "UPI", "SPLIT"]),
    cashAmount: z.coerce.number().min(0).default(0),
    upiAmount: z.coerce.number().min(0).default(0),
    upiReference: optionalText(60),
    forceDayPass: checkboxSchema.default(false),
    /**
     * Optional manual gaming charge (in rupees) that replaces the calculated
     * one. Used when staff agree a price with the customer that the slab list
     * does not express.
     */
    overrideGamingAmount: z.preprocess(
      (value) => (value === "" || value === null || value === undefined ? undefined : value),
      z.coerce.number().min(0).max(1_000_000).optional(),
    ),
    overrideReason: optionalText(160),
    /**
     * The total the staff member saw on screen, in paise. The server
     * recalculates and rejects the checkout if the bill moved underneath them.
     */
    expectedTotal: z.coerce.number().int().min(0),
  })
  .refine((value) => value.discountType === "NONE" || value.discountValue > 0, {
    message: "Enter a discount amount.",
    path: ["discountValue"],
  })
  .refine((value) => value.discountType !== "PERCENT" || value.discountValue <= 100, {
    message: "A percentage discount cannot exceed 100%.",
    path: ["discountValue"],
  });

/* -------------------------------------------------------------------------- */
/* Reservations                                                               */
/* -------------------------------------------------------------------------- */

export const reservationSchema = z
  .object({
    id: uuidSchema.optional(),
    stationId: uuidSchema,
    customerName: z.string().trim().min(2, "Enter the customer's name.").max(80),
    mobile: optionalMobileSchema,
    startTime: z.string().min(1, "Choose a start time."),
    endTime: z.string().min(1, "Choose an end time."),
    notes: optionalText(200),
  })
  .refine((value) => new Date(value.endTime) > new Date(value.startTime), {
    message: "The end time must be after the start time.",
    path: ["endTime"],
  });

/* -------------------------------------------------------------------------- */
/* Settings                                                                   */
/* -------------------------------------------------------------------------- */

export const settingsSchema = z.object({
  cafeName: z.string().trim().min(2, "Enter the cafe name.").max(60),
  address: optionalText(200),
  phone: optionalText(20),
  email: z.preprocess(emptyToNull, z.email("Enter a valid email.").nullable().default(null)),
  gstNumber: optionalText(20),
  taxEnabled: checkboxSchema.default(false),
  currencySymbol: z.string().trim().min(1).max(3).default("₹"),
  nightStart: hhmmSchema,
  nightEnd: hhmmSchema,
  dayPassEnabled: checkboxSchema.default(true),
  dayPassMinutes: z.coerce.number().int().min(30).max(1440),
  membershipDays: z.coerce.number().int().min(1).max(3650),
  membershipPrice: rupeesSchema,
  membershipExpiryWarningDays: z.coerce.number().int().min(1).max(180),
  billingMode: z.enum(["PER_MINUTE", "SLAB"]).default("PER_MINUTE"),
  minimumBillMinutes: z.coerce.number().int().min(0).max(120),
  receiptFooter: z.string().trim().max(160).default("Thank you for gaming with us!"),
  invoicePrefix: z
    .string()
    .trim()
    .min(1)
    .max(6)
    .regex(/^[A-Za-z0-9]+$/, "Use letters and numbers only."),
  timezone: z.string().trim().min(3).max(50),
});

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Convert a FormData into a plain object, collecting `name[]` into arrays. */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.endsWith("[]")) {
      const name = key.slice(0, -2);
      const existing = result[name];
      if (Array.isArray(existing)) existing.push(value);
      else result[name] = [value];
    } else if (key in result) {
      const existing = result[key];
      if (Array.isArray(existing)) existing.push(value);
      else result[key] = [existing, value];
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Validate on the server and raise a ValidationError the UI can render. */
export function parseOrThrow<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const flattened = z.flattenError(result.error);
    const fieldErrors = flattened.fieldErrors as Record<string, string[]>;
    const firstMessage =
      Object.values(fieldErrors).flat()[0] ??
      flattened.formErrors[0] ??
      "Please check the values you entered.";
    throw new ValidationError(firstMessage, fieldErrors);
  }
  return result.data;
}
