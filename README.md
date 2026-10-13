# TeamsGroupSentry v1.0.0

中文 | Local-only Chrome extension · Microsoft Teams consumer web client

> **Unofficial, not affiliated with Microsoft.** This is an independent browser extension for observing **locally cached** Teams group-member data. It is **not** a server-authoritative audit system, and it cannot guarantee immediate detection of an actual join.

**2026-10-13 稳定性与安全补充：** 浏览器重启沿用已批准本地账号，不必重复确认；历史恢复点只补回当前账号的数据；不完整 Teams 缓存只读且不会触发新增人员误报。详细见 整改补充报告（内部记录已移除）。

**2026-10-13 安全及状态一致性修复：** 详见 安全审核报告（内部记录已移除） 与 状态同步修改记录（内部记录已移除）。弹窗、Teams 右上角状态栏及浏览器工具栏统一红色待办 / 黄色需关注 / 近期已巡检状态；黄色状态不意味着真实入群。

## Popup and toolbar alerts

- When the current account has **new identities awaiting review** or **important unresolved events**, the extension popup displays a red warning banner and highlights only the relevant cards. Both counts retain distinct labels; red does not mean a server-confirmed intrusion.
- The Chrome toolbar badge also becomes red and shows the **sum of actionable items** (capped at `99+`), even if the only pending item is a newly seen identity. An identity and its separate event may count as two tasks, not two unique people.
- When both counts reach zero, the red warning clears. **Yellow `!`** remains if the roster is uncertain, the account is read-only, scans are stale (>2 minutes), or no index exists; the popup refreshes while open.
- In ambiguous-account read-only mode, the popup does **not** show another account's old counts as current-user warnings. Existing baseline data and alert history are preserved.

## Features

- Discover group chats and member IDs from Teams' local IndexedDB `conversation-manager` cache.
- Monitor observed member ID additions; keep distinct states for newly seen global identities and additions to existing groups.
- Mark groups as **critical**, **standard**, or **quiet**. Critical groups receive more prominent alerts; local cache write-completion events can trigger a faster audit than the 30-second fallback poll.
- Optional Teams-page corner status overlay; manual group aliases and people notes; cross-group identity index; optional AA-prefix classification and explicit approval.
- Read-only guard for ambiguous account identity, locally encrypted backup export, recovery checkpoints, non-destructive restore of missing records.
- **Compare against a previous encrypted backup without replacing today’s data.** Review globally new IDs, new group membership relationships and newly indexed groups separately. Explicitly add historical-difference notices if needed; these are not confirmed server-side joins.
- No auto-kick, no chat-message collection or sending, no remote telemetry endpoint.

## Requirements

- Google Chrome 120 or newer (Manifest V3).
- A signed-in Teams web tab at `https://teams.live.com/v2/`.
- An open signed-in Teams tab with its own IndexedDB cache. Teams user identity needs to be consistently observable from cached group membership; otherwise the extension safely switches to read-only audit mode.

## Install from source

1. Unzip the source archive into a directory you manage. The folder containing `manifest.json` is the extension directory. There is **no mandatory VeraCrypt source-folder requirement**; extension records live in Chrome/Edge profile storage, not inside the unpacked source directory.
2. Open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select the unzipped folder containing `manifest.json`. Keep this folder at the same path for later upgrades.
3. Open the logged-in Teams website, refresh that page once, then click **立即巡检** in the extension popup.
4. If the guard reports an unbound/ambiguous account, carefully verify your account and use the explicit binding UI before permitting changes to existing baselines.

**Important when upgrading an existing installation:** **do not uninstall the old extension**; back up first and replace source files **inside the same previously loaded directory**, then click Reload in `chrome://extensions`. Otherwise the browser may create a new extension ID and isolate the old IndexedDB data. The public release is `1.0.0`; existing internal database schema and identity partition formats are preserved for migration compatibility. See [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md).

## How faster cache change detection works

