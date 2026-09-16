-- SupaLite demo schema — runs identically on SQLite and Postgres.
-- The cves/cve_references/cve_iocs trio mirrors ZeroHack's tracked CVE
-- model, normalized relationally the way the PostgREST contract expects.

CREATE TABLE IF NOT EXISTS cves (
  cve_id          TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  severity        TEXT NOT NULL DEFAULT 'UNKNOWN',
  cvss_score      NUMERIC,
  epss            NUMERIC,
  published_at    TEXT,
  updated_at      TEXT,
  exploit_available BOOLEAN NOT NULL DEFAULT 0,
  cisa_kev        BOOLEAN NOT NULL DEFAULT 0,
  is_zero_day     BOOLEAN NOT NULL DEFAULT 0,
  source          TEXT,
  affected_product TEXT,
  created_at      TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_cves_severity ON cves(severity);
CREATE INDEX IF NOT EXISTS idx_cves_published ON cves(published_at);
CREATE INDEX IF NOT EXISTS idx_cves_cvss ON cves(cvss_score DESC);

CREATE TABLE IF NOT EXISTS cve_references (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cve_id     TEXT NOT NULL REFERENCES cves(cve_id) ON DELETE CASCADE,
  url        TEXT NOT NULL,
  source     TEXT,
  type       TEXT
);

CREATE INDEX IF NOT EXISTS idx_cve_refs_cve ON cve_references(cve_id);

CREATE TABLE IF NOT EXISTS cve_iocs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  cve_id     TEXT NOT NULL REFERENCES cves(cve_id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  value      TEXT NOT NULL,
  context    TEXT
);

CREATE INDEX IF NOT EXISTS idx_cve_iocs_cve ON cve_iocs(cve_id);