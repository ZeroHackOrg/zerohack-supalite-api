import { describe, expect, it } from "vitest";
import {
  buildCountQuery,
  buildSelectQuery,
  makeContext,
  planDelete,
  planInsert,
  planUpdate,
} from "../src/query-builder.ts";
import type { TableSchema } from "../src/schema.ts";
import { parseQueryString } from "../src/parsers.ts";

const SCHEMA: TableSchema = {
  name: "cves",
  primaryKey: "cve_id",
  columns: [
    { name: "cve_id", type: "TEXT", kind: "text", nullable: false, primaryKey: true },
    { name: "title", type: "TEXT", kind: "text", nullable: false, primaryKey: false },
    { name: "severity", type: "TEXT", kind: "text", nullable: false, primaryKey: false },
    { name: "cvss_score", type: "NUMERIC", kind: "numeric", nullable: true, primaryKey: false },
    { name: "cisa_kev", type: "BOOLEAN", kind: "bool", nullable: false, primaryKey: false },
    { name: "published_at", type: "TEXT", kind: "text", nullable: true, primaryKey: false },
  ],
};

function q(query: string) {
  return parseQueryString(new URLSearchParams(query));
}

describe("buildSelectQuery", () => {
  it("renders a full select with all columns and default paging", () => {
    const r = buildSelectQuery(SCHEMA, q(""), "sqlite");
    expect(r.sql).toContain('SELECT "cve_id", "title", "severity", "cvss_score", "cisa_kev", "published_at" FROM "cves"');
    expect(r.sql).toContain("LIMIT ? OFFSET ?");
    expect(r.params.map((p) => p.value)).toEqual([1000, 0]);
  });

  it("selects a subset of columns", () => {
    const r = buildSelectQuery(SCHEMA, q("select=cve_id,title"), "sqlite");
    expect(r.sql).toContain('SELECT "cve_id", "title"');
    expect(r.sql).not.toContain("severity");
  });

  it("parameterizes eq filters with the right kind", () => {
    const r = buildSelectQuery(SCHEMA, q("severity=eq.CRITICAL"), "sqlite");
    expect(r.sql).toContain('WHERE ("severity" = ?)');
    expect(r.params[0]).toMatchObject({ value: "CRITICAL", kind: "text" });
  });

  it("renders ilike as LOWER() on sqlite and ILIKE on postgres", () => {
    const s = buildSelectQuery(SCHEMA, q("title=ilike.*apache*"), "sqlite");
    expect(s.sql).toContain('LOWER("title") LIKE LOWER(?)');
    const p = buildSelectQuery(SCHEMA, q("title=ilike.*apache*"), "postgres");
    expect(p.sql).toContain('"title" ILIKE ?');
  });

  it("renders in, is.null, is.true, not.eq", () => {
    const r = buildSelectQuery(SCHEMA, q("severity=in.(HIGH,CRITICAL)&published_at=not.is.null&cisa_kev=is.true&cve_id=not.eq.CVE-0"), "sqlite");
    expect(r.sql).toContain('"severity" IN (?, ?)');
    expect(r.sql).toContain('NOT ("published_at" IS NULL)');
    expect(r.sql).toContain('"cisa_kev" = ?');
    expect(r.params.some((p) => p.kind === "bool")).toBe(true);
  });

  it("renders or groups with proper parens", () => {
    const r = buildSelectQuery(SCHEMA, q("or=(severity.eq.HIGH,severity.eq.CRITICAL)"), "sqlite");
    expect(r.sql).toContain('("severity" = ? OR "severity" = ?)');
  });

  it("renders count query without paging", () => {
    const r = buildCountQuery(SCHEMA, q("severity=eq.HIGH"), "sqlite");
    expect(r.sql).toBe('SELECT COUNT(*) AS c FROM "cves" WHERE ("severity" = ?)');
    expect(r.params).toHaveLength(1);
  });

  it("throws PostgREST-shaped error for unknown column", () => {
    expect(() => buildSelectQuery(SCHEMA, q("select=bogus"), "sqlite")).toThrow(/Could not find the 'bogus' column/);
  });
});

describe("planInsert", () => {
  it("builds a multi-value insert returning *", () => {
    const rows = [
      { cve_id: "CVE-1", title: "a", severity: "HIGH", cisa_kev: true },
      { cve_id: "CVE-2", title: "b", severity: "LOW", cisa_kev: false },
    ];
    const plans = planInsert(SCHEMA, rows, "sqlite");
    expect(plans).toHaveLength(1);
    expect(plans[0].sql).toContain("VALUES (?, ?, ?, ?)");
    expect(plans[0].multi).toBe(true);
    const boolParams = plans[0].params.filter((p) => p.kind === "bool");
    expect(boolParams.map((p) => p.value)).toEqual([1, 0]); // sqlite booleans bind as ints
  });

  it("falls back to per-row plans when key sets diverge", () => {
    const rows = [
      { cve_id: "CVE-1", title: "a", severity: "HIGH" },
      { cve_id: "CVE-2", title: "b" }, // no severity key
    ];
    const plans = planInsert(SCHEMA, rows, "sqlite");
    expect(plans).toHaveLength(2);
  });
});

describe("planUpdate / planDelete", () => {
  it("binds set values before where values", () => {
    const r = planUpdate(SCHEMA, q("severity=eq.HIGH"), { severity: "MEDIUM", cisa_kev: false }, "sqlite");
    expect(r.sql).toContain('UPDATE "cves" SET "severity" = ?, "cisa_kev" = ? WHERE ("severity" = ?)');
    expect(r.params).toHaveLength(3);
    expect(r.params[0].value).toBe("MEDIUM");
    expect(r.params[1].value).toBe(0);
    expect(r.params[2].value).toBe("HIGH");
  });

  it("deletes with a filter only", () => {
    const r = planDelete(SCHEMA, q("cve_id=eq.CVE-999"), "sqlite");
    expect(r.sql).toContain('DELETE FROM "cves" WHERE ("cve_id" = ?)');
  });
});

describe("makeContext", () => {
  it("keeps quotes on reserved words", () => {
    const ctx = makeContext("sqlite");
    expect(ctx.quote("order")).toBe('"order"');
  });
});