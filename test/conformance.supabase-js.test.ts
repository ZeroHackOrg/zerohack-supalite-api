import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createTestApp, signJwt } from "../src/index.ts";
import { fetchApp } from "../src/http-server.ts";

// Conformance: drive the REAL @supabase/supabase-js (v2) against this
// PostgREST-compatible API. If the queries a supabase client compiles
// round-trip cleanly here, they will on Supabase proper too.

let fx: Awaited<ReturnType<typeof createTestApp>>;
let client: SupabaseClient;
let authedClient: SupabaseClient;

beforeAll(async () => {
  fx = await createTestApp({ seed: 24 });
  const url = "http://localhost";
  const anonKey = "anon_conformance_key";

const fetchImpl = fetchApp(fx.app) as any;
client = createClient(url, anonKey, { global: { fetch: fetchImpl } });

const token = signJwt({ role: "authenticated", sub: "conformance-user" }, "conformance-secret");
authedClient = createClient(url, anonKey, {
  global: { headers: { Authorization: `Bearer ${token}` }, fetch: fetchImpl },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
void authedClient;
});

afterAll(async () => {
  await fx.db.close();
});

describe("supabase-js conformance (SQLite backend)", () => {
  it("selects rows: .select().limit()", async () => {
    const { data, error } = await client.from("cves").select("cve_id,title").limit(3);
    expect(error).toBeNull();
    expect(data).toHaveLength(3);
    expect(data![0]).toHaveProperty("cve_id");
    expect(data![0].title).toBeTypeOf("string");
  });

  it("applies eq filters", async () => {
    const { data, error } = await client.from("cves").select("*").eq("severity", "CRITICAL");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const r of data!) expect(r.severity).toBe("CRITICAL");
  });

  it("applies in filters", async () => {
    const { data, error } = await client.from("cves").select("*").in("severity", ["HIGH", "MEDIUM"]);
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
    for (const r of data!) expect(["HIGH", "MEDIUM"]).toContain(r.severity);
  });

  it("applies ilike and or() boolean groups", async () => {
    const { data, error } = await client
      .from("cves")
      .select("cve_id")
      .ilike("title", "%a%")
      .or("severity.eq.CRITICAL,severity.eq.HIGH");
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });

  it("orders desc and limits with Range semantics", async () => {
    const { data, error } = await client.from("cves").select("cvss_score").order("cvss_score", { ascending: false }).limit(4);
    expect(error).toBeNull();
    expect(data).toHaveLength(4);
    const scores = data!.map((r) => Number(r.cvss_score));
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
  });

  it("counts exactly via head", async () => {
    const { count, error } = await client.from("cves").select("*", { count: "exact", head: true });
    expect(error).toBeNull();
    expect(count).toBe(24);
  });

  it("inserts and returns representation", async () => {
    const { data, error } = await client
      .from("cves")
      .insert({ cve_id: "CVE-2026-C1", title: "conformance insert", severity: "MEDIUM", cisa_kev: false })
      .select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].cve_id).toBe("CVE-2026-C1");
  });

  it("upserts with onConflict", async () => {
    const { data, error } = await client
      .from("cves")
      .upsert({ cve_id: "CVE-2026-C1", title: "upserted", severity: "HIGH", cisa_kev: true }, { onConflict: "cve_id" })
      .select();
    expect(error).toBeNull();
    expect(data![0].title).toBe("upserted");
  });

  it("patches matching rows", async () => {
    const { data, error } = await client.from("cves").update({ title: "updated by patch" }).eq("cve_id", "CVE-2026-C1").select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].title).toBe("updated by patch");
  });

  it("deletes matching rows", async () => {
    const { data, error } = await client.from("cves").delete().eq("cve_id", "CVE-2026-C1").select();
    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0].cve_id).toBe("CVE-2026-C1");
  });

  it("surface PostgREST errors sanely (unknown column)", async () => {
    const { data, error } = await client.from("cves").select("does_not_exist");
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(String(error!.message)).toContain("schema cache");
  });
});