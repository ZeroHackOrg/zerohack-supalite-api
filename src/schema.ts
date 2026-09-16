/** Column/schema model + JSON coercion.
 *
 * Both drivers return rows in native types (sqlite stores booleans as
 * 0/1 and json as TEXT, postgres returns Date/jsonb objects). The schema
 * normalizes each row so the REST layer always emits the SAME JSON from
 * either backend — that is the "runs interchangeably on SQLite and
 * Postgres" guarantee the conformance suite pins down. */

import type { DbRow } from "./types.ts";

export type ColumnKind = "text" | "int" | "float" | "numeric" | "bool" | "json" | "datetime" | "uuid";

export interface ColumnSchema {
  name: string;
  type: string; // declared type as reported by the engine (informational)
  kind: ColumnKind;
  nullable: boolean;
  primaryKey: boolean;
  default?: string | null;
}

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  primaryKey: string | null;
}

export function columnByName(table: TableSchema, name: string): ColumnSchema | null {
  return table.columns.find((c) => c.name === name) || null;
}

export function requiresQuoting(ident: string): boolean {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ident)) return true;
  const reserved = new Set(["order", "select", "group", "from", "where", "index", "references", "primary", "key", "table", "column", "user", "limit", "offset", "range"]);
  return reserved.has(ident.toLowerCase());
}

export function quoteIdent(ident: string): string {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

export function isValidColumnName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(name || ""));
}

/** Convert one raw driver value into the wire-friendly JSON value. */
export function coerceValue(raw: unknown, col: ColumnSchema, dialect: "sqlite" | "postgres"): unknown {
  if (raw === null || raw === undefined) return null;
  switch (col.kind) {
    case "bool":
      if (typeof raw === "boolean") return raw;
      return raw === 1 || raw === "1" || raw === "true" || raw === true;
    case "int":
      if (typeof raw === "number") return raw;
      return Number(raw);
    case "float":
    case "numeric":
      if (typeof raw === "number") return raw;
      return Number(String(raw));
    case "json":
      if (dialect === "sqlite") {
        if (typeof raw === "string") {
          try {
            return JSON.parse(raw);
          } catch {
            return raw;
          }
        }
        return raw;
      }
      return raw;
    case "datetime":
      if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
      return String(raw);
    default:
      return String(raw);
  }
}

export function coerceRow(raw: DbRow, cols: ColumnSchema[], dialect: "sqlite" | "postgres"): DbRow {
  const out: DbRow = {};
  for (const col of cols) {
    if (!(col.name in raw)) continue;
    out[col.name] = coerceValue(raw[col.name], col, dialect);
  }
  return out;
}

/** Convert a wire/JS value into a parameter the driver can bind.
 *  sqlite needs booleans as 0/1 and json as TEXT; postgres binds
 *  native booleans and stringified json. */
export function bindValue(value: unknown, col: ColumnSchema, dialect: "sqlite" | "postgres"): unknown {
  if (value === null || value === undefined) return null;
  switch (col.kind) {
    case "bool":
      return dialect === "sqlite" ? (value ? 1 : 0) : !!value;
    case "json":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "int":
      return Number(value);
    case "float":
    case "numeric":
      return Number(value);
    default:
      return String(value);
  }
}