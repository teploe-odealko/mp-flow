# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

**DO NOT** open a public GitHub issue for security vulnerabilities.

Please email **security@mp-flow.ru** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Response Timeline

- **Acknowledgment:** within 48 hours
- **Initial assessment:** within 1 week
- **Patch release:** within 2 weeks for critical issues

## After Reporting

We will:

1. Acknowledge receipt within 48 hours
2. Investigate and confirm the vulnerability
3. Develop and test a fix
4. Release a patch version
5. Credit you in release notes (unless you prefer anonymity)

## Responsible Disclosure

We ask that you:

1. Allow us reasonable time to fix the issue before public disclosure
2. Do not access, modify, or delete data belonging to other users
3. Act in good faith to avoid disruption of service

## Scope

The following are in scope:

- Authentication and authorization bypasses
- SQL injection, XSS, CSRF
- Privilege escalation
- Data exposure across tenant boundaries
- Sensitive data leakage (API keys, credentials)

The following are out of scope:

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report these upstream)
- Issues requiring physical access to the server
