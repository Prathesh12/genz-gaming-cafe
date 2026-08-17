import "server-only";

import { cache } from "react";

import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { users } from "@/db/schema";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { can, type Permission, type Role } from "@/lib/permissions";
import { createSessionToken, readSessionToken, SESSION_COOKIE, SESSION_HOURS } from "@/lib/session";

export { createSessionToken, readSessionToken, SESSION_COOKIE };

const BCRYPT_ROUNDS = 12;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
  canDiscount: boolean;
  maxDiscountPercent: number;
  canViewSensitive: boolean;
};

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_HOURS * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/**
 * The signed-in user, or null. Memoised per request so that a page rendering
 * several server components only hits the database once.
 *
 * The user row is always re-read (rather than trusting the JWT payload) so
 * deactivating an account or changing a role takes effect immediately.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const userId = await readSessionToken(token);
  if (!userId) return null;

  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      isActive: users.isActive,
      canDiscount: users.canDiscount,
      maxDiscountPercent: users.maxDiscountPercent,
      canViewSensitive: users.canViewSensitive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!row || !row.isActive) return null;

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    canDiscount: row.canDiscount,
    maxDiscountPercent: row.maxDiscountPercent,
    canViewSensitive: row.canViewSensitive,
  };
});

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AuthError();
  return user;
}

export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (!can(user, permission)) {
    throw new ForbiddenError(`Your role (${user.role.toLowerCase()}) cannot perform this action.`);
  }
  return user;
}

export async function findUserByEmail(email: string) {
  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
    .limit(1);
  return row ?? null;
}

export async function touchLastLogin(userId: string): Promise<void> {
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
}

/** Best-effort client IP for the audit log. */
export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return headerList.get("x-real-ip");
}

/* -------------------------------------------------------------------------- */
/* Login throttling                                                           */
/* -------------------------------------------------------------------------- */

/**
 * In-process sliding window. Enough to blunt password guessing on the single
 * long-lived server a cafe runs. On multi-instance serverless deployments this
 * limits per instance — see README for the Upstash/Redis upgrade path.
 */
const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function checkLoginRateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || entry.resetAt < now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function clearLoginRateLimit(key: string): void {
  attempts.delete(key);
}
