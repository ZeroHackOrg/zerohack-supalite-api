/** SQL builder — turns ParsedQuery + a TableSchema into parameterized SQL.
 *
 * Rules that keep SQLite and Postgres output identical from the client's
 * perspective:
 *   - every value is a BOUND parameter (`?`), never inlined into SQL text
 *   - identifiers are always double-quoted (`"cve_id"`, both engines)
 *   - boolean/null filters compile to `IS [NOT] NULL` or boolean binds
 *   - `ilike` degrades to `LOWER(col) LIKE LOWER(?)` on SQLite so both
 *     backends accept case-insensitive wildcard search identically
 *   - unknown tables/columns surface PostgREST-shaped errors (PGRST2xx) */

import { ApiError } from "./types.ts";
import { bindValue, columnByName, quoteIdent, type ColumnKind, type ColumnSchema, type TableSchema } from "./schema.ts";
import type { Dialect } from "./driver.ts";
import type { FilterPredicate, ParsedQuery } from "./parsers.ts";

export interface BoundParam {
  value: unknown;
  kind: ColumnKind;
}

export interface RenderResult {
  sql: string;
  params: BoundParam[];
}

export interface RenderContext {
  dialect: Dialect;
  quote: (ident: string) => string;
  bind: (value: unknown, kind: ColumnKind) => string;
  params: BoundParam[];
}

const RESERVED_WORDS = new Set(["where", "limit", "offset", "order", "select", "from"]);

export function makeContext(dialect: Dialect, seed: BoundParam[] = []): RenderContext {
  const ctx: RenderContext = {
    dialect,
    quote: quoteIdent,
    bind: (value, kind) => {
      ctx.params.push({ value, kind });
      return "?";
    },
    params: seed,
  };
  return ctx;
}

export function missingColumn(table: string, column: string, code = "PGRST204"): ApiError {
  return ApiError.badRequest(
    code,
    `Could not find the '${column}' column of '${table}' in the schema cache`,
    null,
    "Verify that the column is spelled correctly, or use a different one."
  );
}

/* ------------------------------------------------------------------ */
/*  Column resolution                                                  */
/* ------------------------------------------------------------------ */

export function resolveColumns(table: TableSchema, requested: string[]): ColumnSchema[] {
  const names = requested.length ? requested : table.columns.map((c) => c.name);
  const out: ColumnSchema[] = [];
  for (const name of names) {
    const col = columnByName(table, name);
    if (!col) throw missingColumn(table.name, name);
    out.push(col);
  }
  return out;
}

function resolvePredicateColumn(table: TableSchema, pred: FilterPredicate): ColumnSchema {
  const col = columnByName(table, pred.column);
  if (!col) throw missingColumn(table.name, pred.column);
  return col;
}

/* ------------------------------------------------------------------ */
/*  Predicate / WHERE rendering                                        */
/* ------------------------------------------------------------------ */

function renderPredicate(table: TableSchema, pred: FilterPredicate, ctx: RenderContext): string {
  const col = resolvePredicateColumn(table, pred);
  const ident = ctx.quote(col.name);
  const negate = (inner: string) => (pred.negated ? `(NOT (${inner}))` : inner);
  const B = (v: unknown, schema?: ColumnSchema) => {
    const s = schema ?? col;
    return ctx.bind(bindValue(v, s, ctx.dialect), s.kind);
  };

  switch (pred.op) {
    case "is": {
      if (pred.value === null) return negate(`${ident} IS NULL`);
      return negate(`${ident} = ${B(pred.value)}`);
    }
    case "eq":
    case "neq": {
      if (pred.value === null) return negate(`${ident} IS NULL`);
      const op = pred.op === "eq" ? "=" : "<>";
      return negate(`${ident} ${op} ${B(pred.value)}`);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (pred.value === null || typeof pred.value === "boolean") {
        throw ApiError.badRequest(
          "PGRST100",
          `The ${pred.op} operator needs a number or text value for column '${pred.column}'`,
          null,
          null
        );
      }
      const op = pred.op === "gt" ? ">" : pred.op === "gte" ? ">=" : pred.op === "lt" ? "<" : "<=";
      return negate(`${ident} ${op} ${B(pred.value)}`);
    }
    case "like":
    case "match":
      return negate(`${ident} LIKE ${B(String(pred.value), TEXT_COL)}`);
    case "ilike":
    case "imatch":
      if (ctx.dialect === "sqlite") {
        return negate(`LOWER(${ident}) LIKE LOWER(${B(String(pred.value), TEXT_COL)})`);
      }
      return negate(`${ident} ILIKE ${B(String(pred.value), TEXT_COL)}`);
    case "in": {
      const items = Array.isArray(pred.value) ? pred.value : [];
      if (!items.length) return negate("(1 = 0)");
      const placeholders = items.map((v) => B(v)).join(", ");
      return negate(`${ident} IN (${placeholders})`);
    }
    default:
      throw ApiError.badRequest("PGRST100", `Unsupported operator "${pred.op}"`, null, null);
  }
}

