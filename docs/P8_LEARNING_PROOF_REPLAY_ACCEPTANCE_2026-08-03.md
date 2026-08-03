# P8 Learning Proof Replay 机器验收

日期：2026-08-03
结论：目标 094 的本地实现与机器验收通过；该结论不代表真人学习效果、评委认可或独立 go/no-go。

## 1. 验收范围

- Learning Proof 新增版本化通用审计事件：Tutor 会话状态、最终文字/语音消息、工具结果、事实 receipt 和学生/AI 画布保存动作。
- 审计事件与盒模型、Flex、定位课程事件共用严格序号、事件 UUID、时间、payload hash、owner、幂等、浏览器 outbox 和 PostgreSQL 权威存储。
- 通用审计事件不改变课程 reducer；课程最终状态仍由冻结课程事件决定，完整时间线长度与权威快照序号一致。
- 盒模型与场景回放均可拖动、前后步进、自动播放，并在同一时间线显示课程事件、Tutor、事实和画布动作。
- 未勾选“保存本次对话和操作”时，只保存角色、模式、字数和时间等元数据，正文为 `null`；回放明确显示“正文未保存”，不会补写内容。
- 事实 receipt 保留允许状态、目标、前后值、规则来源/值与不确定原因；学生界面只显示可理解的“页面事实”说明。

## 2. 实际验证结果

| 验证 | 结果 |
|---|---|
| `pnpm lint` | 通过 |
| `pnpm typecheck` | 6 个工作区项目通过 |
| `pnpm test` | 239 项通过，10 项按账户/Live 条件跳过 |
| PostgreSQL Learning Proof 定向集成测试 | 10/10 通过；审计事件权威持久化，课程 reducer 不被通用事件改变 |
| 统一文字回放隔离浏览器测试 | 1/1 通过；消息、工具、事实、画布动作与最终状态同线回放，物理麦克风调用 0 |
| 合成语音审计隔离浏览器测试 | 1/1 通过；使用内存合成音轨和 `--mute-audio`，未访问物理麦克风 |
| `pnpm build` | Next.js 16.2.12 生产构建通过 |
| `pnpm test:e2e` | Chromium 67 项通过，18 项账户相关 Live 场景跳过，0 失败 |
| `pnpm test:e2e:compose` | 无缓存重建候选 25/25 通过，包含真实 PostgreSQL 统一回放 |
| 目视检查 | `evidence/P8_LEARNING_PROOF_REPLAY_2026-08-03.png`；1280×720 回放弹窗无遮挡，文案为学生可理解中文 |

定向语音测试只验证合成轨道下的事件接线与隐私行为，不冒充真人听感。所有浏览器测试使用新隔离 context，不读取或修改 Chrome 历史画布。

## 3. 发布候选绑定

- release manifest：`evidence/P8_RELEASE_MANIFEST_2026-08-02T18-39-13-438Z.json`
- manifest SHA-256：`ad715ffee3a1f234c85caa33126428b9d653e99f98e23a818b65c43bf2a5da5e`
- release-input SHA-256：`9ee0ada4aae360b309b5373d3c2cfc93c4312ef638b160a88b332dbc1a1f7f06`（261 个发布输入文件）
- Web 镜像：`sha256:cf1f0e332a34a4c98433fbfe4f6c376ee928220ae1fafe344a887bfc3eeaa6f6`
- migration 镜像：`sha256:247f3039005d5de2f12deda3b76fae552946b10be3a252c9f1204758ca17403a`
- PostgreSQL 镜像：`sha256:8189a1f6e40904781fc9e2612687877791d21679866db58b1de996b31fc312e4`

`pnpm release:manifest` 独立生成上述清单，没有运行或暗示 30 分钟浸泡。当前目录仍无 `.git`，所以清单不是 commit、干净 checkout 或 CI 来源证明。

## 4. 保留边界

- 目标 094 可标为 `VERIFIED`，最终硬标准 7 的本地机器部分可标为 `VERIFIED`。
- 目标 083 继续为 `IN_PROGRESS`；用户明确取消重跑 30 分钟浸泡，本轮没有执行。
- 官方规则、真人学生、专家、法律、异机现场、正式 Git 来源和独立审查仍未取得；整体裁决保持 `NO_GO`。
