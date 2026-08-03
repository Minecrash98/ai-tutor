# AI Tutor P8 结果与限制

证据日期：2026-08-02；本地收口：2026-08-03
结论：本地机器候选已收口到 `75 VERIFIED / 1 IN_PROGRESS / 24 BLOCKED / 0 NOT_STARTED`；整体仍为 `NO_GO`。官方比赛、真人、专家、法律、最终候选清洁 checkout 复现、异机现场和独立审查证据仍缺失。购买永久排除。

## 1. 最终本地候选绑定

- 发布输入 SHA-256：`9ee0ada4aae360b309b5373d3c2cfc93c4312ef638b160a88b332dbc1a1f7f06`，共 261 个发布输入文件。
- lockfile SHA-256：`a81ae93224e8929812c363d913bbaac6e6340dd15bc11d61a06d559cc02b8390`。
- Web 镜像：`sha256:cf1f0e332a34a4c98433fbfe4f6c376ee928220ae1fafe344a887bfc3eeaa6f6`。
- migration 镜像：`sha256:247f3039005d5de2f12deda3b76fae552946b10be3a252c9f1204758ca17403a`。
- PostgreSQL 镜像：`sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`。
- 绑定清单：`evidence/P8_RELEASE_MANIFEST_2026-08-02T18-39-13-438Z.json`；文件 SHA-256：`ad715ffee3a1f234c85caa33126428b9d653e99f98e23a818b65c43bf2a5da5e`。
- 清单明确只绑定本地 release candidate，不暗示完成 30 分钟浸泡。
- 2026-08-03 已初始化 Git、建立公开仓库并把 `main` 推送到
  `https://github.com/Minecrash98/ai-tutor`；首个公开提交为
  `727dad77ac2c39911834b73e31e53ca650bcdfc6`。CI 来源证明仍需等待公开工作流实际完成。

## 2. 完整机器基线

最近一次完整本地基线：

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：239 项通过，10 项按账户/Live 条件诚实跳过。
- `pnpm build`：通过，Next.js 16.2.12 生产构建完成。
- `pnpm test:e2e`：67 项通过，18 项账户相关 Live 场景诚实跳过；0 失败。
- 最终无缓存镜像上的 `pnpm test:e2e:compose`：25/25 通过，真实 PostgreSQL 权威回放、三主题、统一 Tutor/事实/画布时间线、转移题和故障恢复均覆盖。

专项机器结果：Chrome/Edge/Firefox/WebKit 矩阵 12 项通过、8 项按能力边界跳过；移动触控 5/5；自动无障碍 3/3；安全 3/3；故障 9/9；视觉 7/7；许可界面 2/2。所有浏览器使用全新隔离 context，不读取或修改用户 Chrome 历史画布。

这些是自动化机器结果，不是陌生学生独立完成、真人读屏、真实设备或评委现场验收。

## 3. 学习闭环与事实 grounding

- 盒模型、Flex、定位均完成预测、学生操作、解释、亲写 CSS、隐藏迁移、失败/缺失记录和 PostgreSQL 回放。
- 误区与自适应支架从冻结学习事件推导，保留 source event UUID；单次错误不会直接贴误区标签。
- `inspect_selected_element`、`read_relevant_source`、`read_last_student_action` 和 `read_teaching_assertion_evidence` 提供受限事实。
- 因果断言缺少允许且充分的 receipt 时，运行时替换为不确定说明并静音该断言；17 项单测和 grounding E2E 通过。
- 评委证据面板可展开 sequence、action、time、event UUID、revision、source event、evaluator/criterion/rubric/model 版本并下载审计包。
- Tutor 文字/合成语音状态与最终消息、工具结果、事实 receipt 和学生/AI 画布保存动作已进入同一版本化时间线；通用事件不改变课程 reducer。
- 学生未同意保存对话正文时只留字数/角色/模式/时间，正文保持 `null`，回放明确显示“正文未保存”。

目标 094 的单元、PostgreSQL、文字、合成语音、Compose 与截图证据见
`docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md`，现为 `VERIFIED`。
边界：事实 receipt 持久化的是允许状态、目标、前后值、规则来源/值与不确定原因，
不是完整 provider 内部上下文；合成语音事件验收不是人类听感或学习效果。

## 4. 性能

`evidence/P8_PERFORMANCE_2026-08-02.json` 来自单 worker、全新隔离 Chromium，并通过冻结预算：

- 21 个运行时、53 个教学块；导入 P95 340ms，总设置 5812ms，刷新恢复 1004ms。
- requestAnimationFrame P95 16.8ms、最大 16.8ms；冻结 P95 预算 18.5ms。
- heap 188MB，DOM 8754 个节点，序列化存储约 96KB。
- 47 个真实拖动预览样本 P95 23.3ms、最大 32.5ms。
- 114 个 pointer frame 样本 P95 16.8ms，超过 20ms 为 0；交互期间超过 50ms long task 为 0。
- 拖动期间不提交完整权威 workspace；松手后权威写入为 1 次。

