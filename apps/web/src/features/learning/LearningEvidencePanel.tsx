"use client";

import {
  createLearningEvidenceAnalysisResponseSchema,
  learningEvidenceAnalysisListResponseSchema,
  learningReplayBundleSchema,
  type LearningEvidenceAnalysis,
  type LearningReplayBundle,
} from "@ai-tutor/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { buildLearningEvidenceTrace } from "./evidence-trace";
import {
  isLearningAuditEvent,
  learningAuditEventLabel,
} from "./learning-audit-timeline";

const MILESTONE_LABELS = {
  prediction: "先做预测",
  observation: "亲手观察",
  explanation: "说清原因",
  transfer: "独立挑战",
} as const;

const ANSWER_LABELS: Readonly<Record<string, string>> = {
  grows: "会变大",
  same: "保持不变",
  unsure: "还不确定",
  "content-plus-padding": "内容宽度之外还会加上内侧空隙",
  "margin-pushes": "外边距把卡片撑大",
  "font-grows": "文字变大把卡片撑大",
  "gap-separates-items": "间距会分开项目",
  "gap-resizes-items": "间距会改变项目本身大小",
  "absolute-leaves-flow": "绝对定位会离开原来的排列",
  "relative-leaves-flow": "相对定位会离开原来的排列",
  "axes-are-independent": "主轴和交叉轴需要分开判断",
  "gap-changes-item-size": "间距会改变项目本身大小",
  "justify-is-cross-axis": "justify 控制交叉轴",
  "nearest-positioned-ancestor": "相对最近的定位祖先移动",
  "viewport-always": "总是相对浏览器窗口移动",
};

type StoredLearningStep = LearningReplayBundle["events"][number];

function learningStepSummary(record: StoredLearningStep): string {
  const event = record.event;
  if (isLearningAuditEvent(event)) return learningAuditEventLabel(event);
  switch (event.type) {
    case "predict":
    case "scenario-predict":
      return `提交预测：${ANSWER_LABELS[event.answer] ?? event.answer}`;
    case "experiment-saved":
    case "scenario-experiment-saved":
      return `保存变化：${event.property} 从 ${event.beforeValue ?? "未记录"} 改为 ${event.value}`;
    case "explain":
    case "scenario-explain":
      return `提交解释：${ANSWER_LABELS[event.answer] ?? event.answer}`;
    case "support":
    case "scenario-support":
      return event.action === "hint"
        ? `使用第 ${event.hintLevel ?? "?"} 级提示`
        : `记录学习支持：${event.action}`;
    case "transfer-submit":
    case "scenario-transfer-submit":
      return `运行独立挑战：${event.code.trim() || "空白提交"}`;
    case "start":
    case "scenario-start":
      return "开始本次课程";
    case "attach-transfer":
    case "scenario-attach-transfer":
      return "打开独立挑战";
  }
}

function learningStepTime(at: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "short",
    timeStyle: "medium",
    hour12: false,
  }).format(new Date(at));
}

function responseMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return fallback;
}

function stateLabel(
  state: LearningEvidenceAnalysis["result"]["milestones"][number]["learnerState"],
): string {
  switch (state) {
    case "no-evidence":
      return "没有记录";
    case "attempted":
      return "已经尝试，尚未达成";
    case "supported-demonstration":
      return "在帮助下完成";
    case "independent-demonstration":
      return "本次独立完成";
  }
}

