/** PostgREST query-string parsing (the compliance contract).
 *
 * Supports the subset the conformance suite exercises plus the operators
 * the CLI needs:
 *
 *   select=col1,col2                        column projection
 *   col=eq.val | neq | gt | gte | lt | lte  comparison operators
 *   col=like.*pat* | ilike.*pat*            wildcard search (%, _)
 *   col=in.(a,b,c)                          membership (optional quotes)
 *   col=is.null|true|false|unknown          null / boolean tests
 *   col=not.eq.val | not.in.(a,b)           negation
 *   or=(a.eq.1,b.gt.5) and=(...)            boolean group parameters
 *   order=col.asc.nullsfirst,col2.desc      ordering
 *   limit=N&offset=N                        paging params
 *   Range: 0-49                             paging header (overrides params)
 *   Prefer: count=exact|return=representation
 *
 * All values are emitted as BOUND parameters downstream — never inlined
 * into SQL text. */

import { ApiError } from "./types.ts";
import type { ColumnKind } from "./schema.ts";

export const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is", "match", "imatch"] as const;
export type FilterOp = (typeof FILTER_OPS)[number];

export interface FilterPredicate {
  column: string;
  op: FilterOp;
  /** Semantic value: string | number | boolean | null for `is`, or array for `in`. */
  value: unknown;
  elementKind?: ColumnKind;
  negated: boolean;
}

export type NullsOrder = "first" | "last";
export interface OrderTerm {
  column: string;
  ascending: boolean;
  nulls?: NullsOrder;
}

export interface ParsedQuery {
  select: string[];
  filters: FilterPredicate[];
  /** Each group is OR-ed inside its own parens; groups are AND-ed together. */
  orGroups: FilterPredicate[][];
  andGroups: FilterPredicate[][];
  order: OrderTerm[];
  limit: number | null;
  offset: number | null;
  count: "exact" | "planned" | null;
  returnMode: "minimal" | "representation" | "headers-only";
}

/** Fresh query state — call this to avoid the shared-array footgun of a
 *  module-level template (filters must not leak across requests). */
export function createDefaultQuery(): ParsedQuery {
  return {
    select: [],
    filters: [],
    orGroups: [],
    andGroups: [],
    order: [],
    limit: null,
    offset: null,
    count: null,
    returnMode: "minimal",
  };
}

const KEYWORDS = new Set([
  "select",
  "order",
  "limit",
  "offset",
  "columns",
  "on_conflict",
  "returning",
  "prefer",
  "and",
  "or",
  "not",
]);

/* ------------------------------------------------------------------ */
/*  Filter predicates                                                   */
/* ------------------------------------------------------------------ */

function parseInItems(raw: string): string[] {
  const inner = raw.trim().replace(/^\(/, "").replace(/\)$/, "");
  const items: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      items.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() || items.length === 0) items.push(cur.trim());
  return items;
}

function coerceScalar(raw: string): string | number | boolean | null {
  const t = raw.trim();
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  if (/^-?\d+$/.test(t)) return Number(t);
  if (/^-?\d+\.\d+$/.test(t)) return Number(t);
  if (t === "true") return true;
  if (t === "false") return false;
  return t;
}

function coerceInList(items: string[]): (string | number | boolean | null)[] {
  return items.map(coerceScalar);
}

