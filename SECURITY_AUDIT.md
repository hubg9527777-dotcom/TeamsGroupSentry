> **2026-10-13 后续整改已完成（131 项测试通过）。** 本文是上一轮审核历史记录，其中“待开发者决定”状态已在 [整改补充报告](STABILITY_SECURITY_FOLLOWUP_2026-10-13.md) 更新。请以后者为准。

# TeamsGroupSentry v1.0.0 — 功能与安全审查（2026-10-13）

## 结论和约束

本次针对用户提供的 `TeamsGroupSentry_v1.0.0_Enhanced_Icons_Ready.zip` **实际源码**逐文件检查，并修改了状态口径、巡检过期反馈和事件筛选。**125/125 Node 自动测试通过、所有 JS/CJS 语法检查通过；真实 Teams 登录场景和真正的 Chrome 扩展 UI 尚未验收。** 不将测试通过解释为账号身份可靠认证、服务器实时成员认证或无漏洞保证。

## 一、项目概况

| 项目 | 结果 |
|---|---|
| 形态 | 本地 Chrome/Edge 扩展，Manifest V3，最低 Chrome 120 |
| 语言/框架 | 原生 JavaScript、HTML、CSS，浏览器 IndexedDB、Web Crypto、Chrome extension APIs；无前端第三方框架、无服务端 |
| 包管理 | 有 `package.json`，仅 `npm test`；无 `package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`requirements.txt`、go.mod/Cargo.toml/其他构建锁文件 |
| **npm 直接/间接依赖** | **0 个声明的 npm 依赖 / 0 个锁定的间接 npm 依赖**，无实际 npm 版本可列 |
| 可选 Python 浏览器测试 | `tests/recovery.browser.test.py:9` 引用第三方 `playwright`，项目**未锁定**版本；本次环境实测 `playwright 1.57.0`，其环境间接包 `pyee 13.0.1`, `greenlet 3.5.1`；这些是**本次运行环境**版本，不是插件分发版本 |
| 审核范围 | manifest、后台、content/MAIN 桥、overlay、popup、dashboard、lib、离线备份/恢复、静态图标、测试与文档，原始 ZIP 的全部 55 个文件，修复后交付包共 56 个文件（含文档、图标和测试） |
| 对外通信 | 未发现第三方 API/遥测/远程可执行代码；仅注入 `https://teams.live.com/*`；Teams 本地缓存不是服务器信任来源 |
| Git 历史 | 此 ZIP 不含 `.git`，无法验证曾否提交过密钥或敏感数据 |

