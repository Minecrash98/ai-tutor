# AI Tutor 提交与视频 Demo 流程（候选包已生成）

状态：`ENGLISH_CANDIDATE_READY / PUBLICATION_PENDING`
更新：2026-08-03
边界：用户已授权制作英文投稿候选并明确要求最终视频包含英文旁白和学生—AI Tutor 互动。现已生成本地视频、旁白、字幕、封面和投稿文本；未购买任何内容。公共 GitHub 已验证，YouTube 上传和最终表单回执仍必须以真实外部 URL 和页面状态为准，不能用本地文件代替。

## 0. 2026-08-03 execution result

- Primary local video: `output/playwright/css-global-color-variables-youtube-demo-en-v2-2026-08-03.mp4`
- Primary streams: exactly 300.000 seconds, 1280×720 at 25 fps, H.264 High video and AAC-LC English mono narration; an alternate VP8/Opus WebM is also retained.
- Capture boundary: a fresh isolated Playwright browser with fake media and `--mute-audio`; physical microphone calls remained 0.
- Interaction: a real authenticated text Tutor session is visible with two student turns and two Tutor responses; it is not a mocked transcript.
- Presentation: visible interface text is English at all five recorded checkpoints through a query-scoped presentation mode; complete product localization is not claimed.
- Narration: 801-word, approximately 170 WPM local Piper `en_US-lessac-high` voice, normalized to -16.3 LUFS integrated and -1.4 dBFS true peak.
- Captions: `docs/submission/captions/ai-tutor-css-variables-en-v2.srt` and `.vtt`.
- Cover: `docs/submission/assets/ai-tutor-cover.png`, 1600×900 and below 2 MB.
- Submission fields and verified 964-word write-up: `docs/submission/`.
- Integrity details: `docs/submission/DELIVERY_CHECKLIST.md`.
- This is an upload-ready local candidate, not a verified public YouTube URL or completed competition submission.

冻结执行顺序：

`官方规则原文 → 约束卡 → 评分项/证据映射 → 主张冻结 → 定时脚本/无声分镜 → 三套彩排 → 正式录制 → 剪辑/字幕/事实 QA → 上传彩排 → 双人终检 → 负责人最终提交`

当前 v2 是可上传的本地视频候选，公开 GitHub 也已建立。未取得真实 YouTube URL、
官方完整规则和必要人工门禁前，不把本地文件冒充已完成的比赛提交。

## 1. 开始执行前必须拿到的输入

先建立一张“官方约束卡”，原文保存，不凭记忆转述：

- 比赛名称、官方规则 URL/PDF、赛道与评分表版本。
- 截止时间和时区、视频最长时长/大小/分辨率/编码、语言和字幕要求。
- 提交字段、附件格式、团队/学校/公司资格、AI 使用披露、联网和外部服务限制。
- 代码、数据、隐私、商标、第三方许可证、公开链接和匿名评审要求。
- 是否允许替换文件、是否有预览/草稿、最终提交后的回执形式。

规则未到位时，只能准备“候选包”，不能把本文的时长、字段或主张当成官方要求。

## 2. 两条并行但独立的产线

### A. 提交包产线

1. **冻结候选版本**：记录 source fingerprint、lockfile、三镜像摘要、SBOM、扫描报告和测试时间；不以无 `.git` 的目录冒充 commit。
2. **逐项映射评分表**：每个评分项只链接一种可核查证据；机器、真人、专家、法律与假设分列。
3. **建立提交清单**：表单答案、项目简介、技术说明、隐私/AI 披露、仓库或运行包、视频、字幕、封面、许可证材料、证据索引。
4. **生成主包与离线备包**：主包展示完整产品；备包保证无网络、无 Codex 登录、拒麦时仍能跑确定性三课。
5. **清洁环境复现**：从公开 `main` 的正式 Git checkout 安装、构建、启动、健康检查并完成核心浏览器路径；记录失败样本。
6. **声明审查**：逐句对照 `docs/CLAIM_MATRIX.md` 和 `docs/CLAIM_BOUNDARIES.md`，删除“掌握、提高学习效果、全部合规、低于 2.5 秒”等无对应证据的外推。
7. **人工门禁**：法律/许可、专家、真人数据、读屏/设备、三次盲演和独立 go/no-go 必须由对应真人签字，机器不得代签。
8. **上传彩排**：使用草稿或测试入口核对文件名、大小、转码、字幕、链接权限和时区；不按下最终提交。
9. **双人终检**：一人逐字段读回，一人对照官方规则；下载或截图预览页。
10. **最终提交**：只有负责人明确执行时才提交；保存时间戳、回执、最终文件 SHA-256 和页面截图，禁止截止前无记录替换。

### B. 视频 Demo 产线