- Only the `conversations` object store in a database named `Teams:conversation-manager:*` is observed.
- The observer watches the `complete` event of **native `readwrite` IndexedDB transactions**, never changes the values or consumes message bodies.
- MAIN only sends a **cache-dirty hint**. The ISOLATED content script directly reads and parses Teams IndexedDB; neither member rosters nor JWT/token claims travel through page `postMessage`. The hint triggers a debounced scan (approximately 1–5 seconds in a responsive browser, not an SLA).
- Scans still validate roster IDs and distinguish uncertain changes. The periodic `chrome.alarms` scan (nominally every 30 seconds) remains the fallback.
- If Teams does **not** update the local cache for a quiet or closed group, neither the event hook nor polling can detect the server-side join until the cache updates.
- The event-hook lifecycle and page-script interposition are browser-version dependent; review `DIAGNOSTIC.cacheWatchActive` and `lastScanTrigger` in actual operation. A flag being true does **not** prove that a write event was emitted.


## Compare historical backup to current cache

1. Open **人员安全中心 → 规则与备份**.
2. Select the existing `TeamsGroupSentry-v3-YYYY-MM-DD.encrypted.json` file and enter the password originally used to export it.
3. Click **比较历史备份与当前成员** — **not** the import/restore button.
4. Review **新增唯一人员 ID**, **原有群新增成员关系**, and **新增群组** separately.
5. If you explicitly want to keep red review events for people missing from the backup but present today, click **把这些历史新身份加入待核查事件** and confirm. The action labels them as historical-difference notices, not real-time admission events, and suppresses duplicates on repeated comparison.

**Privacy:** Decryption occurs in the extension UI, comparison in the extension service worker; no upload. The historical file is not stored by the comparison process. It must match the active account partition. Existing whitelist, group baselines, and approvals are untouched by comparison. If the current Teams identity is ambiguous, comparison across a conflicting partition and saving historical alerts are blocked.

**Data caveats:** Yesterday's snapshot is not guaranteed complete or server-authoritative. Differences can result from delayed Teams local-cache synchronization, newly discovered chats, or a person first becoming visible rather than actually joining between the two dates. When a group did not exist in the backup, its initial members are not incorrectly counted as joins into an existing group.

**Restore behavior remains the same:** Import/restore fills missing keys; it does not revert the live database to a previous time and does not replay old alerts. Use historical comparison to analyze changes.

## Local storage and optional disk encryption (Windows / macOS)

- **No VeraCrypt requirement for the extension source directory.** It contains JavaScript, UI and icons, not the live personnel database. Encrypting the source folder alone provides no meaningful protection to the actual extension data.
- Group and person indices, local recovery checkpoints and policies live in **browser-managed extension-origin IndexedDB / Chrome Storage**, normally under the relevant Chrome/Edge profile. These records are not application-encrypted at rest.
- Users responsible for protecting their browser profiles can use operating-system or volume encryption; that is a separate deployment decision, outside this extension's installer. The project does not claim to attest or enforce any VeraCrypt state.
- External `.encrypted.json` exports use a password-derived key and AES-256-GCM. Save and handle those files separately. No roster data or tokens should be committed to GitHub.
- An unlocked browser profile is still accessible to software running with the user's permissions. This protection limitation is disclosed in `SECURITY_AUDIT.md`.

## Local data and privacy

Extension-origin IndexedDB stores groups, people, membership relationships and review events. Local recovery checkpoints are also stored in the browser profile and are **not encrypted at rest**. Exported backups are password encrypted (PBKDF2-SHA256 + AES-256-GCM). The `unlimitedStorage` permission removes Chrome's default small-extension-storage quota but is **not unlimited physical disk space** or protection from profile deletion. Do not commit exports, captures, HAR files, screenshots, real member IDs or names to public GitHub.

**Security boundary:** MAIN is now a write-completion hint source only; it cannot provide the roster, account ID or token claims for persistence. ISOLATED reads the browser's same-origin IndexedDB directly. This blocks the old forged-roster-via-`postMessage` path, but a compromised Teams origin can still tamper with its own IndexedDB. A per-tab nonce is not proof of a trustworthy page. User-account inference from cached membership is conservative and not an authenticated server login assertion. See SECURITY_DECISIONS.md（内部记录已移除） and [SECURITY.md](SECURITY.md).

