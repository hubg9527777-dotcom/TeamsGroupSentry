## 2026-10-13 安全复审与巡检稳定性补丁（保持版本 1.0.0 和数据结构）

详细说明参见 `SCAN_RELIABILITY_FIX_2026-10-13.md`：后台与手动扫描合并、限时读取、可见页面补偿、失败诊断、缓存源限速、不完整数据只读保护。

# Changelog

## v1.0.0 — First public release

- Monitors locally cached Teams group membership changes with a 30-second fallback poll and accelerated cache-write signals.
- Adds critical-group alert prioritization, a Teams-page status overlay, red popup warnings and a Chrome toolbar badge.
- Includes group aliases, cross-group identity indexing, review workflows, whitelist policy and identity-bound read-only safety mode.
- Supports password-encrypted exports, non-destructive imports, encrypted historical backup comparison, and local recovery checkpoints.
- Preserves compatible historical extension IndexedDB schemas and account partitions when upgrading in place.
- Ships as an unpacked Manifest V3 extension with no third-party npm dependencies.

**Limitations:** locally cached rosters are not authoritative real-time server membership records. MAIN may still receive spoofed scan hints; roster data is read in ISOLATED, but Teams IndexedDB remains an unverified data source. Refer to SECURITY_AUDIT.md.

### Security-hardened build of 1.0.0 (same public version)

- Moved roster scanning to the ISOLATED content-script world; MAIN now only signals cache writes.
- Removed page-hook token/JWT inspection and roster `window.postMessage` transfer.
- Blocked legacy MAIN ingestion and accidental re-binding of an unrelated user to a legacy provisional account.
- Added conservative account inference from cached group rosters and 397-group scanner regression tests.
- Clarified that source-folder VeraCrypt is not required and does not protect the browser-managed roster database.

### Final security audit (same public version 1.0.0)

- Added strict, size-bounded encrypted backup envelope validation before Base64 decoding and AES-GCM decryption; no change to existing backup format or member indices.
- Added regression tests for malformed, oversized and truncated encrypted backup input.
- Clarified that the unpacked extension source folder does not contain the live member database and has no mandatory VeraCrypt location requirement. Browser-profile data remains outside the source folder.
- Completed the latest audit in `SECURITY_AUDIT.md`; live Teams/Chrome/Edge acceptance tests are still required before claiming production-grade coverage.

### Identity-guard usability/security fix (still public version 1.0.0)

- Fixed an overly strict self-ID heuristic: a single incomplete inactive roster no longer invalidates a near-universal member ID hint (requires >=95% coverage and a distinct leader; this remains **unverified local inference**).
- Added an **explicitly approved**, persistent hash of the Teams conversation-cache database scope. After a one-time account confirmation, read/write may resume without an inferred self ID **only** when >=80% of prior group IDs and >=80% of their member rosters still match; the conservative member-overlap threshold is >=60% per group.
- Unrecognized or conflicting accounts, incomplete scans and dissimilar rosters remain read-only; they never auto-rebind or replace the prior account baseline.
- The Teams-page corner badge now uses amber for identity-only read-only protection; red is reserved for pending identity/urgent review. If both are present, red wins.
- Does not alter IndexedDB schema, external dependencies, permissions, membership baseline, backup format or public version.


### 人工核查更新（公开版本仍为 1.0.0）
- 保留旧成员基线，同时记录只供核查的最新候选成员 ID。
- 群组详情新增缓存差异对照、人工核实确认和安全拒绝条件。
- 确认时以单事务更新目标群基线、仅该群的当前关系以及本地审计历史；陌生人身份状态不被自动批准。
- 旧数据与升级恢复点不主动清理。

### 状态一致性修复与安全复审（2026-10-13，公开版本仍为 1.0.0）
- 后台共享状态口径统一弹窗、Teams 网页右上角与 Chrome 工具栏 Badge，黄色名单核查/只读/失联/未初始化可见；跨账号历史计数不串用。
- 修复巡检成功但群成员无变化时状态栏不及时更新、异常情况下 Badge 不恢复的问题。
- 修复“重要未处理”内部跳转误切为全部待处理的筛选问题。
- 测试 125/125 通过；浏览器环境 E2E 仍未获管理员网络授权，见 SECURITY_AUDIT.md。

### 单账号免确认、恢复分区隔离与缓存完整性加固（2026-10-13，公开版本号不变）
- 保持浏览器重启后先前批准账号的无感使用；编辑操作新增账号分区一致性验证。
- 历史恢复点的显示、核验与补回严格限制当前账号；不跨账号混入旧成员。
- 本地缓存读取不完整时只读保护，不再将缺失/新增缓存误写为已确认变更，也不通知疑似新增。
- 补充后台载荷边界检查，恢复点失败可重试，清理无效的状态计数变量。
- 继续沿用现有数据库 Schema、图标与群成员切换功能；新增/回归测试累计 131 项通过。
- 无法凭本地扩展独立证明 Teams 服务器真实名单，本机常驻数据库也没有额外加密；详见补充报告。
