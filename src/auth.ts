/** Minimal GoTrue-style JWT verification (HS256/384/512) used for the
 *  `Authorization: Bearer <jwt>` header — plus the `apikey` header that
 *  the supabase-js client always sends.
 *
 * Role model:
 *   - only `apikey` present          → role = defaultRole ("anon")
 *   - valid JWT with a `role` claim  → role = claim (e.g. "authenticated")
 *   - no secret configured           → dev mode, everything passes (role "anon")
 *
 * Secret mismatch / expired / malformed tokens → PGRST301 (missing) or
 * PGRST302 (invalid) to mirror PostgREST's auth error surface. */

import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./types.ts";

export interface AuthConfig {
  jwtSecret?: string;
  anonKey?: string;
  defaultRole?: string;
}

export interface AuthContext {
  role: string;
  authed: boolean;
  sub?: string;
}

function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

function verifyHmac(sig: Buffer, data: string, secret: string): boolean {
  const key = Buffer.from(secret);
  const expected = createHmac("sha256", key).update(data).digest();
  return sig.length === expected.length && timingSafeEqual(sig, expected);
}

export function parseJwt(token: string): { header: any; payload: any; data: string; sig: Buffer } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  try {
    const header = JSON.parse(b64urlDecode(h).toString("utf8"));
    const payload = JSON.parse(b64urlDecode(p).toString("utf8"));
    return { header, payload, data: `${h}.${p}`, sig: b64urlDecode(s) };
  } catch {
    return null;
  }
}

export async function authenticate(
  headers: Headers,
  url: URL,
  cfg: AuthConfig
): Promise<AuthContext> {
  const apikey = headers.get("apikey") || url.searchParams.get("apikey") || "";
  const authHeader = headers.get("authorization") || "";

  const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  // Dev mode — no secrets configured anywhere: open access with anon role.
  if (!cfg.jwtSecret && (cfg.anonKey ? apikey && apikey === cfg.anonKey : true)) {
    return { role: cfg.defaultRole ?? "anon", authed: false };
  }

  if (cfg.anonKey && (!apikey || apikey !== cfg.anonKey)) {
    throw ApiError.unauthorized("PGRST301", "Invalid API key", null, "Supply a valid apikey header matching the configured anon key (or leave the server in dev mode).");
  }

  if (jwt) {
    const parsed = parseJwt(jwt);
    if (!parsed) {
      throw ApiError.unauthorized("PGRST302", "JWT payload does not match expected claims", null, null);
    }
    if (parsed.header.alg !== "HS256" || !cfg.jwtSecret) {
      throw ApiError.unauthorized("PGRST302", "JWT signature validation failed", `Unsupported alg "${parsed.header.alg}"`, null);
    }
    if (!verifyHmac(parsed.sig, parsed.data, cfg.jwtSecret)) {
      throw ApiError.unauthorized("PGRST302", "JWT signature validation failed", null, null);
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (typeof parsed.payload.exp === "number" && parsed.payload.exp < nowSec) {
      throw ApiError.unauthorized("PGRST302", "JWT expired", null, null);
    }
    return {
      role: String(parsed.payload.role ?? cfg.defaultRole ?? "authenticated"),
      authed: true,
      sub: parsed.payload.sub ? String(parsed.payload.sub) : undefined,
    };
  }

  return { role: cfg.defaultRole ?? "anon", authed: false };
}

/** Mint a HS256 JWT for tests / local tooling — never used in prod
 *  paths; lets conformance tests exercise the real auth flow. */
export function signJwt(payload: Record<string, unknown>, secret: string, ttlSec = 3600): string {
  const header = { alg: "HS256", typ: "JWT" };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const data = `${b64(header)}.${b64({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + ttlSec })}`;
  const sig = createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}