## Development and tests

Pure JavaScript MV3; no third-party runtime or development packages and no lockfile. Requires Node.js for tests only.

```bash
npm test
```

Optional browser test:

```bash
python tests/recovery.browser.test.py
```

This browser test requires Playwright, local Chromium, and an environment that permits local HTTP access. Tests use synthetic data. A passing unit suite is not a substitute for a real Teams session and Chrome MV3 service-worker test.

## Release and GitHub

- Source root is already laid out for a GitHub repository (manifest at root).
- The archive contains **source and tests**, not user-specific backup data.
- This repository currently includes **no LICENSE file**, because the author has not yet chosen a redistribution license. Choose one before describing the project as open source.
- Before pushing, review staged changes, enable GitHub secret scanning / push protection, and inspect commit history for sensitive files.
- See [CHANGELOG.md](CHANGELOG.md), SECURITY_AUDIT.md（内部记录已移除）, and [UPGRADE_GUIDE.md](UPGRADE_GUIDE.md).

## Disclaimer

Microsoft Teams is a Microsoft product. This extension depends on undocumented Teams browser cache structures which may change without warning. A normal/green status means no difference was observed in the available cache; it is **not** evidence that no unknown person actually joined a group.

## Account identity safety fix (v1.0.0 refreshed source)

If the overlay says **账号只读守护**, the cached groups have been read but roster writes
are suspended. This is **not** by itself a suspicious join and now displays amber
rather than red. Red means a new identity needs approval and/or an important
unresolved event remains.

The Teams local roster can omit the signed-in member from an inactive group's
cache. To avoid permanent read-only mode:

1. The ISOLATED reader uses a conservative near-universal roster observation as
   an **identity hint, not Microsoft authentication**.
2. If this hint is missing, the extension can use a locally recorded scope
   **only after a user explicitly confirms the current account once**. It
   requires strong agreement with the account's **existing** group IDs and
   member IDs. It never turns a brand-new unknown scope directly into a trusted
   writable account.
3. If the account or cached membership differs too much, or data is incomplete,
   the extension stays READ_ONLY and the saved roster is not overwritten.

**Existing users:** Keep the original extension ID and IndexedDB. Export an
encrypted backup first, replace the unpacked source files, reload the extension
and Teams. If the popup shows a yellow identity prompt with **确认当前账号并建立 /
沿用基线**, verify the actual Teams account and approve the link once. Re-scan;
existing group aliases, approved people and historical review state are preserved.
If no confirmation button is available, do not reset the roster: the cache
cannot be safely linked and further diagnostics are required.

**Security limitation:** Even the approved cache scope is not cryptographic
Microsoft login proof. A shared or maliciously modified Teams cache can still
confuse local identity matching. The extension intentionally declines baseline
writes on conflicts. This feature does not claim zero false positives or
server-authoritative real-time membership.


## v1.0.0 · 人工名单核查修复

- 遇到「名单出现减少或替换」时，保留旧基线，同时保存最近一次来自 ISOLATED 读取器的待核查名单（只保存在扩展自身的 IndexedDB）。
- 打开「人员安全中心 → 群组中心 → 名单不确定 → 查看/命名」，可以看到旧基线与最新缓存的增减 ID 对照；**这些仅为缓存差异，不能证明实际入群或退出**。
- 在 Teams 原生成员列表核实后，勾选人工核实声明并点击「确认当前名单并解除黄色标记」。确认前仍需再次核对摘要；本操作只修改被选择的群组，并留下含旧/新成员 ID 的本地审计记录。
- **只读守护、过期观察、候选名单已经变化、账号不匹配时，后台拒绝确认**。不自动批准任何新身份。旧版产生的黄色群组要先手动扫描一次，才能保存候选名单并显示对比。
- 若确认后同群再次变黄，说明 Teams 缓存又发生了变化或计数/质量规则再次改变，应核实来源，不要反复直接确认。

该更新继续显示 `1.0.0`，不改变 IndexedDB schema，不卸载插件即可覆盖升级。升级前请导出加密完整备份；首次运行后的真实 Teams 兼容性仍需人工验证。
