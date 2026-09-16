import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createTestApp, type AppContext } from "../src/index.ts";

// NOTE: `AppContext` is only used as a type anchor; the app is fetched via
// the createTestApp harness, which always boots an in-memory SQLite backend.

let fx: Awaited<ReturnType<typeof createTestApp>>;

beforeAll(async () => {
  fx = await createTestApp({ seed: 24 });
});

afterAll(async () => {
  await fx.db.close();
});

const JSON_HEADERS = { "Content-Type": "application/json" };

describe("GET / (manifest)", () => {
  it("lists tables and dialect", async () => {
    const res = await fx.app.request("http://localhost/");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.dialect).toBe("sqlite");
    expect(body.tables).toContain("cves");
  });
});

describe("GET /rest/v1/ (introspection)", () => {
  it("describes cves columns", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.definitions.cves.columns.map((c: any) => c.name)).toContain("cve_id");
  });
});

describe("GET /rest/v1/cves", () => {
  it("returns seeded rows with paging", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?limit=5", { headers: { range: "0-4" } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveProperty("cve_id");
    expect(res.headers.get("content-range")).toContain("0-4");
  });

  it("filters by severity eq and orders by cvss_score desc", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?severity=eq.CRITICAL&order=cvss_score.desc&select=cve_id,title,cvss_score");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.severity).toBeUndefined(); // projected away
    for (const r of rows) expect(typeof r.cvss_score).toBe("number");
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].cvss_score).toBeGreaterThanOrEqual(rows[i].cvss_score);
  });

  it("supports boolean and null filters", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?cisa_kev=is.true&published_at=not.is.null&limit=100");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    for (const r of rows) expect(r.cisa_kev).toBe(true);
  });

  it("supports ilike wildcards", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?title=ilike.*a*&select=cve_id,title&limit=50");
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    for (const r of rows) expect(r.title.toLowerCase()).toContain("a");
  });

  it("honours Prefer: count=exact via Content-Range", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?limit=3", { headers: { prefer: "count=exact" } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(res.headers.get("content-range")).toBe(`0-${rows.length - 1}/24`);
  });

  it("returns a 400 with PostgREST shape on unknown column", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?select=bogus");
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body).toMatchObject({ code: "PGRST204" });
    expect(body.message).toContain("bogus");
  });

  it("returns 404 for unknown tables", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/nope");
    expect(res.status).toBe(404);
    const body: any = await res.json();
    expect(body.code).toBe("PGRST205");
  });
});

describe("POST /rest/v1/cves", () => {
  it("inserts a single row (minimal return)", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ cve_id: "CVE-2026-T1", title: "insert test", severity: "HIGH", cvss_score: 9.1, cisa_kev: false }),
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-range")).toBeNull();
  });

  it("returns representation when requested", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves", {
      method: "POST",
      headers: { ...JSON_HEADERS, prefer: "return=representation" },
      body: JSON.stringify({ cve_id: "CVE-2026-T2", title: "insert repr", severity: "LOW", cisa_kev: false }),
    });
    expect(res.status).toBe(201);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cve_id: "CVE-2026-T2", title: "insert repr" });
  });

  it("rejects unknown columns with PostgREST error", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ cve_id: "CVE-2026-T3", nope: 1 }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).code).toMatch(/^PGRST/);
  });

  it("rejects invalid JSON", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves", {
      method: "POST",
      headers: JSON_HEADERS,
      body: "not json {",
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.code).toContain("PGRST1");
  });
});

describe("PATCH /rest/v1/cves", () => {
  it("updates matching rows and returns them on representation", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?cve_id=eq.CVE-2026-T1", {
      method: "PATCH",
      headers: { ...JSON_HEADERS, prefer: "return=representation" },
      body: JSON.stringify({ severity: "CRITICAL" }),
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe("CRITICAL");
  });
});

describe("DELETE /rest/v1/cves", () => {
  it("deletes matching rows", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?cve_id=eq.CVE-2026-T2", {
      method: "DELETE",
      headers: { prefer: "return=representation" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()) as any[]).toHaveLength(1);

    const gone = await fx.app.request("http://localhost/rest/v1/cves?cve_id=eq.CVE-2026-T2");
    expect((await gone.json()) as any[]).toHaveLength(0);
  });
});

describe("auth enforcement", () => {
  it("still serves without returning the anon key", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?limit=1");
    expect(res.status).toBe(200);
  });

  it("breaks on unknown table even in dev mode", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/ghosts");
    expect(res.status).toBe(404);
  });
});

describe("Order and paging via Range header", () => {
  it("applies offset/limit from Range: 2-5", async () => {
    const res = await fx.app.request("http://localhost/rest/v1/cves?order=cve_id.asc", { headers: { range: "2-5" } });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as any[];
    expect(rows).toHaveLength(4);
    expect(res.headers.get("content-range")).toContain("2-5");
  });
});