export function LearningEvidencePanel({
  sessionId,
  onlineReady,
}: {
  readonly sessionId: string | null;
  readonly onlineReady: boolean;
}) {
  const [analyses, setAnalyses] = useState<readonly LearningEvidenceAnalysis[]>(
    [],
  );
  const [replay, setReplay] = useState<LearningReplayBundle | null>(null);
  const [loading, setLoading] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = useCallback(
    async (mode: "current" | "reanalysis") => {
      if (!sessionId) return null;
      const response = await fetch(
        `/api/learning/sessions/${sessionId}/analyses`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode }),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(responseMessage(payload, "学习证据暂时无法生成。"));
      }
      return createLearningEvidenceAnalysisResponseSchema.parse(payload)
        .analysis;
    },
    [sessionId],
  );

  const load = useCallback(async () => {
    if (!sessionId || !onlineReady) return;
    setLoading(true);
    setError(null);
    try {
      const [analysisResponse, replayResponse] = await Promise.all([
        fetch(`/api/learning/sessions/${sessionId}/analyses`, {
          cache: "no-store",
        }),
        fetch(`/api/learning/sessions/${sessionId}`, {
          cache: "no-store",
        }),
      ]);
      const [analysisPayload, replayPayload]: readonly unknown[] =
        await Promise.all([
          analysisResponse.json().catch(() => null),
          replayResponse.json().catch(() => null),
        ]);
      if (!analysisResponse.ok) {
        throw new Error(
          responseMessage(analysisPayload, "学习证据暂时无法读取。"),
        );
      }
      if (!replayResponse.ok) {
        throw new Error(
          responseMessage(replayPayload, "原始学习步骤暂时无法读取。"),
        );
      }
      const list =
        learningEvidenceAnalysisListResponseSchema.parse(analysisPayload);
      setReplay(learningReplayBundleSchema.parse(replayPayload));
      let next = list.analyses;
      if (
        list.currentThroughSequence > 0 &&
        !next.some(
          (analysis) =>
            analysis.sourceThroughSequence === list.currentThroughSequence,
        )
      ) {
        const current = await create("current");
        if (current) next = [current, ...next];
      }
      setAnalyses(next);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "学习证据暂时无法读取。",
      );
    } finally {
      setLoading(false);
    }
  }, [create, onlineReady, sessionId]);

  useEffect(() => {
    if (!onlineReady) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, onlineReady]);

  const latest = analyses[0];
  const trace = useMemo(() => {
    if (!latest || !replay) return { value: null, error: null };
    try {
      return {
        value: buildLearningEvidenceTrace(latest, replay),
        error: null,
      };
    } catch (traceError) {
      return {
        value: null,
        error:
          traceError instanceof Error
            ? traceError.message
            : "学习证据来源暂时无法核对。",
      };
    }
  }, [latest, replay]);
  const eventById = trace.value?.eventById ?? new Map();

  if (!sessionId) return null;

  const reanalyze = async () => {
    setReanalyzing(true);
    setError(null);
    try {
      const created = await create("reanalysis");
      if (created) setAnalyses((current) => [created, ...current]);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error
          ? analysisError.message
          : "学习证据暂时无法重新检查。",
      );
    } finally {
      setReanalyzing(false);
    }
  };

  return (
    <section className="learning-evidence-panel" aria-label="可追溯学习证据">
      <header>
        <span>学习证据</span>
        <strong>每一步都有来源，没有记录就明确留空</strong>
        <p>这里只展示本次课程的可观察表现，不生成“掌握百分比”。</p>
      </header>
      {!onlineReady ? (
        <p>当前步骤已保存在这台设备；连接恢复后会生成可追溯记录。</p>
      ) : null}
      {loading && !latest ? <p>正在整理本次学习步骤…</p> : null}
      {error ? (
        <div className="learning-evidence-panel__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      ) : null}
      {trace.error ? (
        <div className="learning-evidence-panel__error" role="alert">
          <span>{trace.error}</span>
          <button type="button" onClick={() => void load()}>
            重新核对
          </button>
        </div>
      ) : null}
      {latest && trace.value ? (
        <>
          <ol>
            {latest.result.milestones.map((milestone) => (
              <li
                key={milestone.milestoneId}
                data-evidence-status={milestone.status}
              >
                <div>
                  <strong>{MILESTONE_LABELS[milestone.milestoneId]}</strong>
                  <span>{stateLabel(milestone.learnerState)}</span>
                </div>
                <p>{milestone.observed}</p>
                <small>来自 {milestone.sourceEventIds.length} 条学生步骤</small>
                <details className="learning-evidence-panel__sources">
                  <summary>
                    查看 {milestone.sourceEventIds.length} 条原始步骤
                  </summary>
                  <p>完成条件：{milestone.criterion}</p>
                  {milestone.sourceEventIds.length > 0 ? (
                    <ol>
                      {milestone.sourceEventIds.map((eventId) => {
                        const record = eventById.get(eventId);
                        return (
                          <li key={eventId} data-learning-event-id={eventId}>
                            {record ? (
                              <>
                                <strong>
                                  第 {record.sequence} 步 ·{" "}
                                  {learningStepSummary(record)}
                                </strong>
                                <span>{learningStepTime(record.event.at)}</span>
                                <code>{record.event.eventId}</code>
                              </>
                            ) : (
                              <>
                                <strong>原始步骤暂时未找到</strong>
                                <code>{eventId}</code>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p>没有对应记录，因此这里不会把它算作完成。</p>
                  )}
                </details>
              </li>
            ))}
          </ol>
          {replay ? (
            <details
              className="learning-evidence-panel__timeline"
              data-learning-timeline-count={replay.events.length}
            >
              <summary>查看完整学习过程（{replay.events.length} 步）</summary>
              <p>
                这里按发生顺序保留课程操作、学习搭档交流和页面变化；没有保存的对话正文不会补写。
              </p>
              <ol>
                {replay.events.map((record) => (
                  <li
                    key={record.event.eventId}
                    data-learning-timeline-sequence={record.sequence}
                    data-learning-timeline-type={record.event.type}
                  >
                    <strong>
                      第 {record.sequence} 步 · {learningStepSummary(record)}
                    </strong>
                    <span>{learningStepTime(record.event.at)}</span>
                    <small>
                      记录编号 {record.event.eventId} · 格式 v
                      {record.event.eventVersion}
                    </small>
                  </li>
                ))}
              </ol>
            </details>
          ) : null}
          <p className="learning-evidence-panel__boundary">
            {latest.result.claimBoundary}
          </p>
          <a
            className="learning-evidence-panel__download"
            href={`/api/learning/sessions/${sessionId}/audit`}
            download={`learning-proof-audit-${sessionId}.json`}
          >
            导出完整学习证据包
          </a>
          <details>
            <summary>查看判定依据与版本</summary>
            <dl>
              <div>
                <dt>分析格式版本</dt>
                <dd>v{latest.result.analysisVersion}</dd>
              </div>
              <div>
                <dt>判定规则</dt>
                <dd>
                  {latest.result.rubric.id} v{latest.result.rubric.version}
                </dd>
              </div>
              <div>
                <dt>步骤回放检查</dt>
                <dd>
                  {latest.result.evaluator.id} v
                  {latest.result.evaluator.version}
                </dd>
              </div>
              <div>
                <dt>本次课程记录</dt>
                <dd>{latest.sessionId}</dd>
              </div>
              <div>
                <dt>检查到第几步</dt>
                <dd>{latest.sourceThroughSequence}</dd>
              </div>
              <div>
                <dt>步骤格式版本</dt>
                <dd>v{latest.result.sourceEventSchemaVersion}</dd>
              </div>
              <div>
                <dt>结果校验码</dt>
                <dd>{latest.resultHash}</dd>
              </div>
              <div>
                <dt>AI 评分</dt>
                <dd>未使用；结果来自固定规则</dd>
              </div>
              <div>
                <dt>保留的历史快照</dt>
                <dd>{analyses.length} 份</dd>
              </div>
            </dl>
            <button
              type="button"
              disabled={reanalyzing}
              onClick={() => void reanalyze()}
            >
              {reanalyzing
                ? "正在重新检查…"
                : "按同一规则重新检查（保留旧结果）"}
            </button>
          </details>
        </>
      ) : null}
    </section>
  );
}
