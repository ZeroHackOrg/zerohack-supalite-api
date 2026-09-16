#!/usr/bin/env node
/** zh-api — run, migrate and seed the SupaLite-compatible API. */

import { Command } from "commander";
import { loadOptions } from "./config.ts";

const program = new Command();

program
  .name("zh-api")
  .description("PostgREST-compatible API over SQLite and Postgres (SupaLite).")
  .version("0.1.0", "-v, --version");

program
  .command("serve")
  .description("Start the REST server (default).")
  .option("-p, --port <n>", "port to listen on", "")
  .option("--host <h>", "bind address", "127.0.0.1")
  .option("--db <uri>", "sqlite file, :memory:, or postgres:// URL", "")
  .option("--seed <n>", "seed sample CVEs", "")
  .action(async (opts) => {
    const options = loadOptions({
      port: opts.port ? Number(opts.port) : undefined,
      host: opts.host,
      database: opts.db || undefined,
      seed: opts.seed !== undefined && opts.seed !== "" ? Number(opts.seed) : 24,
    });
    const { serveOn } = await import("./index.ts");
    const { app, server, db } = await serveOn(options.port, options);
    const tables = Array.from(db.tables.keys()).sort().join(", ");
    console.log(`[zh-api] listening on http://${server.host}:${server.port} (${options.databaseName})`);
    console.log(`[zh-api] tables: ${tables}`);
    console.log(`[zh-api] REST root: http://localhost:${server.port}/rest/v1/`);
    console.log(`[zh-api] try:   curl "http://localhost:${server.port}/rest/v1/cves?severity=eq.CRITICAL&order=cvss_score.desc&select=cve_id,title,cvss_score"`);
    console.log("[zh-api] Ctrl+C to stop");
    void app;
    process.on("SIGINT", async () => {
      await db.close();
      await server.close();
      process.exit(0);
    });
  });

program
  .command("migrate")
  .description("Run migrations on the target database (no serving).")
  .option("--db <uri>", "sqlite file, :memory:, or postgres:// URL", "")
  .action(async (opts) => {
    const options = loadOptions({ database: opts.db || undefined });
    const { openDb } = await import("./db.ts");
    const db = await openDb(options);
    console.log(`[zh-api] migrated ${options.databaseName} database (${options.database}).`);
    await db.close();
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});