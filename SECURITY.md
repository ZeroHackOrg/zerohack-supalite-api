# Security Policy

## Reporting a Vulnerability

**Do NOT open a public GitHub issue for security bugs.**

If you discover a security vulnerability in this project, please report it
privately:

- **Email:** [security@zerohack.org](mailto:security@zerohack.org)
- **PGP:** Encrypt sensitive reports with our public key
  (fingerprint `B3DC 91D7 3621 CFE7 6EB2 F739 51F0 D8B3 1515 A492`).

Please include:
1. A description of the vulnerability
2. Steps to reproduce
3. Affected version(s)
4. Any suggested fix (optional)

## What Qualifies

We consider the following in scope:
- Remote code execution
- Privilege escalation
- Authentication/authorization bypass
- SQL / NoSQL injection
- Cross-site scripting (XSS) that can be exploited in context
- Cryptographic weaknesses
- Information disclosure of secrets, keys, or PII
- Denial of service in production systems

## Disclosure Timeline

We aim to follow a responsible disclosure process:

| Stage | Timeframe |
|---|---|
| Acknowledgment | Within 48 hours |
| Initial triage | Within 5 business days |
| Fix or mitigation | Within 30 days for critical/high severity |
| Public disclosure | After a fix is released, or 90 days max |

We will coordinate with you on disclosure timing. We ask that you do not
disclose publicly before a fix is available.

## Scope

This policy applies to the code in this repository. Third-party
dependencies are out of scope — please report vulnerabilities in
upstream projects to their maintainers directly.

## Supported Versions

| Version | Supported |
|---|---|
| Latest `main` | Yes |
| Older releases | Best-effort, no guarantee |

Thank you for helping keep ZeroHack and its users safe.
