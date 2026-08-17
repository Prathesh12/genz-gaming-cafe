import { afterEach, describe, expect, it } from "vitest";

import { buildPoolConfig } from "@/db/pool-config";

/**
 * These cover the connection-string handling that decides whether a deployment
 * can talk to its database at all. Getting it wrong shows up as
 * SELF_SIGNED_CERT_IN_CHAIN against hosted providers, so it is worth pinning.
 */
afterEach(() => {
  delete process.env.DATABASE_SSL_CA;
});

describe("buildPoolConfig", () => {
  it("connects to a local database without TLS", () => {
    const config = buildPoolConfig("postgresql://postgres@localhost:5432/genz");
    expect(config.ssl).toBeUndefined();
  });

  it("encrypts hosted connections without demanding a trusted chain", () => {
    const config = buildPoolConfig(
      "postgresql://user:pw@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require",
    );
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("removes the ssl parameters so pg cannot override our choice", () => {
    const config = buildPoolConfig(
      "postgresql://user:pw@host.example.com:5432/db?sslmode=require&uselibpqcompat=true&application_name=genz",
    );
    expect(config.connectionString).not.toContain("sslmode");
    expect(config.connectionString).not.toContain("uselibpqcompat");
    // Unrelated parameters survive.
    expect(config.connectionString).toContain("application_name=genz");
  });

  it("defaults a remote host to TLS even when sslmode is absent", () => {
    const config = buildPoolConfig("postgresql://user:pw@db.example.com:5432/postgres");
    expect(config.ssl).toEqual({ rejectUnauthorized: false });
  });

  it("honours sslmode=disable", () => {
    const config = buildPoolConfig("postgresql://user:pw@db.example.com:5432/postgres?sslmode=disable");
    expect(config.ssl).toBeUndefined();
  });

  it("verifies the certificate when a CA is supplied", () => {
    process.env.DATABASE_SSL_CA = "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----";
    const config = buildPoolConfig("postgresql://user:pw@db.example.com:5432/postgres?sslmode=require");
    expect(config.ssl).toEqual({
      ca: "-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----",
      rejectUnauthorized: true,
    });
  });

  it("passes through extra pool options", () => {
    const config = buildPoolConfig("postgresql://postgres@localhost:5432/genz", { max: 1 });
    expect(config.max).toBe(1);
  });

  it("leaves an unparseable DSN untouched", () => {
    const dsn = "host=localhost user=postgres dbname=genz";
    expect(buildPoolConfig(dsn).connectionString).toBe(dsn);
  });
});
