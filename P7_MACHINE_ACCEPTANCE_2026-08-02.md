# P7 最小范围机器验收

状态：`MACHINE_VERIFIED / USER_APPROVED_2026-08-02 / P7_COMPLETE`

验收日期：2026-08-02。

本文件只记录当前已授权 P7 最小范围的机器证据：版本化盒模型学习事件、当前设备
PostgreSQL 权威持久化、浏览器离线 outbox、确定性快照和 Learning Proof Replay。
用户于 2026-08-02 明确批准 P7，并统一授权 P8、部署、真人研究和后续阶段；购买
永久排除。该批准不证明真人学习效果，也不替代法务、比赛规则或独立审查证据。

## 验收环境与隔离

- 工作目录：仓库根目录。
- 数据库：临时专用 `postgres:16-alpine` 容器
  `ai-tutor-p7-postgres-019fbd7a`，只映射 `127.0.0.1:55432`；未触碰机器上已有的
  其他 PostgreSQL 容器。最终只读计数冻结后该 `--rm` 容器已停止并自动移除；
  无关 `gutan-postgres` 仍保持 healthy。
- 浏览器自动化：Playwright Chromium，每个测试使用隔离上下文。
- 人工浏览器走查：全新非持久化命名会话 `p7-manual-019fbd7a`；验收后关闭。
- 本批次不需要语音，未授予麦克风权限，也未访问物理麦克风；未读取或修改用户
  Chrome 历史画布。
- 该目录当前不是 Git 仓库，因此不能声称有 commit、CI 或干净 checkout 复现证据。

## 已实现的最小闭环

1. `packages/contracts/src/learning-proof.ts` 定义 schema v1 的会话、事件、证据、
   快照和 replay bundle。事件带 UUID、ISO 时间、actor、事件版本；实验事件带
   `blockId` 与不可变 `revisionId`；确定性证据带 evaluator、criterion、observed
   和 passed。
2. 盒模型 reducer 只接受同一 session 的合法阶段事件，生成由 `eventId` 派生的稳定
   证据 ID；同一事件序列重复回放得到相同学习状态。
3. PostgreSQL store 使用 owner 隔离、严格递增 sequence、client event ID、payload
   SHA-256 和事务；相同请求重试幂等，同 ID 异参或过期序号返回 409。
4. 快照同时保存画布 shape、P5 语义状态和盒模型学习状态。服务端重放不等于待保存
   状态时拒绝快照，不允许把不一致状态伪装成成功记录。
5. 浏览器 outbox 使用带校验和的 envelope，支持 v0→v1 迁移、损坏记录救援指针、
   配额错误、不在线未确认事件和权威事件合并。数据库暂时不可用时当前学习记录不被
   静默清空。
6. 盒模型课程将开始、预测、实验版本、每次解释、迁移块创建和每次迁移提交写入事件
   流。UI 显示本地保存/已同步/需重试状态，可导出 JSON。
7. Learning Proof Replay 支持拖动时间线、上一步、下一步和自动播放；错误预测、错误
   解释、后续自我修正、CSS 迁移和最终结果均可重建。走到结尾时必须显示回放结果与
   当前学习记录一致。

主要实现索引：

- `packages/contracts/src/learning-proof.ts`
- `apps/web/src/features/learning/learning-proof-local.ts`
- `apps/web/src/features/learning/use-learning-proof.ts`
- `apps/web/src/features/learning/LearningProofReplay.tsx`
- `apps/web/src/features/learning/server/learning-proof-store.ts`
- `apps/web/src/features/learning/server/learning-proof-route.ts`
- `apps/web/src/app/api/learning/sessions/`
- `apps/web/src/db/schema.ts`
- `apps/web/drizzle/0001_unique_abomination.sql`

## PostgreSQL 集成证据

显式设置专用测试数据库后运行：

```text
pnpm --filter @ai-tutor/web exec vitest run \
  src/features/learning/server/learning-proof-store.integration.test.ts \
  --pool=threads --maxWorkers=1
```

结果：1 个测试文件、2/2 通过。覆盖：

