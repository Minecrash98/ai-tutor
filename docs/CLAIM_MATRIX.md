# AI Tutor 对外主张矩阵

更新日期：2026-08-02
状态：候选矩阵；官方比赛评分项尚未提供，因此“评分映射”列保持阻塞。

| 候选说法 | 当前证据 | 允许的表述 | 禁止外推 | 官方评分映射 |
|---|---|---|---|---|
| 不登录、不上传、不授权麦克风也能开始第一课 | `tests/e2e/foundation.spec.ts`、`tests/e2e/p8-scenarios.spec.ts` | 一次点击进入确定性盒模型课 | 不等于 12 名新用户都能在 45 秒内完成首次拖动 | BLOCKED：未提供评分表 |
| 三个 CSS 主题都要求预测、操作、解释和迁移 | `packages/curriculum`、`tests/e2e/p8-learning-scenarios.spec.ts`、`tests/e2e/p8-scenarios.spec.ts` | 盒模型、Flex、定位均有机器验证的完整课内流程 | 不称长期掌握或教育效果 | BLOCKED |
| 学生会亲手写 CSS | `tests/e2e/foundation.spec.ts`、`tests/e2e/source-editor.spec.ts` | 迁移题和源码编辑路径验证真实输入、运行、保存与恢复 | 不把 AI 自动生成代码算作学生独立完成 | BLOCKED |
| 导入页面只在事实足够时生成个性化小课 | `tests/e2e/personalized-course.spec.ts`、`personalized-course.test.ts` | 题目可回到文件、行、selector、声明、CSSOM、几何和不可变 revision | 不称通用网页理解；无稳定规则时系统拒绝猜测 | BLOCKED |
| 上传的 JavaScript 不执行 | `packages/runtime-static-html` 测试、`tests/e2e/p8-security.spec.ts` | 当前静态 HTML/CSS 在 sandbox iframe 中执行，危险脚本/导航被移除或阻止 | 不声称支持任意 JavaScript、React 或完整网站 | BLOCKED |
| Learning Proof 可跨刷新统一回放 | `P7_MACHINE_ACCEPTANCE_2026-08-02.md`、`docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md`、`tests/e2e/learning-proof.spec.ts`、`p8-learning-scenarios.spec.ts` | 三课预测、操作、提示、解释、迁移和失败，以及 Tutor 文字/合成语音、工具、事实和画布保存动作可追溯；旧结果不被静默改写，隐私关闭时正文不保存 | 不把机器回放当真人学习成效或逐字保存所有 provider 内部上下文 | BLOCKED |
| 拒麦、断网或 AI 不可用仍可继续 | `realtime-boundary.spec.ts`、`p8-failure-matrix.spec.ts`、`p8-scenarios.spec.ts` | 文字与确定性路径不需要物理麦克风，故障时明确显示演示模式 | 不声称所有网络、账号和音频设备均已真人验证 | BLOCKED |
| 关键 AI 因果讲解有运行时事实门禁 | `use-realtime-tutor.test.ts`、`tests/e2e/p8-grounding-tools.spec.ts` | 当前回合只有取得 target、前后值、规则和 revision 的允许 receipt 才能说因果结论；否则改为不确定说明 | receipt 未作为独立数据库字段持久化；不称所有历史语音逐字可审计 | BLOCKED |
| 当前候选达到冻结的本机压力预算 | `tests/e2e/p8-performance.spec.ts`、`evidence/P8_PERFORMANCE_2026-08-02.json` | 21 runtime / 53 block、47 次预览和 114 个 pointer frame 在本机通过短时冻结预算 | 不外推到未测试设备；当前没有合格 30 分钟 soak，且不再重跑 | BLOCKED |
| 发布包有固定依赖、健康检查、备份恢复与 SBOM | `Dockerfile`、`compose.yaml`、`evidence/P8_RELEASE_MANIFEST_2026-08-02T18-39-13-438Z.json`、`P8_BACKUP_RESTORE_DRILL_2026-08-02.json` | loopback 本地候选可复现启动，最终 Compose 25/25，数据库健康与隔离恢复有机器证据 | 无 `.git` 来源；不声称已有公共部署、干净 checkout CI 或 soak | BLOCKED |
| 依赖许可材料可导出 | `THIRD_PARTY_NOTICES.md`、tldraw 许可证副本、源/镜像 SBOM | 版本、水印、notices 和依赖清单均被机器核对 | 工程清单不是比赛/商业展示权法律意见 | BLOCKED |

任何测试失败、镜像摘要变化或依赖更新都会使对应机器结论过期。真人、专家、法务和官方比赛材料必须作为新证据追加，不能覆盖机器边界。
