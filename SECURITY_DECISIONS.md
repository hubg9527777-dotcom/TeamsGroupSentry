# Security architecture decisions — TeamsGroupSentry v1.0.0

## Implemented

- **Roster data never crosses a MAIN-world `postMessage` boundary.** `lib/isolated-reader.js` parses Teams same-origin IndexedDB in Chrome/Edge's `ISOLATED` content script world and calls `chrome.runtime.sendMessage` directly through `content.js`.
- MAIN (`lib/cache-watch.js` + `page-reader.js`) is retained **only** for a coalesced cache-write-completion hint. Malicious MAIN scripts may forge this hint, but it does **not** carry roster rows or privileged commands. A per-tab nonce only correlates messages; it cannot authenticate same-origin scripts.
- The worker rejects legacy MAIN roster submissions and unexpected JWT metadata (`background.js::validate`). It still validates the sender's extension identity, frame and origin.
- The ISOLATED reader derives a **tentative** account ID only when exactly one member is common to at least ten observed group rosters; it never labels that as cryptographic proof of login. A missing/ambiguous ID forces read-only monitoring. Existing users may have to confirm identity/baseline again after upgrading; baseline data is not deleted.
- **Fixed additional account-mixup vulnerability:** an unmatched identity cannot inherit a previously approved legacy `provisional:*` account's write permission. Explicit human linking is required.
- On read-only mode, existing snapshots cannot be overwritten, edited or restored from a backup.

## Browser-owned data versus extension source path (final decision)

- No mandatory VeraCrypt check or forced encrypted source-folder install. The source directory contains extension code and assets, not the live roster storage.
- TeamsGroupSentry writes rosters, identities, events and recovery checkpoints to browser-managed extension IndexedDB (plus minor Chrome Storage preferences/session entries), normally in the Chrome/Edge profile.
- Encrypting the unpacked extension directory would **not encrypt those databases**, so such a check would give users false assurance. Optional browser-profile/OS encryption and password-protected export backups remain available.
- No third-party telemetry endpoint is configured, and data is not uploaded by the extension.

## Residual risks and decisions

1. **Teams data source integrity (High; unresolved):** a Teams-origin script with write privileges can alter the site's own IndexedDB. Reading it in ISOLATED prevents JS message spoofing but does not prove the data came from Microsoft. Server-authenticated independent verification would require a separate API architecture, not implemented here.
2. **Chrome/Edge extension database plaintext at rest (Medium; unresolved):** local IndexedDB and recovery snapshots remain unencrypted at the application layer. A separate OS-profile encryption policy or optional application encryption is needed. VeraCrypt for the extension directory alone is insufficient; it is not mandated.
3. **Disk encryption (informational):** encryption of the unpacked source directory is neither required nor a useful control for protecting browser-profile IndexedDB. Application-layer or profile encryption remains a separate deployment choice.
4. **Current-account ambiguity:** if common-roster-ID inference is inconclusive, the extension enters read-only audit. It can compare where a safe baseline is available but cannot safely update it. A user confirmation may be necessary.
5. **Availability:** Teams may not refresh the cache for unopened groups. A cache write hint or 30-second alarm cannot guarantee server-level real-time monitoring. Page scripts may also suppress hints; scheduled scans remain the fallback.

## Testing

Run `npm test`. Tests include MAIN roster forgery rejection, 397-group ISOLATED cache scans, conservative account inference, legacy account migration guard, backup/whitelist regression tests. Real Teams browser behavior requires manual validation.

## Confirmed account-binding fallback for partial local rosters

This refreshed v1.0.0 retains the existing read-only fence. A browser cache
scope hash alone **never** authorizes edits: the user must explicitly accept
that scope from a privileged extension UI, the selected account must already
have a prior baseline, and the independently read ISOLATED roster must have
substantial group and member overlap. A changed active account, partial scan,
unrecognized scope or failed continuity gate disables the fallback. Scope
metadata contains a SHA-256-derived identifier, not a token or the raw DB name.
This is a **locally approved identity association**, not a validated Microsoft
identity. Fallback is intentionally not automatically enabled for a new account.

Account-only read-only state uses an amber attention indicator; pending
membership/identity review remains red. Display color does not weaken the
write-protection fence.

## 2026-10-13 convenience and safety follow-up

User-approved deployment model: one Teams account per browser profile. Normal browser restarts
must not force the user to repeat account confirmation. Privileged mutations now require the
persisted active account to have its own approved account metadata; a present READ_ONLY or
foreign WRITE guard still blocks writes. Previously approved scope linkage and continuity
checks remain unchanged. Partial cache scans never persist or notify a new-member event.

Recovery checkpoints may still physically contain older partitions, but their UI listings,
verification and insertion of missing rows are strictly scoped to the current active account.
No changes were made to historical checkpoint storage bytes, extension ID or IndexedDB schema.

Application-level at-rest encryption of the always-on database was **not** implemented:
without a separately supplied secret, automatically unlocking a key stored in the same
profile does not materially protect against profile-file compromise; introducing a password
at every restart conflicts with the explicit usability decision. Encrypted exports and
operating-system disk/profile protections remain recommended. Teams cache authenticity
continues to be a disclosed architectural limitation; local consistency checks do not make
it a server-authoritative roster source.

See STABILITY_SECURITY_FOLLOWUP_2026-10-13.md for line numbers and test evidence.
