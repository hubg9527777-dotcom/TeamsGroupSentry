# Security policy

TeamsGroupSentry is an independent Chrome extension relying on Teams local browser cache formats. It is not a server-authoritative security control.

## Reporting a vulnerability

Do **not** open public issues with credentials, cookies, JWTs, private chat content, real member IDs or plaintext snapshots. Before public release, configure **GitHub private vulnerability reporting** in repository Settings → Security → Private vulnerability reporting, if available. Otherwise contact the repository maintainer privately using a verified channel.

In reports, include the affected release number, a minimal synthetic reproduction and the security impact. Do not publicly publish working exploitation details against live Teams accounts.

## Supported version

Initial public release: v1.0.0. No long-term update or support commitment is currently made.

## Known limitations

- MAIN-world scripts can forge or suppress **scan hints**, but no longer supply roster snapshots. The ISOLATED scan remains dependent on the integrity of the Teams origin's IndexedDB, which a compromised same-origin page may alter. See `SECURITY_DECISIONS.md`.
- Local IndexedDB and local checkpoints are plaintext within the Chrome profile; external backups are password-encrypted.
- Undocumented Teams cache structures can change; a green status is not proof of no actual intrusion.