const TEXT_COL: ColumnSchema = {
  name: "",
  type: "TEXT",
  kind: "text",
  nullable: true,
  primaryKey: false,
};

export function buildWhere(table: TableSchema, q: ParsedQuery, ctx: RenderContext): string {
  const groups: string[] = [];
  for (const f of q.filters) groups.push(`(${renderPredicate(table, f, ctx)})`);
  for (const orGroup of q.orGroups) {
    const parts = orGroup.map((f) => renderPredicate(table, f, ctx));
    if (parts.length) groups.push(`(${parts.join(" OR ")})`);
  }
  for (const andGroup of q.andGroups) {
    const parts = andGroup.map((f) => renderPredicate(table, f, ctx));
    if (parts.length) groups.push(`(${parts.join(" AND ")})`);
  }
  return groups.length ? `WHERE ${groups.join(" AND ")}` : "";
}

function buildOrder(table: TableSchema, q: ParsedQuery, ctx: RenderContext): string {
  const terms: string[] = [];
  for (const term of q.order) {
    const col = columnByName(table, term.column);
    if (!col) throw missingColumn(table.name, term.column, "PGRST202");
    const dir = term.ascending ? "ASC" : "DESC";
    const nulls = term.nulls ? ` NULLS ${term.nulls === "first" ? "FIRST" : "LAST"}` : "";
    terms.push(`${ctx.quote(term.column)} ${dir}${nulls}`);
  }
  return terms.length ? `ORDER BY ${terms.join(", ")}` : "";
}

function compress(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

/* ------------------------------------------------------------------ */
/*  SELECT / COUNT                                                     */
/* ------------------------------------------------------------------ */

export function buildSelectQuery(table: TableSchema, q: ParsedQuery, dialect: Dialect): RenderResult {
  const ctx = makeContext(dialect);
  const cols = resolveColumns(table, q.select);
  const select = cols.map((c) => ctx.quote(c.name)).join(", ") || "*";
  const where = buildWhere(table, q, ctx);
  const order = buildOrder(table, q, ctx);
  const limit = q.limit ?? 1000;
  const offset = q.offset ?? 0;
  ctx.bind(limit, "int");
  ctx.bind(offset, "int");
  return {
    sql: compress(`SELECT ${select} FROM ${ctx.quote(table.name)} ${where} ${order} LIMIT ? OFFSET ?`),
    params: ctx.params,
  };
}

export function buildCountQuery(table: TableSchema, q: ParsedQuery, dialect: Dialect): RenderResult {
  const ctx = makeContext(dialect);
  const where = buildWhere(table, q, ctx);
  return {
    sql: compress(`SELECT COUNT(*) AS c FROM ${ctx.quote(table.name)} ${where}`),
    params: ctx.params,
  };
}

/* ------------------------------------------------------------------ */
/*  Body normalization                                                 */
/* ------------------------------------------------------------------ */

export function normalizeInsertRows(body: unknown, table: TableSchema): Record<string, unknown>[] {
  if (Array.isArray(body)) {
    if (!body.length) throw ApiError.badRequest("PGRST100", "Empty array body — nothing to insert", null, null);
    return body.map((r) => normalizeRow(r, table));
  }
  return [normalizeRow(body, table)];
}

function normalizeRow(raw: unknown, table: TableSchema): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw ApiError.badRequest("PGRST100", "Request body must be a JSON object (or an array of objects)", null, null);
  }
  const row: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (RESERVED_WORDS.has(key)) {
      throw ApiError.badRequest("PGRST100", `"${key}" is a reserved word — not a column of '${table.name}'`, null, null);
    }
    const col = columnByName(table, key);
    if (!col) throw missingColumn(table.name, key);
    if (value !== undefined) row[key] = value;
  }
  if (!Object.keys(row).length) {
    throw ApiError.badRequest("PGRST100", "Request body contains no known columns", null, null);
  }
  return row;
}

