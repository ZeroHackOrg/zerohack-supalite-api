<div align="center">

```
 ____________ _____   ____  _    _          _____ _  __
|___  /  ____|  __ \ / __ \| |  | |   /\   / ____| |/ /
   / /| |__  | |__) | |  | | |__| |  /  \ | |    | ' / 
  / / |  __| |  _  /| |  | |  __  | / /\ \| |    |  <  
 / /__| |____| | \ \| |__| | |  | |/ ____ \ |____| . \ 
/_____|______|_|  \_\____/|_|  |_/_/    \_\_____|_|\_\

              Fortifying the Digital Frontier
```

# @zerohack/supalite-api · `zh-api`

**PostgREST + GoTrue compatible API on SQLite and Postgres — SupaLite Select 2026 centerpiece**

[![License](https://img.shields.io/badge/license-Apache--2.0-00B0BD?style=for-the-badge)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178c6?style=for-the-badge&logo=typescript&logoColor=white)](tsconfig.json)
[![Zero Budget](https://img.shields.io/badge/cost-%240-00b894?style=for-the-badge)](https://zerohack.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-00B0BD?style=for-the-badge)](CONTRIBUTING.md)

**Part of the [ZeroHack](https://zerohack.org) Geek Tools ecosystem**
Category: `web` · `postgrest` · `supabase` · `sqlite` · `postgres`

</div>

---

> **⚡ Zero Budget. Zero Cloud Dependencies. Pure Local Power.**

---

## What It Does

A **PostgREST + GoTrue compatible REST API** that runs **interchangeably on
SQLite and Postgres**. Point `@supabase/supabase-js` at it and your existing
queries keep working. Dual driver, conformance-tested, zero dependency on
Firebase or any cloud service.

---

## Quick Start

```bash
# Clone the monorepo
git clone https://github.com/ZeroHackOrg/zerohack-geek-tools.git
cd zerohack-geek-tools
npm install
npm run geek:api -- serve --seed 24
```

**Or standalone:**

```bash
git clone https://github.com/ZeroHackOrg/zerohack-supalite-api.git
cd zerohack-supalite-api
npm install
# Requires @zerohack/shared — see standalone resolution in README
npx tsx src/bin.ts serve --seed 24
```

### Standalone Resolution

```bash
git clone https://github.com/ZeroHackOrg/zerohack-shared.git
cd zerohack-shared && npm install && npm link
cd ../zerohack-supalite-api && npm link @zerohack/shared
```

---

## Demo

```bash
curl "http://localhost:3001/rest/v1/cves?severity=eq.CRITICAL&order=cvss_score.desc&select=cve_id,title,cvss_score"
curl "http://localhost:3001/rest/v1/cves?cisa_kev=is.true&limit=5"
curl -X POST "http://localhost:3001/rest/v1/cves" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"cve_id":"CVE-2026-0001","title":"demo","severity":"HIGH"}'
```

---

## Compatibility

| Feature | Status |
|---|---|
| `select=col1,col2` column projection | ✅ |
| Filters `eq neq gt gte lt lte` | ✅ |
| Wildcard `like` / `ilike` | ✅ |
| `in.(a,b,c)` membership | ✅ |
| `is.null` / `is.true` / `is.false` | ✅ |
| Negation `not.eq` `not.in` | ✅ |
| Boolean groups `or=(…)` `and=(…)` | ✅ |
| `order=col.asc.nullsfirst` | ✅ |
| `Range: 0-49` + `limit`/`offset` | ✅ |
| `Prefer: count=exact` → `Content-Range` | ✅ |
| `Prefer: return=representation` | ✅ |
| Schema introspection `GET /rest/v1/` | ✅ |
| Auth: `apikey` header + `Authorization: Bearer <jwt>` (HS256) | ✅ |
| Errors: PostgREST-shaped `{code,message,details,hint}` | ✅ |

---

## Env

See [`.env.example`](.env.example). All optional.

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Server port |
| `ZH_API_HOST` | `127.0.0.1` | Bind address |
| `ZH_API_DATABASE` | — | `supalite.db` / `:memory:` / `postgres://…` |
| `ZH_API_SEED` | `24` | Seed N sample CVEs on boot (0 = disabled) |
| `ZH_API_JWT_SECRET` | — | HS256 secret (empty = dev open access) |
| `ZH_API_ANON_KEY` | — | Supabase anon key (empty = dev open access) |
| `ZH_API_DEFAULT_ROLE` | `anon` | Default role claim |

---

## Tests

```bash
npm run typecheck --workspace @zerohack/supalite-api
npm run test    --workspace @zerohack/supalite-api
# 67 conformance tests driving real @supabase/supabase-js
```

---

## Architecture

```
zerohack-supalite-api/
├── src/
│   ├── bin.ts             # CLI entrypoint (serve)
│   ├── config.ts          # Env var loading
│   ├── http-server.ts     # Hono HTTP server
│   ├── router.ts          # PostgREST-compatible routing
│   ├── query-builder.ts   # SQL query builder from PostgREST params
│   ├── parsers.ts         # Filter/select/order parsing
│   ├── schema.ts          # Table schema introspection
│   ├── db.ts              # Database abstraction
│   ├── driver.ts          # SQLite / Postgres dual driver
│   ├── auth.ts            # GoTrue-compatible JWT auth
│   ├── index.ts           # Re-exports
│   └── types.ts           # Shared types
├── migrations/
│   ├── 001_init.sql       # SQLite schema
│   └── 001_init.postgres.sql  # Postgres schema
├── test/
│   ├── *.test.ts          # Unit tests
│   ├── sqlite.integration.test.ts  # SQLite integration
│   └── conformance.supabase-js.test.ts  # Real supabase-js tests
├── .env.example
├── package.json
├── tsconfig.json
├── README.md
├── LICENSE                # Apache-2.0
├── SECURITY.md
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

**Design principles:**
- Dual driver: same app serves SQLite and Postgres, byte-equal responses.
- Conformance-tested against real `@supabase/supabase-js`.
- Zero dependency on ZeroHack infrastructure (no Firebase, no Firestore).
- Pure Node + Hono + better-sqlite3 + pg. Zero budget.

---

## Security

No secrets in code — config from env vars or local files only. JWT auth is
optional (dev mode is open access). Does not contact any external services.

For vulnerability reports, see [SECURITY.md](SECURITY.md).

---

## Related Packages

| Package | Binary | What It Does |
|---|---|---|
| [@zerohack/shared](../zerohack-shared) | — | Types, schemas, catalog |
| [@zerohack/cli](../zerohack-cli) | `zh` | Unified CLI |
| [@zerohack/pal](../zerohack-pal) | `zh-pal` | Local AI assistant |
| [@zerohack/secret-scanner](../zerohack-secret-scanner) | `zh-secret` | Secret scanner |
| [@zerohack/ssh-hardener](../zerohack-ssh-hardener) | `zh-ssh` | SSH auditor |
| [@zerohack/recon-bot](../zerohack-recon-bot) | `zh-recon` | Recon automation |
| [@zerohack/log-analyzer](../zerohack-log-analyzer) | `zh-log` | Log forensics |
| [@zerohack/honeypot](../zerohack-honeypot) | `zh-honeypot` | Honeypot |
| [@zerohack/osint-cli](../zerohack-osint-cli) | `zh-osint` | OSINT tools |
| [@zerohack/ctf-lab](../zerohack-ctf-lab) | `zh-lab` | CTF lab runner |
| [@zerohack/ctf-automation](../zerohack-ctf-automation) | `zh-ctf` | CTF solver |

---

## Community

- **Issues:** [GitHub Issues](https://github.com/ZeroHackOrg/zerohack-supalite-api/issues)
- **PRs:** [Pull Requests](https://github.com/ZeroHackOrg/zerohack-supalite-api/pulls)
- **Security:** [SECURITY.md](SECURITY.md)
- **Platform:** [zerohack.org](https://zerohack.org)

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Read our [Code of Conduct](CODE_OF_CONDUCT.md) first.

## License

[Apache-2.0](LICENSE) — Copyright 2026 ZeroHack Security
