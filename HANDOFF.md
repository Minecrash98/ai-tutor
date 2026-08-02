# AI Tutor 第一名执行 Handoff

收口时间：2026-08-03
工作目录：仓库根目录

## 1. 权威状态

- 当前阶段：`P8_IN_PROGRESS / ALL_POST_P7_PHASES_AUTHORIZED / PURCHASES_EXCLUDED`。
- P6 与 P7 已于 2026-08-02 获用户明确批准；P8、部署、真人研究和后续阶段均已授权。
- 购买永久排除：不得购买许可证、服务、设备、广告或参与者激励。
- 100 项当前为：`75 VERIFIED / 1 IN_PROGRESS / 24 BLOCKED / 0 NOT_STARTED`。
- 整体仍为 `NO_GO`；机器通过不替代真人、专家、法律、官方比赛或独立审查。
- 该目录没有 `.git`，不得声称有 commit、push、CI 或干净 checkout 复现。
- 用户明确要求不再运行 30 分钟浸泡；目标 083 保持 `IN_PROGRESS`，历史中途记录不得称通过。
- 最新请求：先完成 100 项收口；之后只规划提交与视频 Demo，不开始录制、剪辑、上传或最终提交。

下一位执行者先完整读取：`AGENTS.md`、`MVP_SPEC.md`、`ARCHITECTURE.md`、
`IMPLEMENTATION_PLAN.md`、`COMPETITION_FIRST_PLACE_REVIEW.md`、
`COMPETITION_FIRST_PLACE_GOALS.md` 和本文件。

## 2. 已收口的产品与学习路径

- 盒模型、Flex、定位三条确定性 Predict–Observe–Explain–Transfer 课程。
- 一次点击第一课；任务式首页、隔离课程、撤销/重做/删除/退出/十次重置与 `390×844` 完整路径。
- 每课含预测、学生操作、因果解释、亲写 CSS、两道冻结隐藏迁移、失败/缺失和延迟调度。
- 版本化误区库与事件驱动的规则优先支架，保留 source event UUID，不用单次失误直接贴标签。
- 版本化最小学习者模型、四态证据、mastery policy、课程 authoring/lint 和研究工具。
- Learning Proof 使用 PostgreSQL 权威事件/快照、浏览器 checksum outbox、冲突/幂等/恢复和跨三课统一回放；Tutor 文字/合成语音、工具、事实 receipt 与画布保存动作进入同一时间线。
- 证据面板展开到 sequence、action、time、event UUID、revision、source event 与 evaluator/criterion/rubric/model 版本，并可下载审计包。

目标 094 已通过本地机器验收，见
`docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md`。当前唯一
`IN_PROGRESS` 是用户明确取消重跑的 083；不得补跑或伪称 30 分钟浸泡通过。

## 3. Realtime 与事实边界

- 文字模式不创建麦克风；语音模式先做能力预检并提供按住说话/常开麦选择。
- 所有语音机器验收使用全新隔离 Chromium、假麦克风和 `--mute-audio`，从未访问物理麦克风。
- Tutor 使用最小临时 cwd、独立 profile、服务端硬 allowlist、owner/Origin/大小/速率/TTL/幂等边界。
- 当前 Realtime provider 热重载版本为 `24`，必须与代码常量保持一致。
- SSE 有递增 ID/cursor 恢复；打断/停止后无旧回合字幕、音频或工具副作用。
- 四个只读 grounding 工具覆盖选中元素、受限源码、最后学生行动和断言证据。
- 关键因果话术必须取得允许且充分的 assertion-evidence receipt；缺证据会替换为不确定说明并静音该断言。
- 成功的 assertion-evidence receipt 会把允许状态、目标、前后值、规则来源/值与不确定原因写入 Learning Proof；它不等于保存完整 provider 内部上下文。对话正文仍严格服从学生的保存选择，不得声称历史逐字可审计。
- P6 延迟 20/20：最终转写 P95 2072ms、确认音 2088ms、首模型音频 2324ms、画布 T1 10214ms、首有意义字幕 10228ms。只能说前两类音频时间低于 2.5 秒，不能把画布路径说成低于 2.5 秒。

