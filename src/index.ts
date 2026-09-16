/** Public API surface for @zerohack/supalite-api. */

export { createApp, type AppContext } from "./router.ts";
export { openDb, tableList, requireTable, type Db } from "./db.ts";
export { loadOptions, type ApiOptions } from "./config.ts";
export type { Driver, Dialect } from "./driver.ts";
export { SqliteDriver, PostgresDriver } from "./driver.ts";
export { authenticate, parseJwt, signJwt, type AuthConfig, type AuthContext } from "./auth.ts";
export { parseQueryString, parsePredicate, parseOrder, parseRangeHeader, parsePreferHeader } from "./parsers.ts";
export { attachHttp, fetchApp, type RunningServer } from "./http-server.ts";
export { ApiError, API_VERSION, POSTGREST_VERSION } from "./types.ts";
export type { DbRow, JsonValue } from "./types.ts";

import { openDb } from "./db.ts";
import { createApp } from "./router.ts";
import { attachHttp } from "./http-server.ts";
import { loadOptions, type ApiOptions } from "./config.ts";

/** Boot a full app from options — used by bin.ts, the CLI and tests. */
export async function serve(opts: Partial<ApiOptions> = {}) {
  const options = loadOptions(opts);
  const db = await openDb(options);
  const app = createApp({ db, auth: { jwtSecret: options.jwtSecret, anonKey: options.anonKey, defaultRole: options.defaultRole } });
  return { app, db, options };
}

/** Boot and listen on `port` (0 = OS-assigned for tests/dev). */
export async function serveOn(port: number, opts: Partial<ApiOptions> = {}) {
  const { app, db, options } = await serve(opts);
  const server = await attachHttp(app, port, opts.host ?? "127.0.0.1");
  return { app, db, options, server };
}

/** Convenience test harness: always in-memory SQLite; seed only if asked. */
export async function createTestApp(opts: Partial<ApiOptions> = {}) {
  const { app, db } = await serve({
    ...opts,
    seed: opts.seed ?? 0,
    database: opts.database ?? ":memory:",
    databaseName: opts.databaseName ?? "sqlite",
  });
  return { app, db };
}