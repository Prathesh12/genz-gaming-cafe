"use server";

import {
  checkLoginRateLimit,
  clearLoginRateLimit,
  clearSessionCookie,
  createSessionToken,
  findUserByEmail,
  getClientIp,
  getCurrentUser,
  setSessionCookie,
  touchLastLogin,
  verifyPassword,
} from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { actionError, actionOk, AppError, type ActionResult } from "@/lib/errors";
import { formDataToObject, loginSchema, parseOrThrow } from "@/lib/schemas";

export async function loginAction(
  _prevState: ActionResult<undefined> | null,
  formData: FormData,
): Promise<ActionResult<undefined>> {
  try {
    const input = parseOrThrow(loginSchema, formDataToObject(formData));
    const ip = await getClientIp();
    const throttleKey = `${ip ?? "unknown"}:${input.email}`;

    const limit = checkLoginRateLimit(throttleKey);
    if (!limit.allowed) {
      throw new AppError(
        `Too many failed attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minute(s).`,
        "RATE_LIMITED",
        429,
      );
    }

    const user = await findUserByEmail(input.email);
    // Always run a comparison so a missing account and a wrong password take
    // the same amount of time.
    const passwordOk = user
      ? await verifyPassword(input.password, user.passwordHash)
      : await verifyPassword(input.password, "$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin");

    if (!user || !passwordOk || !user.isActive) {
      await recordAudit({
        action: "auth.login_failed",
        userLabel: input.email,
        ipAddress: ip,
        metadata: { reason: !user ? "unknown_email" : !user.isActive ? "inactive" : "bad_password" },
      });
      throw new AppError("Incorrect email or password.", "BAD_CREDENTIALS", 401);
    }

    clearLoginRateLimit(throttleKey);
    const token = await createSessionToken(user.id);
    await setSessionCookie(token);
    await touchLastLogin(user.id);
    await recordAudit({
      action: "auth.login",
      userId: user.id,
      userLabel: user.name,
      ipAddress: ip,
    });

    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}

export async function logoutAction(): Promise<ActionResult<undefined>> {
  try {
    const user = await getCurrentUser();
    if (user) {
      await recordAudit({
        action: "auth.logout",
        userId: user.id,
        userLabel: user.name,
        ipAddress: await getClientIp(),
      });
    }
    await clearSessionCookie();
    return actionOk();
  } catch (error) {
    return actionError(error);
  }
}
