# Contributing to ZeroHack Geek Tools

Thanks for your interest in contributing! This project is open to community
input. Here's how to get started.

## Ways to Contribute

- **Report bugs** — open an issue with steps to reproduce
- **Suggest features** — open an issue describing the use case
- **Submit a PR** — fork, branch, test, open a pull request

## Getting Started

```bash
git clone https://github.com/ZeroHackOrg/<repo>.git
cd <repo>
npm install
npm run typecheck
npm run test
```

## Branch Naming

| Type | Pattern |
|---|---|
| Feature | `feat/short-description` |
| Bug fix | `fix/short-description` |
| Docs | `docs/short-description` |
| Chore | `chore/short-description` |

## PR Requirements

1. **All tests pass** (`npm run test`).
2. **Typecheck passes** (`npm run typecheck`).
3. One focused change per PR — keep PRs small and reviewable.
4. Write a clear PR description explaining *what* and *why*.
5. Reference any related issues (`Closes #123`).

## Code Style

- TypeScript strict mode, ESM.
- No secrets in code — config comes from env vars only.
- No files in this repo should import from the main ZeroHack platform
  (`app/`, `lib/`, `public/`, `worker/`).
- Pure functions preferred; I/O stays in entrypoints (`bin.ts`).

## Testing

Every package uses [Vitest](https://vitest.dev). Run tests from the
monorepo root:

```bash
npm run geek:test
```

Or a single package:

```bash
npm run test --workspace @zerohack/<package-name>
```

## Code of Conduct

This project follows the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md).
By participating you agree to abide by its terms.

## License

By contributing, you agree your submissions will be licensed under the
[Apache License 2.0](LICENSE).
