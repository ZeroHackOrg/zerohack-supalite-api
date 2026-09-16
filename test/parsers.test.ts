import { describe, expect, it } from "vitest";
import { parseQueryString, parsePredicate, parseOrder, parseRangeHeader, parsePreferHeader, parseBooleanGroup, splitTopLevel } from "../src/parsers.ts";

describe("parsePredicate", () => {
  it("parses eq/neq/gt/gte/lt/lte with numeric coercion", () => {
    expect(parsePredicate("severity.eq.CRITICAL")).toMatchObject({ column: "severity", op: "eq", value: "CRITICAL", negated: false });
    expect(parsePredicate("cvss_score.gte.9.0")).toMatchObject({ column: "cvss_score", op: "gte", value: 9 });
    expect(parsePredicate("cvss_score.lte.4.1")).toMatchObject({ column: "cvss_score", op: "lte", value: 4.1 });
    expect(parsePredicate("severity.neq.LOW")).toMatchObject({ op: "neq" });
  });

  it("parses in with and without quotes", () => {
    const p = parsePredicate("severity.in.(HIGH,CRITICAL)");
    expect(p.op).toBe("in");
    expect(p.value).toEqual(["HIGH", "CRITICAL"]);
    expect(parsePredicate("severity.in.(HIGH,\"LOW,PRIV\")").value).toEqual(["HIGH", "LOW,PRIV"]);
    expect(parsePredicate("cvss_score.in.(9.0,10)").value).toEqual([9, 10]);
  });

  it("parses is.null / is.true / is.false", () => {
    expect(parsePredicate("published_at.is.null")).toMatchObject({ op: "is", value: null });
    expect(parsePredicate("cisa_kev.is.true")).toMatchObject({ op: "is", value: true });
    expect(parsePredicate("is_zero_day.is.false")).toMatchObject({ op: "is", value: false });
  });

  it("parses like / ilike patterns", () => {
    expect(parsePredicate("title.ilike.*wordpress*")).toMatchObject({ column: "title", op: "ilike", value: "*wordpress*" });
    expect(parsePredicate("title.like.%Acme%")).toMatchObject({ op: "like", value: "%Acme%" });
  });

  it("parses not.-prefixed predicates", () => {
    expect(parsePredicate("severity.not.eq.LOW")).toMatchObject({ negated: true, op: "eq", value: "LOW" });
    expect(parsePredicate("severity.not.in.(LOW,MEDIUM)")).toMatchObject({ negated: true, op: "in" });
    expect(parsePredicate("source.not.is.null")).toMatchObject({ negated: true, op: "is", value: null });
  });

  it("rejects malformed predicates", () => {
    expect(() => parsePredicate("severity.bogus.X")).toThrow(/operator not recognized/);
  });
});

describe("parseBooleanGroup", () => {
  it("parses or=(...) groups", () => {
    const group = parseBooleanGroup("(severity.eq.HIGH,is_zero_day.is.true)");
    expect(group).toHaveLength(2);
    expect(group[0]).toMatchObject({ column: "severity", op: "eq" });
    expect(group[1]).toMatchObject({ column: "is_zero_day", op: "is", value: true });
  });

  it("handles nested parens for in() inside or groups", () => {
    const group = parseBooleanGroup("(severity.in.(HIGH,CRITICAL),title.ilike.*apache*)");
    expect(group).toHaveLength(2);
    expect(group[0].value).toEqual(["HIGH", "CRITICAL"]);
  });
});

describe("parseQueryString", () => {
  it("parses filters, select, order, limit/offset", () => {
    const params = new URLSearchParams("select=cve_id,title&severity=eq.CRITICAL&order=cvss_score.desc&limit=5&offset=10");
    const q = parseQueryString(params);
    expect(q.select).toEqual(["cve_id", "title"]);
    expect(q.filters).toHaveLength(1);
    expect(q.filters[0]).toMatchObject({ column: "severity", value: "CRITICAL" });
    expect(q.order).toEqual([{ column: "cvss_score", ascending: false, nulls: undefined }]);
    expect(q.limit).toBe(5);
    expect(q.offset).toBe(10);
  });

  it("defaults page size to 1000", () => {
    const q = parseQueryString(new URLSearchParams(""));
    expect(q.limit).toBe(1000);
  });

  it("honours count=exact from Prefer header", () => {
    const q = parseQueryString(new URLSearchParams(""), { headers: { prefer: "count=exact" } });
    expect(q.count).toBe("exact");
  });

  it("Range header overrides limit/offset params", () => {
    const q = parseQueryString(new URLSearchParams("limit=2"), { headers: { range: "0-49" } });
    expect(q.offset).toBe(0);
    expect(q.limit).toBe(50);
  });

  it("keeps and/or beside reserved params", () => {
    const params = new URLSearchParams("or=(a.is.true,b.gt.3)");
    const q = parseQueryString(params);
    expect(q.orGroups).toHaveLength(1);
    expect(q.filters).toHaveLength(0);
  });
});

describe("parseOrder", () => {
  it("parses multi-column order with nulls", () => {
    expect(parseOrder("published_at.desc.nullsfirst,severity.asc.nullslast")).toEqual([
      { column: "published_at", ascending: false, nulls: "first" },
      { column: "severity", ascending: true, nulls: "last" },
    ]);
  });
});

describe("parseRangeHeader + parsePreferHeader", () => {
  it("parses closed and open ranges", () => {
    expect(parseRangeHeader("0-49")).toEqual({ offset: 0, limit: 50 });
    expect(parseRangeHeader("10-")).toEqual({ offset: 10, limit: null });
    expect(parseRangeHeader(null)).toBeNull();
  });

  it("parses prefer tokens", () => {
    expect(parsePreferHeader("return=representation,count=exact")).toEqual({ count: "exact", returnMode: "representation" });
    expect(parsePreferHeader(null)).toEqual({ count: null, returnMode: "minimal" });
  });
});

describe("splitTopLevel", () => {
  it("splits on commas outside parens and quotes", () => {
    expect(splitTopLevel("a,(b,c),\"d,e\",f", ",")).toEqual(["a", "(b,c)", '"d,e"', "f"]);
  });
});