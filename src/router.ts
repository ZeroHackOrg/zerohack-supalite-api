/** Hono application wiring — the PostgREST-compatible surface.
 *
 *  Routes served:
 *    GET  /              service manifest + OpenAPI-ish pointers
 *    GET  /rest/v1/      schema introspection (table definitions)
 *    GET  /rest/v1/:t    row selection (filters, select, order, paging, count)
 *    POST /rest/v1/:t    insert (single or array; Prefer: return=…)
 *    PATCH /rest/v1/:t   update rows matching a filter
 *    DELETE /rest/v1/:t  delete rows matching a filter
 *
 *  The same app serves either backend — the driver's dialect tells the
 *  SQL builder how to degrade `ilike` and how to bind booleans. */

import { Hono } from "hono";
import { ApiError, POSTGREST_VERSION, API_VERSION, type DbRow } from "./types.ts";
import { authenticate, type AuthConfig } from "./auth.ts";
import { coerceRow } from "./schema.ts";
import type { TableSchema } from "./schema.ts";
import type { Driver } from "./driver.ts";
import { parseQueryString } from "./parsers.ts";
import {
  buildCountQuery,
  buildSelectQuery,
  normalizeInsertRows,
  normalizePatchBody,
  planDelete,
  planInsert,
  planUpdate,
  resolveColumns,
} from "./query-builder.ts";
import { requireTable, type Db } from "./db.ts";

export interface AppContext {
  db: Db;
  auth: AuthConfig;
}

export function createApp(ctx: AppContext): Hono {
  const db = ctx.db;
  const driver: Driver = db.driver;
  const dialect = driver.dialect;
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return new Response(JSON.stringify(err.toBody()), {
        status: err.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const msg = err instanceof Error ? err.message : "Internal server error";
    console.error("[supalite] unhandled error:", err);
    return new Response(JSON.stringify(ApiError.server("PGRST000", msg).toBody()), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  });

  app.notFound((c) => {
    throw ApiError.notFound("PGRST100", "The requested route does not exist", c.req.url, null);
  });

  const authOf = (c: any) => authenticate(new Headers(c.req.raw.headers), new URL(c.req.url), ctx.auth);
  const want = (c: any) => ({
    range: c.req.header("range") ?? undefined,
    prefer: c.req.header("prefer") ?? undefined,
  });

  /* ---------------- service manifest ---------------- */
  app.get("/", async (c) => {
    return c.json({
      name: "zerohack-supalite",
      description: "A PostgREST + GoTrue compatible API over SQLite and Postgres.",
      version: API_VERSION,
      postgrest: POSTGREST_VERSION,
      dialect,
      introspection: "/rest/v1/",
      rest: "/rest/v1/",
      tables: Array.from(db.tables.keys()).sort(),
    });
  });

  /* ---------------- schema introspection ---------------- */
  app.get("/rest/v1/", async (c) => {
    await authOf(c);
    const definitions: Record<string, unknown> = {};
    for (const table of Array.from(db.tables.values()).sort((a, b) => a.name.localeCompare(b.name))) {
      definitions[table.name] = {
        columns: table.columns.map((col) => ({
          name: col.name,
          type: col.type,
          kind: col.kind,
          nullable: col.nullable,
          primaryKey: col.primaryKey,
        })),
        primaryKey: table.primaryKey,
      };
    }
    return c.json({ definitions, root: "/rest/v1/" });
  });

  /* ---------------- GET (select) ---------------- */
  app.get("/rest/v1/:table", async (c) => {
    await authOf(c);
    const table = requireTable(db, c.req.param("table"));
    const q = parseQueryString(new URL(c.req.url).searchParams, { headers: want(c) });

    const cols = resolveColumns(table, q.select);
    const rendered = buildSelectQuery(table, q, dialect);
    const rawRows = await driver.query(rendered.sql, rendered.params.map((p) => p.value));
    const rows = rawRows.map((r) => coerceRow(r, cols, dialect));

    const offset = q.offset ?? 0;
    const upper = rows.length ? offset + rows.length - 1 : offset - 1;

    let contentRange = `${offset}-${upper}/*`;
    if (q.count === "exact") {
      const countPlan = buildCountQuery(table, q, dialect);
      const countRows = await driver.query(countPlan.sql, countPlan.params.map((p) => p.value));
      const total = Number(countRows[0]?.c ?? 0);
      contentRange = `${offset}-${upper}/${total}`;
    }

    return c.json(rows, 200, { "Content-Range": contentRange, "PostgREST-Version": POSTGREST_VERSION });
  });

  /* ---------------- POST (insert) ---------------- */
  app.post("/rest/v1/:table", async (c) => {
    await authOf(c);
    const table = requireTable(db, c.req.param("table"));
    const rows = normalizeInsertRows(await safeJsonBody(c), table);
    const url = new URL(c.req.url);
    const onConflict = url.searchParams.get("on_conflict");
    const conflictCols = onConflict ? onConflict.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
    const plans = planInsert(table, rows, dialect, { onConflict: conflictCols });

    const returned: DbRow[] = [];
    for (const plan of plans) {
      const res = await driver.query(plan.sql, plan.params.map((p) => p.value));
      returned.push(...res);
    }
    const coerced = returned.map((r) => coerceRow(r, table.columns, dialect));

    const prefer = c.req.header("prefer") ?? "";
    if (prefer.includes("return=representation")) {
      return c.json(coerced, 201, { "PostgREST-Version": POSTGREST_VERSION });
    }
    return new Response(null, { status: 201, headers: { "PostgREST-Version": POSTGREST_VERSION } });
  });

  /* ---------------- PATCH (update) ---------------- */
  app.patch("/rest/v1/:table", async (c) => {
    await authOf(c);
    const table = requireTable(db, c.req.param("table"));
    const patch = normalizePatchBody(await safeJsonBody(c), table);
    const q = parseQueryString(new URL(c.req.url).searchParams, { headers: want(c) });

    const plan = planUpdate(table, q, patch, dialect);
    const res = await driver.query(plan.sql, plan.params.map((p) => p.value));

    const scheme = Object.keys(patch).length ? patch : table.columns;
    const cols = resolveColumns(table, q.select.length ? q.select : Object.keys(scheme));
    const coerced = res.map((r) => coerceRow(r, cols, dialect));

    const prefer = c.req.header("prefer") ?? "";
    if (prefer.includes("return=representation")) {
      return c.json(coerced, 200, { "PostgREST-Version": POSTGREST_VERSION });
    }
    return new Response(null, { status: 204, headers: { "PostgREST-Version": POSTGREST_VERSION } });
  });

  /* ---------------- DELETE ---------------- */
  app.delete("/rest/v1/:table", async (c) => {
    await authOf(c);
    const table = requireTable(db, c.req.param("table"));
    const q = parseQueryString(new URL(c.req.url).searchParams, { headers: want(c) });
    const plan = planDelete(table, q, dialect);
    const res = await driver.query(plan.sql, plan.params.map((p) => p.value));
    const coerced = res.map((r) => coerceRow(r, table.columns, dialect));

    const prefer = c.req.header("prefer") ?? "";
    if (prefer.includes("return=representation")) {
      return c.json(coerced, 200, { "PostgREST-Version": POSTGREST_VERSION });
    }
    return new Response(null, { status: 204, headers: { "PostgREST-Version": POSTGREST_VERSION } });
  });

  return app;
}

async function safeJsonBody(c: any): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw ApiError.badRequest("PGRST100", "Invalid JSON body", null, "Send application/json with a single object (or an array of objects).");
  }
}