export function parsePredicate(raw: string): FilterPredicate {
  const trimmed = raw.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) {
    throw ApiError.badRequest("PGRST100", "Syntax error: invalid filter value", trimmed, "Use the format col=op.value, e.g. severity=eq.CRITICAL");
  }
  const column = trimmed.slice(0, dot).trim();
  if (!/[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw ApiError.badRequest("PGRST100", "Syntax error: invalid column name in filter", trimmed, null);
  }
  let rest = trimmed.slice(dot + 1).trim();
  let negated = false;
  if (rest.startsWith("not.")) {
    negated = true;
    rest = rest.slice(4);
  }

  const op = FILTER_OPS.find((o) => {
    if (!rest.startsWith(o)) return false;
    if (rest.length === o.length) return true;
    const next = rest[o.length];
    return next === "." || next === "(" || next === '"';
  });
  if (!op) {
    throw ApiError.badRequest("PGRST100", `Invalid filter value: operator not recognized in "${raw}"`, null, `Supported: ${FILTER_OPS.join(", ")}, plus a not. prefix`);
  }

  let valueRaw = rest.slice(op.length);
  valueRaw = valueRaw.replace(/^[.(]/, "");
  if (valueRaw.endsWith(")") && op === "in") valueRaw = valueRaw.slice(0, -1);

  switch (op) {
    case "in": {
      const items = parseInItems(valueRaw);
      return { column, op, value: coerceInList(items), negated };
    }
    case "is": {
      const v = valueRaw.toLowerCase();
      if (v === "null") return { column, op, value: null, negated };
      if (v === "true") return { column, op, value: true, negated };
      if (v === "false") return { column, op, value: false, negated };
      throw ApiError.badRequest("PGRST100", `Invalid 'is' argument: "${valueRaw}"`, null, "Possible values: null, true, false, unknown");
    }
    case "like":
    case "ilike":
    case "match":
    case "imatch":
      return { column, op, value: valueRaw, negated };
    case "eq":
    case "neq":
      if (valueRaw.toLowerCase() === "null") return { column, op, value: null, negated };
      return { column, op, value: coerceScalar(valueRaw), negated };
    default: {
      const scalar = coerceScalar(valueRaw);
      if (typeof scalar === "boolean" || scalar === null) {
        throw ApiError.badRequest("PGRST100", `The ${op} operator requires a number or text value, got "${valueRaw}"`, null, null);
      }
      return { column, op, value: scalar, negated };
    }
  }
}

/** Parse the body of a `or=(...)` / `and=(...)` parameter into predicates. */
export function parseBooleanGroup(raw: string): FilterPredicate[] {
  let s = raw.trim();
  if (s.startsWith("(") && s.endsWith(")")) s = s.slice(1, -1);
  if (s.startsWith("or(") && s.endsWith(")")) s = s.slice(2, -1);
  const parts = splitTopLevel(s, ",");
  return parts.map(parsePredicate);
}

export function isReservedParam(name: string): boolean {
  return KEYWORDS.has(name.toLowerCase());
}

/* ------------------------------------------------------------------ */
/*  select / order / range / prefer parsing                             */
/* ------------------------------------------------------------------ */

export function parseSelect(raw: string | null): string[] {
  if (!raw || raw.trim() === "" || raw.trim() === "*") return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.includes(":") ? s.split(":")[1] : s))
    .map((s) => (s.endsWith("()") ? s.slice(0, -2) : s));
}

export function parseOrder(raw: string | null): OrderTerm[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => {
      const parts = seg.split(".");
      const column = parts.shift()!;
      let ascending = true;
      let nulls: NullsOrder | undefined;
      for (const p of parts) {
        if (p === "asc") ascending = true;
        else if (p === "desc") ascending = false;
        else if (p === "nullsfirst") nulls = "first";
        else if (p === "nullslast") nulls = "last";
      }
      return { column, ascending, nulls };
    });
}

export function parseRangeHeader(raw: string | null): { offset: number; limit: number | null } | null {
  if (!raw) return null;
  const m = /^(\d+)-(\d*)$/.exec(raw.trim());
  if (!m) return null;
  const offset = Number(m[1]);
  const limit = m[2] === "" ? null : Number(m[2]) - offset + 1;
  return { offset, limit };
}

export function parsePreferHeader(raw: string | null): { count: "exact" | "planned" | null; returnMode: "minimal" | "representation" | "headers-only" } {
  const out = { count: null as "exact" | "planned" | null, returnMode: "minimal" as "minimal" | "representation" | "headers-only" };
  if (!raw) return out;
  for (const tok of raw.split(";").flatMap((s) => s.split(","))) {
    const t = tok.trim().toLowerCase();
    if (t === "count=exact" || t === "count=planned") out.count = t.split("=")[1] as "exact" | "planned";
    if (t === "return=representation" || t === "return=headers-only") out.returnMode = t.split("=")[1] as any;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/*  Public entry                                                        */
/* ------------------------------------------------------------------ */

export interface QueryOptions {
  headers: { range?: string; prefer?: string };
}

export function parseQueryString(params: URLSearchParams, opts: QueryOptions = { headers: {} }): ParsedQuery {
  const q: ParsedQuery = createDefaultQuery();
  q.select = parseSelect(params.get("select"));

  const rawParams: [string, string][] = [];
  params.forEach((v, k) => rawParams.push([k, v]));
  for (const [k, v] of rawParams) {
    if (k === "or") q.orGroups.push(parseBooleanGroup(v));
    else if (k === "and") q.andGroups.push(parseBooleanGroup(v));
    else if (k === "order") q.order = parseOrder(v);
    else if (k === "limit") q.limit = clampInt(v, 1, 100_000);
    else if (k === "offset") q.offset = clampInt(v, 0, 100_000_000);
    else if (!isReservedParam(k)) q.filters.push(parsePredicate(`${k}.${v}`));
  }

  const pref = parsePreferHeader(opts.headers.prefer ?? null);
  q.count = pref.count;
  q.returnMode = pref.returnMode;

  const range = parseRangeHeader(opts.headers.range ?? null);
  if (range) {
    q.offset = range.offset;
    q.limit = range.limit;
  } else if (q.limit === null) {
    q.limit = 1000; // PostgREST default page size
  }
  return q;
}

function clampInt(raw: string, lo: number, hi: number): number | null {
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

/** Split a string on `sep` at paren-depth 0, honouring double quotes. */
export function splitTopLevel(input: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of input) {
    if (ch === '"') quoted = !quoted;
    if (!quoted) {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
    }
    if (ch === sep && depth === 0 && !quoted) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() || out.length === 0) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}