冻结证据：`P6_MACHINE_ACCEPTANCE_2026-08-01.md`、
`evidence/P6_LATENCY_SAMPLES_2026-08-02.json`、
`P7_MACHINE_ACCEPTANCE_2026-08-02.md`、
`docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md`。

## 4. 最终本地候选

- source fingerprint：`9ee0ada4aae360b309b5373d3c2cfc93c4312ef638b160a88b332dbc1a1f7f06`（261 个发布输入文件）。
- release manifest：`evidence/P8_RELEASE_MANIFEST_2026-08-02T18-39-13-438Z.json`，SHA-256 `ad715ffee3a1f234c85caa33126428b9d653e99f98e23a818b65c43bf2a5da5e`。
- Web：`sha256:cf1f0e332a34a4c98433fbfe4f6c376ee928220ae1fafe344a887bfc3eeaa6f6`。
- migration：`sha256:247f3039005d5de2f12deda3b76fae552946b10be3a252c9f1204758ca17403a`。
- PostgreSQL：`sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`。
- 最终无缓存 Compose 健康；容器健康脚本返回 HTTP 200、数据库 `ready=true`。
- 最终镜像核心浏览器套件：25/25 通过。
- SBOM 组件：Web 307、migration 20、数据库 66。
- Grype：Web/migration 各 Critical 1、High 2、Medium 2、Negligible 7；数据库 3 Medium。High/Critical glibc 项为 `wont-fix`，不得称零漏洞。

完整数字与边界以 `docs/RESULTS_AND_LIMITATIONS_2026-08-02.md` 为准。

## 5. 验证基线

最近一次完整本地基线：

- `pnpm lint`：通过。
- `pnpm typecheck`：通过。
- `pnpm test`：237 通过、10 个账户/Live 条件跳过。
- `pnpm build`：通过，Next.js 16.2.12。
- `pnpm test:e2e`：67 通过、18 个账户 Live 跳过、0 失败。
- `pnpm test:e2e:compose`：最终镜像 25/25。

专项：浏览器矩阵 12 通过/8 能力跳过、touch 5/5、a11y 3/3、security 3/3、failure 9/9、visual 7/7、license 2/2。性能短测最终为 21 runtime/53 block、47 次预览 P95 23.3ms、114 个 pointer frame P95 16.8ms、>50ms long task 0、松手权威写入 1 次。

默认 E2E 跳过账户相关 Live 场景，不能把跳过冒充重新验收 Live。任何后续实现修改后，至少重跑：

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

## 6. 外部阻塞

不得由代理或机器替代：

- 具体比赛官方规则、评分表、时限、联网/外部服务与提交格式。
- 5 名陌生听众、12 名目标学生、24–72 小时保持和真人解释盲评。
- CSS/教学专家、真人读屏/真实设备与真实噪声麦克风矩阵。
- 外部法律、隐私、商标和比赛展示权书面意见。
- 正式 Git 来源、干净 checkout/CI、公共部署凭据。
- 第二机器/网络、投影、热点、耳麦、三次陌生演示者盲演。
- 独立 go/no-go 审查。

因此 24 项保持 `BLOCKED`。不得虚构联系人、参与者、专家意见、规则、许可证或回执。

## 7. 下一步顺序

1. 本地可执行的目标 094 已收口；不要恢复 30 分钟浸泡。剩余 24 项需要官方规则、真人、专家、法律、Git/外部设备或独立审查输入。
2. 取得官方比赛资料后，按 `docs/SUBMISSION_AND_VIDEO_DEMO_PLAN.md` 先生成官方约束卡、评分映射、提交清单、定时脚本、无声分镜和三套彩排记录。
3. 在这些材料被人工评审前，不开始视频录制/剪辑，不上传、不最终提交。
4. 任何最终对外文案必须逐句经过 `docs/CLAIM_MATRIX.md` 与 `docs/CLAIM_BOUNDARIES.md`。

状态面板由 `pnpm status:generate` 生成；不要手改生成的 dashboard/JSON。
