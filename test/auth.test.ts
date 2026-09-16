import { describe, expect, it } from "vitest";
import { authenticate, parseJwt, signJwt, type AuthConfig } from "../src/auth.ts";

const SECRET = "test-secret-for-supalite";
const ANON = "anon_key_123";

function headers(init: Record<string, string> = {}): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(init)) h.set(k, v);
  return h;
}

describe("authenticate", () => {
  it("dev mode with no secrets grants anon", async () => {
    const ctx = await authenticate(headers(), new URL("http://x/"), {});
    expect(ctx).toEqual({ role: "anon", authed: false });
  });

  it("requires a matching apikey when anon key is configured", async () => {
    const cfg: AuthConfig = { jwtSecret: SECRET, anonKey: ANON };
    await expect(authenticate(headers(), new URL("http://x/"), cfg)).rejects.toMatchObject({ status: 401, code: "PGRST301" });
    await expect(authenticate(headers({ apikey: "wrong" }), new URL("http://x/"), cfg)).rejects.toMatchObject({ status: 401 });
  });

  it("accepts apikey alone as anon role", async () => {
    const cfg: AuthConfig = { jwtSecret: SECRET, anonKey: ANON };
    const ctx = await authenticate(headers({ apikey: ANON }), new URL("http://x/"), cfg);
    expect(ctx).toEqual({ role: "anon", authed: false });
  });

  it("accepts a valid signed JWT with role claim", async () => {
    const cfg: AuthConfig = { jwtSecret: SECRET, anonKey: ANON };
    const token = signJwt({ role: "authenticated", sub: "u-123" }, SECRET);
    const ctx = await authenticate(headers({ apikey: ANON, authorization: `Bearer ${token}` }), new URL("http://x/"), cfg);
    expect(ctx).toEqual({ role: "authenticated", authed: true, sub: "u-123" });
  });

  it("rejects expired tokens", async () => {
    const cfg: AuthConfig = { jwtSecret: SECRET, anonKey: ANON };
    const token = signJwt({ role: "authenticated", exp: 1 }, SECRET, -100);
    await expect(authenticate(headers({ apikey: ANON, authorization: `Bearer ${token}` }), new URL("http://x/"), cfg)).rejects.toMatchObject({ status: 401, code: "PGRST302" });
  });

  it("rejects tampered signatures", async () => {
    const cfg: AuthConfig = { jwtSecret: SECRET, anonKey: ANON };
    const token = signJwt({ role: "authenticated" }, SECRET);
    const tampered = `${token.slice(0, -1)}x`;
    await expect(authenticate(headers({ apikey: ANON, authorization: `Bearer ${tampered}` }), new URL("http://x/"), cfg)).rejects.toMatchObject({ status: 401, code: "PGRST302" });
  });
});

describe("parseJwt", () => {
  it("parses header and payload", () => {
    const parsed = parseJwt(signJwt({ role: "anon", sub: "u" }, SECRET));
    expect(parsed?.payload).toMatchObject({ role: "anon", sub: "u" });
    expect(parsed?.header).toMatchObject({ alg: "HS256" });
  });

  it("returns null for garbage", () => {
    expect(parseJwt("not.a.jwt")).toBeNull();
  });
});