/**
 * Application errors that are safe to show to a member of staff.
 *
 * Anything that is *not* an AppError is treated as unexpected: it is logged on
 * the server and reported to the user as a generic failure, so internal
 * details never leak into the UI.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code = "APP_ERROR", status = 400) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
  }
}

export class AuthError extends AppError {
  constructor(message = "You need to sign in to continue.") {
    super(message, "UNAUTHENTICATED", 401);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that.") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "That record no longer exists.") {
    super(message, "NOT_FOUND", 404);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class ValidationError extends AppError {
  readonly fieldErrors: Record<string, string[]>;

  constructor(message: string, fieldErrors: Record<string, string[]> = {}) {
    super(message, "VALIDATION", 422);
    this.name = "ValidationError";
    this.fieldErrors = fieldErrors;
  }
}

type PgError = { code?: string; constraint?: string; detail?: string; cause?: unknown };

function postgresError(error: unknown): PgError | null {
  let current = error;
  const seen = new Set<unknown>();
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as PgError;
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }
  return null;
}

/**
 * Translate a thrown value into a message that is safe and useful for staff.
 * Postgres constraint violations are mapped to plain language.
 */
export function describeError(error: unknown): { message: string; code: string } {
  if (error instanceof AppError) return { message: error.message, code: error.code };

  const pg = postgresError(error);
  if (pg) {
    switch (pg.code) {
      case "23505": {
        const constraint = pg.constraint ?? "";
        if (constraint.includes("game_sessions_one_live_per_station")) {
          return {
            message:
              "This station already has a live session — another device may have started it a moment ago. Refresh to see the current state.",
            code: "STATION_BUSY",
          };
        }
        if (constraint.includes("session_pauses_one_open")) {
          return { message: "This session is already paused.", code: "ALREADY_PAUSED" };
        }
        if (constraint.includes("stations_code_key")) {
          return { message: "A station with that code already exists.", code: "DUPLICATE" };
        }
        if (constraint.includes("members_mobile_key")) {
          return { message: "A member with that mobile number already exists.", code: "DUPLICATE" };
        }
        if (constraint.includes("members_aadhaar_hash_key")) {
          return { message: "That Aadhaar number is already registered to a member.", code: "DUPLICATE" };
        }
        if (constraint.includes("users_email_key")) {
          return { message: "An account with that email already exists.", code: "DUPLICATE" };
        }
        if (constraint.includes("pricing_rules_unique")) {
          return {
            message: "A price already exists for that category, duration and player count. Edit that existing price instead.",
            code: "DUPLICATE",
          };
        }
        if (constraint.includes("food_items_name_category_key")) {
          return { message: "That item already exists in this food category.", code: "DUPLICATE" };
        }
        return { message: "That record already exists.", code: "DUPLICATE" };
      }
      case "23503":
        return {
          message: "That record is still referenced by existing history and cannot be removed. Deactivate it instead.",
          code: "IN_USE",
        };
      case "23514":
        return { message: "The values submitted failed a database validation rule.", code: "CHECK_FAILED" };
      case "40001":
      case "40P01":
        return { message: "Another staff member changed this at the same time. Please try again.", code: "CONFLICT" };
      case "ECONNREFUSED":
      case "57P01":
        return { message: "Cannot reach the database right now. Check your connection and retry.", code: "DB_DOWN" };
      default:
        break;
    }
  }

  if (error instanceof Error && error.name === "PricingError") {
    return { message: error.message, code: "PRICING" };
  }

  console.error("[genz] Unexpected error:", error);
  return {
    message: "Something went wrong on our side. The action was not completed — please try again.",
    code: "INTERNAL",
  };
}

/** Standard shape returned by every server action. */
export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: string; fieldErrors?: Record<string, string[]> };

export function actionOk(): ActionResult<undefined>;
export function actionOk<T>(data: T): ActionResult<T>;
export function actionOk<T>(data?: T): ActionResult<T | undefined> {
  return { ok: true, data };
}

export function actionError(error: unknown): ActionResult<never> {
  const { message, code } = describeError(error);
  const fieldErrors = error instanceof ValidationError ? error.fieldErrors : undefined;
  return { ok: false, error: message, code, fieldErrors };
}