这只证明当前主机上的 headless 浏览器短时预算。用户明确取消再次运行 30 分钟浸泡；现有中途停止记录不具备 `qualification=true`，目标 083 保持 `IN_PROGRESS`。不得将本节外推到比赛机器、可见 GPU、投影或长期泄漏。

## 5. 语音延迟的诚实口径

`evidence/P6_LATENCY_SAMPLES_2026-08-02.json` 保存 10 组冷/暖配对、共 20 个成功样本。每次使用全新隔离 Chromium、合成假麦克风和 `--mute-audio`，物理麦克风调用为 0，P95 使用 nearest-rank：

- 受控确认音：2088ms。
- 最终输入转写：2072ms。
- 首模型音频能量：2324ms。
- 画布可见 T1：10214ms。
- 首个有意义字幕：10228ms；画布可见后再等待 55ms。
- 20/20 会话均拦住最终用户转写前的提前 AI 输出。

因此只能说确认音与首模型音频低于 2.5 秒；不能把约 10.2 秒的有用画布/字幕路径说成低于 2.5 秒，也没有真人非静音听感证据。

## 6. 发布、恢复与供应链

- Web 与 migration 由当前源码无缓存重建；Compose Web/PostgreSQL 健康，`/api/health` 返回 200 且真实数据库查询通过。
- `evidence/P8_BACKUP_RESTORE_DRILL_2026-08-02.json` 证明 custom-format 备份在隔离临时数据库恢复：12 张表、18 个索引、25 个约束、4 个迁移及逐表行数一致；未覆盖当前数据库。
- 最终三镜像 SBOM 分别记录 Web 307、migration 20、数据库 66 个组件；tldraw 3.15.5 许可证副本、第三方 notices 和可见水印保留。
- `pnpm release:manifest` 已独立于浸泡脚本生成当前候选绑定；它不运行或暗示 30 分钟浸泡。
- `pnpm audit --prod --audit-level high` 返回无已知漏洞。
- Grype 0.116.1 最终扫描：Web 与 migration 各 12 项（Critical 1、High 2、Medium 2、Negligible 7）；数据库 3 项 Medium。Web/migration 的三个 High/Critical glibc 条目标记 `wont-fix`，未隐藏，也不能声称“零漏洞”。
- Node 26 Chainguard 候选不符合冻结的 Node `<26` 范围；没有为追求零扫描结果而偷偷升级运行时。
- 容器无法访问宿主 Codex app-server 时，preflight 返回 `READY_WITH_FALLBACK`，三条确定性课程仍可完成且明确标为演示模式。

## 7. 没有发生的事情

- 真实学生人数：0；没有可用性完成率、学习效果或延迟保持结果。
- CSS/教学专家审查：0；真人解释 rubric 一致性未测。
- 陌生听众复述、真人读屏、三次盲演、独立 go/no-go：均未发生。
- 官方比赛名称、评分表、时限、联网/外部服务规则：未提供。
- 法律、隐私、商标和比赛展示权意见：未取得；工程 license/SBOM 不是法律意见。
- 第二台机器、第二网络、投影、热点、耳麦和真实噪声麦克风矩阵：未验收。
- 公共 GitHub：已验证 `https://github.com/Minecrash98/ai-tutor` 为公开主页面；
  YouTube 与比赛表单最终提交尚未完成。
- 30 分钟浸泡：没有合格的当前源码记录，且按用户要求不再重跑。
- 购买：未发生，也不会执行。
- 视频 Demo：已在全新隔离浏览器中录制全英文 CSS 全局颜色变量 v2 候选，画面包含真实认证文字 Tutor 的两次学生提问和两次 Tutor 回复。旁白通过本地 Piper `en_US-lessac-high` 生成；浏览器使用假媒体和 `--mute-audio`，物理麦克风调用 0。主 MP4 为 300.000 秒、1280×720、25 fps、H.264 High + AAC-LC；备选 WebM 为 300.008 秒、VP8 + Opus。文件与 SHA-256 见 `docs/submission/DELIVERY_CHECKLIST.md`。这是本地候选，尚未上传或冒充官方最终提交。

## 8. 当前裁决

100 项已无 `NOT_STARTED`：75 项本地机器验收完成，只有 083 因用户取消重跑 30 分钟浸泡而保持 `IN_PROGRESS`，24 项等待真实外部证据。十项硬 go/no-go 中事实 grounding、工具能力隔离和统一证据回放达到机器验收；其余仍受真人、长期保持、法律、Git/官方映射、现场与独立审查约束。

因此整体必须保持 `NO_GO`；`VERIFIED` 的机器行不能被解释为比赛获奖、真人学习效果、法律合规或最终提交批准。
