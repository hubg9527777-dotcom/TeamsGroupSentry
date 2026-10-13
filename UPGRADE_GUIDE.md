# Upgrade / install TeamsGroupSentry v1.0.0

## First GitHub install

1. Extract the release ZIP. Select the directory containing `manifest.json` when loading the unpacked extension in `chrome://extensions`.
2. Keep a signed-in `https://teams.live.com/v2/` tab open; refresh the tab once to let the content script initialize.
3. Review cache/identity status and confirm the account before writing a baseline.

## Upgrade an existing unpacked extension

1. **Before any replacement, export an encrypted backup to a location outside the extension directory.** Save your password separately.
2. Record existing group/person/pending-review counts.
3. Do not uninstall the old extension, move its directory, or switch Chrome profiles. Replace the contents of the **same folder** with this package's project root files.
4. On `chrome://extensions` click Reload for the **existing extension**.
5. Refresh the signed-in Teams tab; verify that the popup says `V1.0.0` and the same extension ID persists.
6. Compare prior group, person, group alias, whitelist and pending review counts. Inspect the automatic upgrade checkpoint before editing policies.

The external version is `1.0.0`, including for users upgrading from internal `3.x` or candidate `1.0.x` builds; this intentionally does **not** reset the IndexedDB schema (`teams-group-sentry-v3`, schema `1`) or group-member baselines. Chrome extension data follows the extension ID, not the source ZIP name.

## Backup behavior

Importing an older backup is **non-destructive** and fills only absent records. It does not reset today's roster or replay old alerts. To compare historical differences, use `Compare historical backup` instead. Automatic recovery checkpoints are local and not a replacement for encrypted off-device backups.

## Failure recovery

If the identity guard says read-only, **do not force overwrite**. Confirm the correct Teams account; restore only missing records after reviewing the checkpoint. Do not reinstall or delete the extension to fix a display issue.

## MAIN trust-boundary hardening release

- Same public version label `1.0.0` (security-hardened source build); database schema name and records unchanged.
- Member records now come from the ISOLATED content script, not MAIN messages.
- Token interception was removed. Identity is conservatively inferred from a unique ID shared by at least 10 group rosters; if this does not match an approved local identity, the scanner is **read-only** until manual confirmation. Check monitored-group counts and account guard after updating.
- The unpacked extension folder does **not** need to be stored in a VeraCrypt volume: sensitive IndexedDB records reside in Chrome/Edge profile storage, not the source folder. Keep external encrypted backups safely.
- Do not uninstall the existing extension or remove its indexedDB storage; export an encrypted backup first.
