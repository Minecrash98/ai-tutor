# AI Tutor 本地发布、备份与恢复手册

更新日期：2026-08-02

当前可复现发布目标是单机、loopback-only 的确定性课程与 PostgreSQL Learning Proof。它不是已经上线的公共互联网服务。购买被排除；公开域名、托管平台和外部凭据未提供，因此公共部署仍是外部阻塞。

## 1. 固定环境

- 发布与 CI 固定 Node.js：`24.18.0`；本地检查允许 `>=24.18.0 <26`
- pnpm：`10.12.3`
- Codex CLI/app-server 已验证兼容版本：`codex-cli 0.144.1`；版本漂移时预检会禁用 Live 主张并保留确定性课程
- Docker 基础镜像：以 `Dockerfile` 和 `compose.yaml` 为准
- 应用端口：仅 `127.0.0.1:3000`
- 依赖：必须使用 `pnpm install --frozen-lockfile`

复制 `.env.example` 为 `.env`，至少替换 `POSTGRES_PASSWORD`。默认口令只允许 loopback 本机验收，不得用于公网。

## 2. 发布前门禁

```text
pnpm install --frozen-lockfile
pnpm compliance:check
pnpm preflight
pnpm verify:competition
pnpm audit --prod --audit-level high
docker compose config
docker compose build --no-cache
```

`pnpm preflight` 会真实检查固定 Node/pnpm/lockfile、tldraw 许可材料、必需资产、证据/输出目录读写、3000 端口归属、Codex 登录、数据库与正在运行应用的 Realtime 能力。硬依赖失败返回 `NOT_READY`；只有可选 Live 能力不可用时返回 `READY_WITH_FALLBACK`，并明确要求使用确定性课程。它不会请求或探测物理麦克风。

本候选不再运行 30 分钟浸泡：用户已明确取消重跑，目标 083 保持
`IN_PROGRESS`。历史中途停止 JSON 不能称为正式 soak，release manifest 也只绑定
发布输入、镜像与 SBOM，不暗示 soak 通过。未来若用户另行恢复该门禁，只有
`qualification=true`、持续至少 1,800,000ms 且浏览器/容器预算全部通过的成对 JSON
才可使用“30 分钟浸泡通过”表述。

## 3. 启动与健康检查

```text
docker compose up -d --build
docker compose ps
docker compose exec -T web /nodejs/bin/node /app/scripts/container-health-check.mjs
pnpm sbom:images
pnpm release:manifest
```

打开 `http://127.0.0.1:3000`。`GET /api/health` 必须返回 HTTP 200、`status: ok`，且 `database.configured` 与 `database.ready` 都为 `true`。健康接口会真实执行 `SELECT 1`，不是只检查环境变量。

`pnpm release:manifest` 只绑定当前源码输入、锁文件、Compose 配置、运行容器和三镜像 SBOM；它不会启动或暗示 30 分钟浸泡。

Docker 版保证确定性三课程和 PostgreSQL 回放。Live Tutor 还依赖宿主机已安装并登录的 Codex app-server；容器中未提供宿主 OAuth 或物理麦克风。比赛现场若 Live 不可用，使用页面明确标注的“演示模式”，不得假装在线 AI 已连接。

## 4. 现场黄金路径

1. 在全新浏览器 context 打开首页。
2. 一键完成盒模型课程：预测、拖动、解释、新页面 CSS、Learning Proof 回放。
3. 从 Flex 或定位任选一课，完成三次真实保存、错误重试、迁移和回放。
4. 断网或拒绝麦克风时，确认确定性演示仍能完成且物理麦克风调用为 0。
5. 刷新页面，确认画布和课程记录恢复。

官方时限尚未提供，因此这只是候选脚本，不是已冻结的比赛脚本，也没有三次真人盲演证据。

## 5. 备份

先确认容器健康，然后创建 PostgreSQL custom-format 备份：

```text
$backupPath = Join-Path $env:TEMP "ai-tutor-backup.dump"
docker compose exec -T db pg_dump -U postgres -d ai_tutor -Fc -f /tmp/ai-tutor-backup.dump
docker compose cp db:/tmp/ai-tutor-backup.dump $backupPath
docker compose exec -T db rm /tmp/ai-tutor-backup.dump
```

以上命令按 PowerShell 编写，备份默认放在仓库外的系统临时目录；不要把学习记录备份放进源码目录或 Docker 构建上下文。

同时保存以下发布指纹：有 Git 时保存源码 commit；当前无 Git 时明确记录该缺口，并保存 release-input SHA-256、`pnpm-lock.yaml` SHA-256、SBOM SHA-256、Docker image ID、`docker compose config` 输出与验收 JSON。缺少这些指纹的备份不能证明对应哪次发布。

## 6. 恢复演练

恢复会覆盖目标数据库，必须先停止 Web 写入并另存当前备份：

```text
$backupPath = Join-Path $env:TEMP "ai-tutor-backup.dump"
docker compose stop web
docker compose cp $backupPath db:/tmp/ai-tutor-backup.dump
docker compose exec -T db pg_restore -U postgres -d ai_tutor --clean --if-exists /tmp/ai-tutor-backup.dump
docker compose exec -T db rm /tmp/ai-tutor-backup.dump
docker compose start web
docker compose exec -T web /nodejs/bin/node /app/scripts/container-health-check.mjs
```

恢复后必须用隔离浏览器完成一次课程、回放和刷新恢复。未经实际演练，不得把恢复步骤标为 VERIFIED。

## 7. 回滚与故障降级

- 应用回滚：切回已冻结 commit，按固定 lockfile 无缓存重建，再跑 preflight 和核心浏览器路径。
- 数据库回滚：只使用该 commit 声明兼容的迁移/备份；不可手工改写 Learning Proof 事件。
- 数据库不可用：浏览器 outbox 保留当前学习记录，健康状态变为 degraded；恢复后再同步。
- Realtime/Codex 不可用：切到确定性演示或文字路径，并明确显示连接状态。
- 麦克风被拒：不重复强求授权，继续文字/确定性课程。
- 浏览器存储损坏或超额：保留可下载救援数据，显示恢复动作，不静默清空。

## 8. 停止

```text
docker compose down
```

该命令保留命名 volume。删除 volume 会不可恢复地删除 PostgreSQL 数据，不属于普通停止流程。

## 9. 尚未由机器替代的验收

- 官方比赛规则与评分表
- 真人学生 pilot、读屏/设备人工验收、盲演
- CSS/教学专家与独立 go/no-go 审查
- 第二台机器、第二网络、投影、热点和耳麦
- 外部法律、隐私和比赛许可适用性结论

本机候选的完整数值、镜像指纹、扫描发现和未发生事项见 `docs/RESULTS_AND_LIMITATIONS_2026-08-02.md`。正式提交与视频只规划未执行，流程见 `docs/SUBMISSION_AND_VIDEO_DEMO_PLAN.md`。