**依赖公告交叉核对：** 查阅官方 [Playwright Python 项目](https://github.com/microsoft/playwright-python)、[Microsoft Playwright 安全公告](https://github.com/microsoft/playwright/security/advisories)、[GitHub Advisory 数据库](https://github.com/advisories)、[OSV.dev](https://osv.dev/) 与 [NVD](https://nvd.nist.gov/)。因正式 npm 依赖为 0，没有可以逐包按锁定版本做 CVE 匹配的 npm 依赖。搜索到的 `PlaywrightCapture`、`docling`、`Open WebUI` 公告涉及**不同的包**，不得错认为本项目依赖漏洞。可选 Python 测试工具未列出可核实的本项目相关 Critical/High 漏洞，但**不能推出其所有环境版本无漏洞**；若用于 CI，必须固定和定期审核测试工具及其间接依赖。

## 二、发现与状态

| 编号 | 类别 | 等级 | 位置（修改后文件:行） | 利用/触发前提，影响 | 状态 |
|---|---|---|---|---|---|
| FUNC-01 | 功能 / 状态分裂 | **Medium** | `background.js:422-460,729-754`; `popup/popup.js:22-62`; `overlay/overlay.js:67-84` | 弹窗读正式事件，状态栏在只读时还加本轮未持久化的通知量，同时后台有独立的 12 秒计数缓存；会出现跨界面颜色或数字不一致 | **已修复**：同一个 `statusSnapshot()`，只读观察不伪装成已保存的待办；跨账号计数归零 |
| FUNC-02 | 功能 / 名单状态 | **Medium** | `background.js:422-439`; `popup/popup.js:40-49`; `overlay/overlay.js:68-81` | 有黄色待核查群但未触发红色“新身份/重要事件”，旧状态栏却可能宣称“无异常” | **已修复**：增加 `review` 黄色状态、群数、提示和浏览器按钮黄 `!` |
| FUNC-03 | 功能 / 失联状态 | **Medium** | `background.js:69-81,419-462`; `ui/dashboard.js:72-73` | 关闭 Teams 或浏览器 worker 恢复后，工具栏可能保持旧的健康状态；弹窗/右上角过期阈值原本不同 | **已修复**：重启/闹钟刷新 Badge，统一两分钟阈值；无索引时非“健康” |
| FUNC-04 | 功能 / 跳转 | **Low** | `ui/dashboard.js:85-92` | “重要未处理”经内部导航会被误改成“全部待处理” | **已修复**：保留 `urgent/open/all/ack` 筛选语义 |
| SEC-01 | 代码 / 页面数据源完整性 | **High** | `lib/isolated-reader.js:13-32,64-100`; `background.js:256-265,270-318` | 已在相同 Teams 页面权限内运行的恶意脚本可能篡改原生 Teams IndexedDB，使 ISOLATED 阅读到假名单；插件无法独立验证 Microsoft 服务器身份 | **待开发者决定**：需要权威授权数据源/独立校验，不能自行重构接口 |
| SEC-02 | 代码 / 账号编辑授权 | **Medium** | `background.js:190-197,477-483,691-704` | 浏览器会话状态缺失或重启时，`assertIdentitySafeToEdit()` 只拒绝明确 `READ_ONLY`，未强制最近一次登录身份校验，存在旧账号分区误编辑风险 | **待开发者决定**：推荐无当前确认时默认只读；会影响离线操作体验 |
| SEC-03 | 代码 / 多标签账号状态 | **Medium** | `background.js:246-253,419-440,729-754`; `overlay/overlay.js:82-91` | 同一浏览器多开不同 Teams 账号标签时，后台采用全局最近观察分区，所有 Teams 右上角状态栏可能对应同一全局状态而非本标签账号 | **待开发者决定**：建议标签页级隔离/未知身份标记；需重新定义全局弹窗和扩展图标含义 |
| SEC-04 | 代码 / 本地隐私 | **Medium** | `lib/db.js:3-34`; `lib/recovery.js:20-97` | 获取浏览器 Profile 本地文件的程序可以读取未加密的群成员/审核索引和恢复点；只有导出的 `.encrypted.json` 已做 AES-GCM 加密 | **待开发者决定**：应用层常驻加密需新增解锁机制，会影响自动巡检 |
| SEC-05 | 代码 / 历史恢复账号归属 | **Medium** | `background.js:753-790`; `lib/recovery.js:142-195` | 恢复点可能记录多个账号的历史资料，“只补缺”不等于确认当前用户拥有所有旧分区 | **待开发者决定**：建议恢复前明确授权分区；可能改变跨账号历史恢复功能 |
| SEC-06 | 代码 / 内容脚本权限边界 | **Low** | `background.js:691-704,741-748`; `manifest.json:7-66` | 若 Teams 页面对应的 ISOLATED 内容脚本受到污染，仍可调用 `OVERLAY_PREFS_SET` 影响状态栏是否隐藏（但无法编辑白名单）；属于权限最小化余留 | **建议关注**：禁用网页内设置需删/迁移功能，应先定产品选择 |
| SEC-07 | 代码 / 缓存时效 | **Medium** | `content.js:37-81`; `lib/isolated-reader.js:13-32`; `background.js:246-253` | Teams 不更新未打开群的 IndexedDB 时，轮询也无法发现服务端成员变化；页面休眠/唤醒时效未实测 | **待确认**：真实账号覆盖率/延迟不具有 SLA |
| SEC-08 | 代码 / XSS 和数据载荷 | **Low** | `ui/dashboard.js:14-17,565-580`; `popup/popup.js:1-21`; `overlay/overlay.js:34-60` | 缓存群名/成员名为不可信文本；当前动态 UI 主要使用 `textContent`、`replaceChildren`，未发现可达的 DOM `innerHTML` 注入链路；测试源码含 `new Function` 但不参与浏览器扩展运行 | **已存在防护 / 建议回归** |
| SEC-09 | 代码 / 加密备份 | **Low** | `lib/backup-envelope.js:4-24`; `ui/dashboard.js:546-579` | 用户载入畸形或超大密文可能导致解析/分配异常；已有严格 Base64 和长度检查、随机 salt/IV、PBKDF2-SHA256 与 AES-GCM；完整文件仍应限制大小 | **既有防护保留**，未更改备份格式 |
| SEC-10 | 密钥 / 凭据 | **Low** | `.gitignore:1-25`、整个源代码、测试与文档 | 静态模式扫描未发现实际 GitHub/AWS/Slack token、Bearer 私钥、常见 Webhook、数据库含密码 URL；没有 `.env` 文件；没有 Git 历史供验证 | **建议持续关注**，扫描并非无泄露证明 |
| DEP-01 | 依赖 / 可重现性 | **Low** | `package.json:1-9`, `tests/recovery.browser.test.py:9` | 无 npm lock（正式 npm 依赖本身也为 0）；可选 Playwright 未声明/锁定测试版本 | **建议关注**：若上线 CI/开发者共同运行，添加固定测试环境依赖与漏洞检查 |

**未发现可达路径的类别：** 没有 SQL、命令执行/外壳、服务端请求、远程代码加载、可执行用户模板或 ZIP 解压器，因此未发现可验证的 SQL 注入、shell 注入、SSRF、开放跳转、ZIP Slip、服务器 CORS/CSRF 等典型漏洞；不存在 GitHub Actions 工作流供 `pull_request_target`/Action SHA 检查。没有发现 TLS 证书校验关闭代码。它们不适用不等于已经进行动态渗透测试。

## 三、本轮实际修改（均不改现有数据结构或成员审核策略）

1. **`background.js`**：新增唯一 `statusSnapshot()`；`SUMMARY`、`OVERLAY_STATUS` 和 `refreshBadge()`都从同一状态入口取值。只读且账号不符时不给旧账号计数；只读新增观测仅展示在说明文字，不造“已存待办”。
2. **`background.js`**：工具栏红色数字仅代表正式存储的“新身份待审 + 重要未处理”事项；名单核查/只读/超时/未初始化改为黄色 `!`；保证标题和可见语义一致。重启与巡检失败时刷新图标；正常完成扫描但无成员变化时也广播更新，以更新时间信息。
3. **`popup/popup.html`、`popup/popup.css`、`popup/popup.js`**：增加黄色健康状态条，明确“待核查群”、“账号只读”、“巡检超时”、“尚未建立索引”，并保留原有红色审核卡片。失败不应默默显示正常。
4. **`overlay/overlay.js`**：按后台状态级别渲染红/黄/正常，不再独立把只读临时通知合并成正式未处理事件；`alerts` 模式仍显示黄色异常/未建立索引。
5. **`ui/dashboard.js`**：内部导航保留 `urgent` 筛选，显示待核查群警告，并和其他界面统一 2 分钟失联提醒。
6. **`tests/worker.integration.cjs`、`tests/overlay-state.test.cjs`、`tests/popup-readonly.test.cjs`、`tests/navigation.test.cjs`**：增加后台/弹窗/网页状态栏/图标一致性、跨账号隔离、黄色名单、无基线以及筛选回归测试。
7. **文档**：更新本安全报告及升级说明，没有修改原有的成员数据、索引 schema、扩展权限、备份格式或图标素材。

## 四、运行与证据

| 项目 | 实测结果 |
|---|---|
| `npm test` | **125 通过 / 0 失败**（原 119 + 新增 6；浏览器 UI 不是此项实测） |
| JS/CJS `node --check` | **通过**，全部源码和测试文件 |
| JSON/Manifest 及图标 | **通过**：JSON 解析，用户四个 PNG 图标字节一致且尺寸为 16/32/48/128 |
| `npm audit --json` | **无法执行**：`ENOLOCK`，无依赖锁文件；**不是 0 漏洞结果** |
| `pip-audit` | 本地未安装；未对测试环境做包级自动依赖审计 |
| 可选 Chromium / Playwright 实测 | **未通过（环境阻断）**：导航本机 `127.0.0.1` 报 `ERR_BLOCKED_BY_ADMINISTRATOR`，不能将其计入通过 |
| 静态凭据模式扫描 | **0 个命中**：PEM、AWS、GitHub、Slack、长 Bearer、常见 Webhook、带口令数据库 URL；无 `.env` 文件 |
| 实际 Teams 登录/多账号 | **待确认**：未在用户浏览器环境中验证 |

## 五、需开发者决定（本轮没有擅自更改）

**A. 账号确认有效期**（推荐 A1）
- **A1（安全优先）**：浏览器重启/会话丢失后强制先重新确认当前 Teams 账号，未确认前能看不能编辑/恢复。
- A2（体验优先）：继续允许原账号索引离线编辑，但承担分区误写风险。

**B. 多账号/多 Teams 标签页策略**（推荐 B1）
- **B1**：每个 Teams 标签栏显示“本标签身份已匹配/未知”，全局弹窗按明确选定的账号显示；跨账号标签不能共享“健康”结论。需确认优先账号/显示策略。
- B2：维持全局状态显示并明确说明“不是此标签专属”，不改变存储/扫描方式。

**C. 数据源真实性**（推荐 C1）
- **C1**：现阶段坚持“仅本地缓存观察”，不宣称真实即时成员变动；后续研究受官方授权的数据源与独立校验。此项架构风险仍在。
- C2：立即改成官方认证服务端读取，必须先证实个人版 API 的能力与授权模型，属重大重构。

**D. 本地数据保护及历史恢复**（推荐 D1）
- **D1**：保持本地数据库自动巡检，使用系统全盘加密/专用浏览器 Profile，并对导出备份加密；历史恢复前由使用者确认账号归属。
- D2：应用层全面静态加密，必须新增解锁/密钥恢复策略，可能阻断自动扫描；账号恢复另行隔离，属于较大功能改造。

## 六、维护与发布提醒

实际安装时先在“规则与备份”导出加密备份；保留原扩展 **ID 和原来的解压目录**，仅覆盖里面的文件再到 `chrome://extensions` 点击重新加载，不要卸载后当作新扩展安装。测试账号、原399群组、备注/审核历史、名单候选与“查看人员”下拉功能均需人工验收。**真正已泄露过的凭据必须到对应服务平台撤销并轮换，删除新代码里的字符串并不能使旧密钥失效。** 当前扫描未发现可确认的需轮换凭据。