1. **锁定目标与时长**：官方限制优先；在规则未知时只保留候选结构：主片 2–3 分钟、60–90 秒短备份，不提前拍摄。
2. **写证据化脚本**：每 10–15 秒写清旁白、学生动作、预期画面、证据点、禁语和失败备选；旁白不承担产品自己应显示的信息。
3. **做无声纸面分镜**：先确认只看画面也能理解“学生先预测—亲手操作—解释—陌生迁移—证据回放”。
4. **冻结演示数据**：只用无个人信息的专用页面与隔离学习会话；禁止使用 Chrome 历史画布、真实学生记录或未获授权的素材。
5. **冻结录制环境**：正式候选版本、固定视口/缩放/字体、通知关闭、干净桌面；语音协议验收仍只用假麦克风和 `--mute-audio`。若成片需要真人旁白，另行录制旁白，不调用物理麦克风做产品测试。
6. **先录主路径，再录失败恢复**：每段独立录制，保留失败 take；不靠剪辑伪造一次成功会话，也不把离线模式剪成 Live AI。
7. **画面粗剪**：删除等待但保留因果顺序；加放大、光标和极少量标注，不遮住证据来源、状态或水印。
8. **旁白与字幕**：最后按定稿画面录旁白；制作人工校对的 SRT/VTT 和烧录字幕，术语、数字、时序与画面一致。
9. **事实与可访问性 QA**：逐帧核查敏感信息、闪烁、字号、对比度、字幕停留、音量和左右声道；所有数值回到冻结证据。
10. **转码与回放 QA**：按官方编码导出；在至少两台机器、第二网络和无声环境完整播放，校验时长、文件大小、SHA-256、首尾帧和音画同步。

## 3. 推荐的视频叙事

这不是“AI 帮学生把页面做好”，而是“系统能证明学生完成了一次可追溯的课内学习闭环”。候选镜头顺序：

| 段落 | 画面与动作 | 必须证明 | 禁止外推 |
|---|---|---|---|
| 0. 问题 | 一句学生困惑 + 卡片页面 | CSS 规则抽象、调值不等于会迁移 | 不引用虚构用户或市场数字 |
| 1. 进入 | 全新隔离画布，一次点击第一课 | 不登录、不上传、不授权麦克风也能开始 | 不称真人 45 秒门槛已达成 |
| 2. 预测 | 学生先选预测/不知道 | AI 没有先泄漏答案 | 不称这是能力诊断的医学/心理结论 |
| 3. 操作 | 学生拖动并看到公式、尺寸与目标变化 | 学生亲手行动，页面事实同步 | 不把 preview 算作已保存版本 |
| 4. 修正 | 错误解释触发一级提示，学生自我修正 | 支架来自真实事件与规则 | 不称 AI 已证明长期个性化增益 |
| 5. 迁移 | 在结构不同页面亲手补一条 CSS | 不是换皮复现，且答案未自动复制 | 单次通过只叫“课内达成” |
| 6. 回放 | 展开事件 UUID、revision、规则和 rubric | 数字可追溯，失败/缺失也保留 | 不称机器回放等于教育效果 |
| 7. 恢复 | 断网/拒麦后切到明确的演示模式 | 核心课不依赖 Live AI | 不把演示模式剪成 Live AI |
| 8. 收束 | 三主题入口 + 当前边界 | 产品差异和下一步研究计划 | 不称符合未知官方规则或已公开部署 |

## 4. 资产与文件结构

正式执行时使用独立目录，不污染运行源码：

```text
submission/<competition>/<candidate-id>/
  official/          # 原始规则、评分表、截止时间截图
  forms/             # 每个表单字段的定稿文本
  package/           # 最终允许提交的源码/运行包
  evidence-index/    # 评分项到证据的映射，不放个人信息
  video/
    script/          # 旁白、分镜、镜头表、禁语
    raw/             # 只读原始 take
    project/         # 剪辑工程
    captions/        # SRT/VTT 与校对记录
    exports/         # 候选成片与校验和
  receipts/          # 上传预览、最终回执、SHA-256
```

推荐命名：`ai-tutor_<competition>_<deliverable>_<lang>_<version>_<YYYYMMDD>.<ext>`。每次导出都是新版本，不覆盖已审核文件。

## 5. 冻结与回退规则

- `T-14`：规则、评分映射、故事线和功能范围冻结；规则日期未知时只表示相对顺序。
- `T-10`：代码候选与证据索引冻结，完成清洁 checkout 复现。
- `T-7`：脚本/分镜冻结，三次盲演后才允许正式录制。
- `T-5`：画面粗剪冻结，开始字幕、事实和可访问性 QA。
- `T-3`：最终候选导出、跨设备回放和上传彩排。
- `T-1`：只修阻断问题；不加功能，不静默换证据。
- 截止日前：负责人执行最终提交并保存回执。

任一主路径故障时，优先切换已标注的确定性备份；不得用剪辑、假日志、替换字幕或预录点击掩盖失败。若官方规则、许可或数据权利不清楚，移除对应素材/主张，而不是猜测许可。

## 6. 正式开始制作时的第一批产物

在收到官方规则后，先只产出并评审以下六件东西，再开始录制：

1. 官方约束卡。
2. 评分项—证据映射。
3. 一页提交清单与责任人。
4. 定时到秒的脚本。
5. 无声分镜和镜头表。
6. 主路径/离线备份/失败恢复三套彩排记录。

Current execution produced and verified the English interactive local candidate.
The GitHub URL is public and verified. The remaining link field is a real
public or unlisted YouTube URL; external human, legal, official-rule, device,
network, and final-receipt evidence remains explicitly incomplete.
