/** Database drivers — a tiny data-access layer with one contract for
 *  SQLite and Postgres. The REST layer never touches the engine
 *  directly; it only speaks SQL through this interface, so swapping the
 *  backend (the "runs interchangeably on SQLite and Postgres" promise)
 *  is a config change, not a code change. */

import Database from "better-sqlite3";
import { Pool } from "pg";
import type { DbRow, RunResult } from "./types.ts";
import type { TableSchema, ColumnKind } from "./schema.ts";
import { bindValue } from "./schema.ts";

export type Dialect = "sqlite" | "postgres";

export interface Driver {
  readonly dialect: Dialect;
  /** Raw engine types, no JSON coercion. */
  query(sql: string, params?: unknown[]): Promise<DbRow[]>;
  run(sql: string, params?: unknown[]): Promise<RunResult>;
  tables(): Promise<TableSchema[]>;
  migrate(sql: string): Promise<void>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/*  Placeholder rewriting — the SQL builder always emits `?`, and pg    */
/*  adapts them to $1..$n sequentially. Safe: values are never inlined. */
/* ------------------------------------------------------------------ */

export function rewritePostgresPlaceholders(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/* ------------------------------------------------------------------ */
/*  SQLite driver                                                       */
/* ------------------------------------------------------------------ */

function sqliteKind(declared: string): ColumnKind {
  const t = (declared || "").toUpperCase();
  if (t.includes("INT")) return "int";
  if (t === "BOOLEAN" || t.includes("BOOL")) return "bool";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "float";
  if (t === "NUMERIC" || t.includes("DECIMAL")) return "numeric";
  if (t.includes("JSON")) return "json";
  if (t.includes("DATE") || t.includes("TIME") || t.includes("TIMESTAMP")) return "datetime";
  if (t.includes("CHAR") || t.includes("CLOB") || t.includes("TEXT") || t === "") return "text";
  if (t.includes("UUID")) return "uuid";
  return "text";
}

export class SqliteDriver implements Driver {
  readonly dialect = "sqlite" as const;
  private db: Database.Database;

  constructor(filename: string = ":memory:") {
    this.db = new Database(filename);
    this.db.pragma("journal_mode = WAL");
  }

  async query(sql: string, params: unknown[] = []): Promise<DbRow[]> {
    return this.db.prepare(sql).all(...toSqliteParams(params)) as DbRow[];
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const info = this.db.prepare(sql).run(...toSqliteParams(params));
    return { changes: Number(info.changes ?? 0), lastInsertRowid: info.lastInsertRowid };
  }

  async migrate(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async tables(): Promise<TableSchema[]> {
    const names = this.db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
      .all() as { name: string }[];
    const out: TableSchema[] = [];
    for (const { name } of names) {
      const info = this.db.prepare(`PRAGMA table_info("${name.replace(/"/g, '""')}")`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }>;
      const columns = info.map((c) => ({
        name: c.name,
        type: c.type,
        kind: sqliteKind(c.type),
        nullable: c.notnull === 0,
        primaryKey: c.pk > 0,
        default: c.dflt_value ?? null,
      }));
      const pk = columns.find((c) => c.primaryKey)?.name ?? null;
      out.push({ name, columns, primaryKey: pk });
    }
    return out;
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

function toSqliteParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p === undefined) return null;
    return p;
  });
}

/* ------------------------------------------------------------------ */
/*  Postgres driver                                                     */
/* ------------------------------------------------------------------ */

function pgKind(type: string): ColumnKind {
  const t = (type || "").toLowerCase();
  if (t.includes("int")) return "int";
  if (t === "boolean" || t === "bool") return "bool";
  if (t.startsWith("numeric") || t.startsWith("decimal")) return "numeric";
  if (t === "real" || t === "double precision" || t.startsWith("float")) return "float";
  if (t === "json" || t === "jsonb") return "json";
  if (t.startsWith("timestamp") || t.startsWith("time") || t.startsWith("date")) return "datetime";
  if (t === "uuid") return "uuid";
  return "text";
}

export class PostgresDriver implements Driver {
  readonly dialect = "postgres" as const;
  private pool: Pool;

  constructor(connectionString: string, max = 4) {
    this.pool = new Pool({ connectionString, max });
  }

  async query(sql: string, params: unknown[] = []): Promise<DbRow[]> {
    const res = await this.pool.query(rewritePostgresPlaceholders(sql), toPgParams(params));
    return res.rows as DbRow[];
  }

  async run(sql: string, params: unknown[] = []): Promise<RunResult> {
    const res = await this.pool.query(rewritePostgresPlaceholders(sql), toPgParams(params));
    const last = res.rows?.[0] as { id?: number } | undefined;
    return { changes: res.rowCount ?? 0, lastInsertRowid: last?.id ?? null };
  }

  async migrate(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async tables(): Promise<TableSchema[]> {
    const cols = await this.pool.query(
      `SELECT table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, ordinal_position`
    );
    const byTable = new Map<string, ColumnKind[]>();
    const tables = new Set<string>();
    for (const row of cols.rows as Array<{ table_name: string; column_name: string; data_type: string; is_nullable: string }>) {
      tables.add(row.table_name);
      if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
      byTable.get(row.table_name)!.push({
        name: row.column_name,
        kind: pgKind(row.data_type),
      } as any);
    }

    const pks = await this.pool.query(
      `SELECT tc.table_name, kcu.column_name
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'`
    );
    const pkByTable = new Map<string, string>();
    for (const row of pks.rows as Array<{ table_name: string; column_name: string }>) {
      pkByTable.set(row.table_name, row.column_name);
    }

    const out: TableSchema[] = [];
    for (const name of Array.from(tables).sort()) {
      const cols = await this.pool.query(
        `SELECT column_name, data_type, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
          ORDER BY ordinal_position`,
        [name]
      );
      const columns = (cols.rows as Array<{ column_name: string; data_type: string; is_nullable: string }>).map((c) => ({
        name: c.column_name,
        type: c.data_type,
        kind: pgKind(c.data_type),
        nullable: c.is_nullable === "YES",
        primaryKey: pkByTable.get(name) === c.column_name,
        default: null,
      }));
      out.push({ name, columns, primaryKey: pkByTable.get(name) ?? null });
    }
    return out;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function toPgParams(params: unknown[]): unknown[] {
  return params.map((p) => {
    if (p && typeof p === "object" && !(p instanceof Date) && !Array.isArray(p)) {
      return JSON.stringify(p);
    }
    return p;
  });
}

export type DbParams = { value: unknown; kind: ColumnKind }[];