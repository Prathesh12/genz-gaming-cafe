import type { PoolConfig } from "pg";

/**
 * Build the `pg` pool configuration from a connection string.
 *
 * Why this exists: recent versions of `pg` interpret `sslmode=require` in a URL
 * as full certificate verification, and — because values parsed out of the
 * connection string take precedence over options passed alongside it — that
 * silently overrides any `ssl` option we set. Hosted providers whose
 * certificate chain is not in Node's trust store (Supabase's pooler, among
 * others) then fail with `SELF_SIGNED_CERT_IN_CHAIN`.
 *
 * So we take charge of SSL ourselves: strip the ssl-related parameters out of
 * the URL and pass an explicit `ssl` option that cannot be overridden.
 *
 * - Local databases (localhost / 127.0.0.1 / a unix socket) connect without TLS.
 * - Everything else connects **encrypted**. By default the server certificate
 *   is not verified, which is what hosted Postgres providers require out of the
 *   box.
 * - Set `DATABASE_SSL_CA` to the contents of, or a path to, your provider's CA
 *   certificate to turn on full verification. Supabase publishes one under
 *   Project Settings → Database → SSL Configuration.
 * - `sslmode=disable` in the URL turns TLS off entirely.
 */
export function buildPoolConfig(connectionString: string, extra: Partial<PoolConfig> = {}): PoolConfig {
  let url: URL | null = null;
  try {
    url = new URL(connectionString);
  } catch {
    // Not a URL we can parse (e.g. a key=value DSN) — hand it over untouched.
    return { connectionString, ...extra };
  }

  const sslmode = url.searchParams.get("sslmode");
  // These are the parameters that make `pg` decide SSL policy for itself.
  for (const key of ["sslmode", "ssl", "uselibpqcompat", "sslrootcert"]) {
    url.searchParams.delete(key);
  }

  const host = url.hostname;
  const isLocal =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "" || host.endsWith(".local");

  const wantsSsl = sslmode ? sslmode !== "disable" : !isLocal;

  let ssl: PoolConfig["ssl"] = undefined;
  if (wantsSsl) {
    const ca = process.env.DATABASE_SSL_CA?.trim();
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  }

  return { connectionString: url.toString(), ssl, ...extra };
}