export function normalizePatchBody(body: unknown, table: TableSchema): Record<string, unknown> {
  return normalizeRow(body, table);
}

/* ------------------------------------------------------------------ */
/*  INSERT                                                             */
/* ------------------------------------------------------------------ */

export interface InsertOptions {
  /** Columns for `ON CONFLICT (...)` upsert semantics (PostgREST on_conflict). */
  onConflict?: string[];
}

export interface InsertPlan {
  sql: string;
  params: BoundParam[];
  multi: boolean;
}

function renderOnConflict(table: TableSchema, keys: string[], onConflict: string[], ctx: RenderContext): string {
  const conflictCols = onConflict.map((c) => {
    const col = columnByName(table, c);
    if (!col) throw missingColumn(table.name, c);
    return ctx.quote(c);
  });
  const setClause = keys
    .filter((k) => !onConflict.includes(k))
    .map((k) => `${ctx.quote(k)} = EXCLUDED.${ctx.quote(k)}`)
    .join(", ");
  if (!conflictCols.length) return "";
  return `ON CONFLICT (${conflictCols.join(", ")}) DO UPDATE SET ${setClause}`;
}

/** Plan an INSERT (optionally as an upsert via `onConflict`). Multi-row
 *  inserts with identical key sets become a single multi-VALUES statement;
 *  divergent key sets fall back to separate statements (with DB defaults
 *  still applying). */
export function planInsert(table: TableSchema, rows: Record<string, unknown>[], dialect: Dialect, opts: InsertOptions = {}): InsertPlan[] {
  const keySets = rows.map((r) => Object.keys(r).sort().join(":"));
  const consistent = keySets.every((k) => k === keySets[0]);
  const makeSql = (keys: string[]): string => {
    const ctx = makeContext(dialect);
    const tuple = keys.map(() => "?").join(", ");
    return compress(
      `INSERT INTO ${ctx.quote(table.name)} (${keys.map((k) => ctx.quote(k)).join(", ")}) VALUES (${tuple}) ${renderOnConflict(table, keys, opts.onConflict ?? [], ctx)} RETURNING *`
    );
  };
  if (consistent) {
    const keys = Object.keys(rows[0]);
    const params = rows.flatMap((row) =>
      keys.map((k) => {
        const col = columnByName(table, k)!;
        return { value: bindValue(row[k] ?? null, col, dialect), kind: col.kind };
      })
    );
    return [{ sql: makeSql(keys), params, multi: rows.length > 1 }];
  }
  return rows.map((row) => planInsert(table, [row], dialect, opts)[0]);
}

/* ------------------------------------------------------------------ */
/*  UPDATE / DELETE                                                    */
/* ------------------------------------------------------------------ */

export function planUpdate(table: TableSchema, q: ParsedQuery, patch: Record<string, unknown>, dialect: Dialect): RenderResult {
  const ctx = makeContext(dialect);
  const keys = Object.keys(patch);
  const setClause = keys
    .map((k) => {
      const col = columnByName(table, k)!;
      ctx.bind(bindValue(patch[k], col, dialect), col.kind);
      return `${ctx.quote(k)} = ?`;
    })
    .join(", ");
  const where = buildWhere(table, q, ctx);
  return {
    sql: compress(`UPDATE ${ctx.quote(table.name)} SET ${setClause} ${where} RETURNING *`),
    params: ctx.params,
  };
}

export function planDelete(table: TableSchema, q: ParsedQuery, dialect: Dialect): RenderResult {
  const ctx = makeContext(dialect);
  const where = buildWhere(table, q, ctx);
  return {
    sql: compress(`DELETE FROM ${ctx.quote(table.name)} ${where} RETURNING *`),
    params: ctx.params,
  };
}