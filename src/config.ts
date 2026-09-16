/** Configuration — read from env or CLI flags with sane local defaults.
 *  Everything is optional so `zh-api` boots anywhere with zero config. */

import fs from "node:fs";
import path from "node:path";

export interface ApiOptions {
  port: number;
  host: string;
  /** sqlite file path, `:memory:`, or a postgres:// URL. */
  database: string;
  databaseName: string;
  jwtSecret?: string;
  anonKey?: string;
  defaultRole?: string;
  /** Number of sample CVEs to seed (0 = skip). */
  seed: number;
  cwd: string;
}

export function boolish(v: string | undefined, dflt = false): boolean {
  if (v === undefined || v === "") return dflt;
  return ["1", "true", "yes", "on"].includes(String(v).toLowerCase());
}

function existsFile(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

export function detectDatabase(db?: string, cwd = process.cwd()): { database: string; databaseName: string } {
  if (db) {
    if (db.startsWith("postgres://") || db.startsWith("postgresql://")) return { database: db, databaseName: "postgres" };
    if (db === ":memory:") return { database: ":memory:", databaseName: "sqlite" };
    return { database: path.resolve(cwd, db), databaseName: "sqlite" };
  }
  const envDb = process.env.ZH_API_DATABASE;
  if (envDb && envDb.startsWith("postgres://")) return { database: envDb, databaseName: "postgres" };
  if (envDb && envDb.trim()) {
    if (envDb === ":memory:") return { database: ":memory:", databaseName: "sqlite" };
    return { database: path.resolve(cwd, envDb), databaseName: "sqlite" };
  }
  const preferred = process.env.DATABASE_URL;
  if (preferred && preferred.startsWith("postgres://")) return { database: preferred, databaseName: "postgres" };
  return { database: path.resolve(cwd, "supalite.db"), databaseName: "sqlite" };
}

export function loadOptions(overrides: Partial<ApiOptions> = {}): ApiOptions {
  const { database, databaseName } = detectDatabase(overrides.database, overrides.cwd || process.cwd());
  const seedRaw = overrides.seed ?? (Number(process.env.ZH_API_SEED) || 0);

  return {
    port: overrides.port ?? (Number(process.env.PORT || process.env.ZH_API_PORT) || 3001),
    host: overrides.host ?? process.env.ZH_API_HOST ?? "127.0.0.1",
    database,
    databaseName,
    jwtSecret: overrides.jwtSecret ?? process.env.ZH_API_JWT_SECRET ?? process.env.SUPABASE_JWT_SECRET,
    anonKey: overrides.anonKey ?? process.env.ZH_API_ANON_KEY,
    defaultRole: overrides.defaultRole ?? process.env.ZH_API_DEFAULT_ROLE ?? "anon",
    seed: Number.isFinite(seedRaw) ? seedRaw : 0,
    cwd: overrides.cwd ?? process.cwd(),
  };
}

export const MIGRATIONS_PATH = path.resolve(process.cwd(), "migrations", "001_init.sql");
export const SAMPLE_CORPUS = 24;