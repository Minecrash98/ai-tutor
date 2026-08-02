# AI Tutor 研究预注册草案 v1

状态：DRAFT_NOT_EXTERNALLY_REGISTERED

这是一份收数前工具包，不是已经完成的外部预注册、伦理批准、真人研究或学习效果证据。没有外部注册 ID、冻结时间和负责人签字前，任何结果都不得称为预注册结果。

首要对象是第一次系统学习 CSS 盒模型、Flex 或定位的中文学习者；首要任务是在无说明员条件下完成预测、真实操作、因果解释和非同构迁移。12 人形成性 pilot 只用于可用性与方向性信号。确认性比较研究的条件、样本量和停止规则必须在招募前另行冻结。

主分析保留所有启动任务者。除延迟未回应外，启动后的缺失按未通过进入主分析并单列缺失数。延迟未回应同时报告 observed、best-case 和 worst-case，不得静默删除。二元结果报告原始分子/分母和 Wilson 95% 区间；时间结果保留原始值并报告中位数与四分位数；解释由至少两名真人盲评，LLM 不能单独判定。

单次即时迁移只称“课内达成”。只有至少两项非同构迁移且 24–72 小时延迟保持通过，才允许使用“掌握”。pilot、机器测试、合成数据和子代理审查均不能替代真人研究。

机器可验证文件：

- research/preregistration.json
- research/instruments/frozen-item-manifest.json
- research/instruments/session-observation.json
- scripts/validate-prereg.mjs
- scripts/research-analysis-lib.mjs
- scripts/analyze-learning-study.mjs
- scripts/power-study.mjs

外部仍需：研究负责人、招募与同意流程、伦理/政策适用性、外部注册时间戳、真实参与者、盲评者和冻结后的实际数据。