- 会话创建重试幂等。
- 严格事件顺序和相同 batch 重试。
- 同 event ID 异 payload 冲突。
- 过期 sequence 冲突。
- 不同 owner 不能读取。
- 快照 hash 为 64 位十六进制 SHA-256。
- 相同快照重试幂等。
- 快照与确定性重放不一致时返回 `LEARNING_SNAPSHOT_REPLAY_MISMATCH`。

最终测试库只读计数：

| 项目 | 结果 |
|---|---:|
| Drizzle migration rows | 2 |
| teaching sessions | 12 |
| session events | 51 |
| session snapshots | 12 |
| active / completed sessions | 5 / 7 |
| 单会话最大 event sequence | 7 |

这些记录来自重复的集成与 E2E 测试，是机器夹具，不是学生数据、用户研究或生产负载。

## 离线与损坏恢复证据

- `learning-proof-local.test.ts`：5/5 通过，覆盖校验和 round-trip、ack、损坏指针、
  v0 迁移、权威/未发送事件合并、配额异常时不改写内存状态。
- `learning-proof.spec.ts` 离线场景主动中断全部 `/api/learning/**` 请求；课程完成后
  本地仍保留 7 个事件且确认序号为 0，刷新后恢复 complete 状态并成功回放。
- 权威数据库场景确认 7 个严格有序事件、completed 会话、sequence 7 快照、JSON
  下载、刷新恢复和最终回放等值。

## 隔离真实浏览器走查

人工走查在全新非持久化 Chromium 会话中完成：

1. 开始盒模型课，先选择错误预测“保持不变”。
2. 把 padding 拖到 32px 并保存版本。
3. 先选择错误解释，再用一级提示后的正确解释完成自我修正。
4. 在结构不同的新页面先提交 `margin: 20px`，确认不会通过；再提交
   `padding: 20px` 完成课内迁移。
5. 打开回放，拖到第 2 步，再回到结尾；最终显示“回放走到的结果和当前学习记录
   一致”。
6. 刷新页面，课程仍为 complete，画布 5 个 shape、2 个实验版本和已保存状态恢复。

最终截图：
`output/playwright/p7-learning-proof-final-polished-2026-08-02.png`（221,303 bytes）。

浏览器 console error 为 0。仅观察到 3 条 tldraw `zh-cn` 缺失翻译 key warning；
它们不是本次 P7 数据或回放失败，但仍应在后续产品抛光阶段处理。

## 最终完整基线

2026-08-02 在最终源码和文档状态上运行：

- `pnpm lint`：通过。
- `pnpm typecheck`：5 个 workspace 项目通过。
- `pnpm test`：contracts 13/13、runtime-static-html 5/5、web 72/72 通过；
  web 的 2 个 PostgreSQL 条件测试在默认无数据库命令中诚实跳过，随后按上文显式
  数据库命令 2/2 通过。
- `pnpm build`：Next.js 16.2.11 生产构建通过；4 条 P7 learning API 动态路由列入
  构建产物。
- `pnpm test:e2e`（设置专用 `DATABASE_URL` 与 `AI_TUTOR_P7_DATABASE=1`）：
  23 个用例中 12 通过、11 个账号相关 Live 用例按开关跳过；P7 离线和 PostgreSQL
  两条路径均执行并通过。
- E2E 结束后 `127.0.0.1:3000` 无监听进程。
- 100 项状态账本校验为 100 行、100 个唯一 ID：VERIFIED 16、IN_PROGRESS 47、
  BLOCKED 37、NOT_STARTED 0。

## 尚未满足或需要新授权

- P7 已获用户批准；该批准不替代以下仍缺的外部证据。
- 当前只覆盖盒模型纵向课，不是 Flex、定位、语音时间点或任意画布操作的通用回放。
- 可恢复删除/回收站尚未实现；未加入不可逆硬删除接口。
- 当前本地 envelope 上限为 5 MiB；目标文件要求的 10 MB、多版本压力矩阵仍未通过。
- 没有账号、多设备同步、生产备份/保留/删除合规、部署或公网安全结论。
- 没有真人学生、真人听感、学习效果、比赛规则、许可、盲演或独立 go/no-go 证据。
- P8、部署、真人研究和后续阶段已授权；购买路径明确排除。
