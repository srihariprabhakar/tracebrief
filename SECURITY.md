# Security policy

TraceBrief handles logs and configuration that may contain sensitive information. Please report vulnerabilities privately through GitHub's security-advisory flow rather than opening a public issue.

## Important deployment note

This public MVP does not include authentication or tenant isolation. Do not expose it to the public internet with real customer evidence. Run it on a trusted workstation or add an authenticated gateway and case authorization.

Redaction is best-effort defense in depth. Review the redacted evidence ledger before sending a case to any external model endpoint.

## Supported versions

Security fixes are applied to the latest commit on `main` until tagged releases begin.
