/** Database bootstrap — open a driver for the detected target, run the
 *  dialect-appropriate migration, and (optionally) seed a sample CVE
 *  corpus from @zerohack/shared. */

import fs from "node:fs";
import path from "node:path";
import { SqliteDriver, PostgresDriver, type Driver } from "./driver.ts";
import type { ApiOptions } from "./config.ts";
import { bindValue, quoteIdent } from "./schema.ts";
import type { TableSchema } from "./schema.ts";
import { sampleCves } from "@zerohack/shared";
import { ApiError } from "./types.ts";

export interface Db {
  driver: Driver;
  tables: Map<string, TableSchema>;
  refreshTables(): Promise<void>;
  seed(count: number): Promise<number>;
  close(): Promise<void>;
}

function sqliteMigrationPath(root: string): string {
  const candidate = path.resolve(root, "migrations", "001_init.sql");
  if (fs.existsSync(candidate)) return candidate;
  const fallback = path.resolve(root, "packages", "supalite-api", "migrations", "001_init.sql");
  return fs.existsSync(fallback) ? fallback : candidate;
}

function postgresMigrationPath(root: string): string {
  const base = path.resolve(root, "migrations", "001_init.postgres.sql");
  if (fs.existsSync(base)) return base;
  return path.resolve(root, "packages", "supalite-api", "migrations", "001_init.postgres.sql");
}

export async function openDb(opts: ApiOptions): Promise<Db> {
  const driver: Driver =
    opts.databaseName === "postgres" ? new PostgresDriver(opts.database) : new SqliteDriver(opts.database);

  const migrationFile = opts.databaseName === "postgres" ? postgresMigrationPath(opts.cwd) : sqliteMigrationPath(opts.cwd);
  const migration = fs.existsSync(migrationFile) ? fs.readFileSync(migrationFile, "utf8") : "";

  const tables = new Map<string, TableSchema>();
  const db: Db = {
    driver,
    tables,
    async refreshTables(): Promise<void> {
      tables.clear();
      for (const t of await driver.tables()) tables.set(t.name, t);
    },
    async seed(count: number): Promise<number> {
      const cves = tables.get("cves");
      if (!cves) return 0;
      const cveTable = quoteIdent("cves");
      const dialect = opts.databaseName === "postgres" ? "postgres" : "sqlite";
      let inserted = 0;
      for (const row of sampleCves(count)) {
        const exists = await driver.query(`SELECT 1 AS x FROM ${cveTable} WHERE "cve_id" = ? LIMIT 1`, [row.cve_id]);
        if (exists.length) continue;
        const cols = [
          "cve_id",
          "title",
          "description",
          "severity",
          "cvss_score",
          "epss",
          "published_at",
          "updated_at",
          "exploit_available",
          "cisa_kev",
          "is_zero_day",
          "source",
          "affected_product",
        ];
        const placeholders = cols.map(() => "?").join(", ");
        const params = cols.map((col) => {
          const schema = cves.columns.find((c) => c.name === col)!;
          return bindValue((row as unknown as Record<string, unknown>)[col] ?? null, schema, dialect);
        });
        await driver.run(`INSERT INTO ${cveTable} (${cols.map(quoteIdent).join(", ")}) VALUES (${placeholders})`, params);
        inserted++;
      }
      return inserted;
    },
    async close(): Promise<void> {
      await driver.close();
    },
  };

  if (migration) await driver.migrate(migration);
  await db.refreshTables();
  if (opts.seed > 0) await db.seed(opts.seed);
  return db;
}

export function tableList(db: Db): string[] {
  return Array.from(db.tables.keys()).sort();
}

export function requireTable(db: Db, name: string): TableSchema {
  const t = db.tables.get(name);
  if (!t) {
    throw ApiError.notFound("PGRST205", `Relation "${name}" does not exist`, null, "Verify the table name, then run the migrations (zh-api --migrate).");
  }
  return t;
}