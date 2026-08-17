import { jwtVerify, SignJWT } from "jose";

/**
 * Session token primitives, deliberately free of any database import so the
 * proxy (which runs on every request) stays lightweight.
 */

export const SESSION_COOKIE = "genz_session";
export const SESSION_HOURS = 12;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or too short. Generate one with `openssl rand -hex 32`.");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("genz-gaming-cafe")
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(getSecret());
}

/** Returns the user id encoded in a valid token, or null. */
export async function readSessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: "genz-gaming-cafe" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
