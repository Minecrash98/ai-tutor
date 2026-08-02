"use client";

import type {
  BoxModelLessonRecordedEvent,
  LearningLessonRecordedEvent,
  LearningSupportAction,
} from "@ai-tutor/contracts";
import {
  BOX_MODEL_COURSE,
  buildEntryDiagnostic,
  chooseNextTask,
} from "@ai-tutor/curriculum";
import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
  type Ref,
} from "react";

import { LearningProofReplay } from "../learning/LearningProofReplay";
import { LearningProgressReceipt } from "../learning/LearningProgressReceipt";
import {
  deriveLearnerMisconceptionEvidence,
  strongestMisconceptionState,
} from "../learning/learning-misconception-evidence";
import type { LearningProofSyncStatus } from "../learning/use-learning-proof";
import {
  boxModelWidthBreakdown,
  evaluateTransferDeclaration,
  lessonElapsedSeconds,
  type BoxModelExplanation,
  type BoxModelLessonState,
  type BoxModelPrediction,
} from "./box-model-lesson";

interface BoxModelLessonPanelProps {
  readonly state: BoxModelLessonState;
  readonly widthFormula: ReactNode;
  readonly ready: boolean;
  readonly onStart: () => Promise<void>;
  readonly onRestart: () => Promise<void>;
  readonly onPredict: (answer: BoxModelPrediction) => void;
  readonly onExplain: (answer: BoxModelExplanation) => Promise<void>;
  readonly onSupport: (
    action: LearningSupportAction,
    hintLevel?: 1 | 2 | 3 | null,
  ) => Promise<void>;
  readonly onSubmitTransfer: (code: string) => Promise<boolean>;
  readonly onFocusLesson: () => void;
  readonly events: readonly BoxModelLessonRecordedEvent[];
  readonly timelineEvents: readonly LearningLessonRecordedEvent[];
  readonly authoritativeSnapshot: {
    readonly throughSequence: number;
    readonly lessonState: BoxModelLessonState;
  } | null;
  readonly syncStatus: LearningProofSyncStatus;
  readonly onRetrySync: () => void;
  readonly onDownload: () => void;
  readonly hiddenTransferOutcome: "passed" | "failed" | null;
}

export function BoxModelWidthFormula({
  paddingPx,
  outputRef,
}: {
  readonly paddingPx: number | null;
  readonly outputRef?: Ref<HTMLOutputElement>;
}) {
  if (paddingPx === null) return null;
  const widthBreakdown = boxModelWidthBreakdown(paddingPx);
  return (
    <output
      ref={outputRef}
      className="box-lesson__formula"
      aria-label="当前卡片总宽计算"
      data-padding-px={paddingPx}
      data-total-width-px={widthBreakdown.totalPx}
    >
      <small>滑块一动，这里也会跟着算</small>
      <strong>总宽 {widthBreakdown.totalPx}px</strong>
      <span>
        内容 {widthBreakdown.contentPx}px + 左右留白{" "}
        {widthBreakdown.horizontalPaddingPx}px + 边框 {widthBreakdown.borderPx}px
      </span>
    </output>
  );
}

const PHASE_LABELS: Readonly<Record<BoxModelLessonState["phase"], string>> = {
  idle: "还没开始",
  predict: "先猜一猜",
  observe: "亲手试一试",
  explain: "说清为什么",
  transfer: "去新页面挑战",
  complete: "本节已完成",
};

const SAVE_LABELS: Readonly<Record<LearningProofSyncStatus, string>> = {
  idle: "还没有学习记录",
  local: "已保存在这台设备",
  syncing: "正在保存学习记录",
  synced: "学习记录已保存",
  recovering: "正在恢复上次进度",
  corrupted: "上次记录无法恢复",
};

const SUPPORT_STATUS: Readonly<Record<LearningSupportAction, string>> = {
  hint: "提示已展开，并记入这次学习记录。",
  skip: "这一步已跳过；你可以继续，但本轮只记为有支架完成。",
  demonstration: "示范已展开；你仍可继续练习，但本轮不计独立达成。",
  timeout: "等了一会儿还没有操作。课程停在这里，没有替你作答。",
  "teacher-takeover": "已标记需要老师接手；课程停在这里，没有自动代做。",
};

const DEMONSTRATION_TEXT: Readonly<Record<string, string>> = {
  predict: "示范：内容宽度不变时，左右 padding 都会加到卡片总宽里，所以总宽会变大。",
  observe: "示范：把 padding 调到 32px 并保存；280 + 32×2 + 4×2 = 352px。",
  explain: "示范：content-box 的 width 只量内容区，左右 padding 和 border 会另外加到总宽。",
  transfer: "示范：这张新卡片可以写 padding: 20px；请再运行一次确认页面结果。",
};

export function BoxModelLessonPanel({
  state,
  widthFormula,
  ready,
  onStart,
  onRestart,
  onPredict,
  onExplain,
  onSupport,
  onSubmitTransfer,
  onFocusLesson,
  events,
  timelineEvents,
  authoritativeSnapshot,
  syncStatus,
  onRetrySync,
  onDownload,
  hiddenTransferOutcome,
}: BoxModelLessonPanelProps) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("padding: ");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const activePhase = ["predict", "observe", "explain", "transfer"].includes(
    state.phase,
  )
    ? state.phase
    : null;
  const phaseSupport = activePhase
    ? state.supportHistory.filter((item) => item.phase === activePhase)
    : [];
  const hintCount = phaseSupport.filter((item) => item.action === "hint").length;
  const shownHint = hintCount > 0 ? BOX_MODEL_COURSE.hints[hintCount - 1] : null;
  const latestSupport = phaseSupport.at(-1) ?? null;
  const nextHintLevel =
    hintCount < 3 ? ((hintCount + 1) as 1 | 2 | 3) : null;
  const entryDiagnostic = state.prediction
    ? buildEntryDiagnostic({
        courseId: "box-model-v1",
        prediction:
          state.prediction === "unsure"
            ? "unsure"
            : state.predictionCorrect
              ? "correct"
              : "incorrect",
        hiddenTransferOutcome,
      })
    : null;
  const misconceptionEvidence = useMemo(
    () =>
      state.sessionId
        ? deriveLearnerMisconceptionEvidence({
            lessonKind: "box-model-v1",
            sessionId: state.sessionId,
            events,
          })
        : [],
    [events, state.sessionId],
  );
  const misconceptionState =
    strongestMisconceptionState(misconceptionEvidence);
  const repeatedMisconception = misconceptionEvidence.find(
    (item) => item.state === "repeated-pattern",
  );
  const correction = BOX_MODEL_COURSE.misconceptions.find(
    (item) => item.id === repeatedMisconception?.misconceptionId,
  );
  const adaptationSourceEventIds = [
    ...new Set(
      misconceptionEvidence.flatMap((item) => item.sourceEventIds),
    ),
  ];
  const nextTask = state.prediction
    ? chooseNextTask({
        courseId: "box-model-v1",
        latestOutcome:
          hiddenTransferOutcome ??
          (state.prediction === "unsure"
            ? "unsure"
            : state.predictionCorrect
              ? "passed"
              : "failed"),
        misconceptionState,
        hintLevel: Math.min(hintCount, 3) as 0 | 1 | 2 | 3,
        hiddenTransferDue:
          state.phase === "complete" && hiddenTransferOutcome === null,
      })
    : null;

  useEffect(() => {
    if (!activePhase) return;
    const timer = window.setTimeout(() => {
      void onSupport("timeout");
    }, 120_000);
    return () => window.clearTimeout(timer);
  }, [activePhase, onSupport, state.sessionId]);

  const run = async (task: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      className="box-lesson"
      aria-label="一分钟盒模型课"
      data-lesson-block-id={state.lessonBlockId ?? undefined}
    >
      <header className="box-lesson__header">
        <div>
          <span>推荐第一课</span>
          <h1>{BOX_MODEL_COURSE.title}</h1>
        </div>
        <em data-lesson-phase={state.phase}>{PHASE_LABELS[state.phase]}</em>
      </header>

      {state.phase !== "idle" ? (
        <div className="box-lesson__save-status" data-learning-save={syncStatus}>
          <span>{SAVE_LABELS[syncStatus]}</span>
          {syncStatus === "local" ? (
            <button type="button" className="is-secondary" onClick={onRetrySync}>
              再试一次
            </button>
          ) : null}
          <button
            type="button"
            className="is-secondary"
            disabled={busy}
            onClick={() => void run(onRestart)}
          >
            重新开始这节课
          </button>
        </div>
      ) : null}

      {entryDiagnostic ? (
        <aside
          className="entry-diagnostic"
          data-diagnostic-basis={entryDiagnostic.confidence}
          data-diagnostic-calibrated-by={entryDiagnostic.calibratedBy}
          data-next-task-variant={nextTask?.taskVariantId}
          data-adaptation-rule={nextTask?.ruleId}
          data-adaptation-reasons={nextTask?.reasonCodes.join(",")}
          data-adaptation-source-events={adaptationSourceEventIds.join(",")}
        >
          <strong>临时学习建议</strong>
          <span>
            {entryDiagnostic.confidence <= 0.35
              ? "目前依据很少"
              : entryDiagnostic.confidence <= 0.6
                ? "目前依据有限"
                : "目前依据较充分"}
            ：{entryDiagnostic.scaffold === "none" ? "可以直接继续操作" : "先核对一个页面事实会更稳"}。
          </span>
          <small>
            这只是根据当前操作形成的建议，不代表掌握程度；可跳过帮助，陌生页面挑战会重新调整建议。
          </small>
          {nextTask ? (
            <small>
              下一步：{nextTask.difficulty === "hidden-transfer"
                ? "完成已经解锁的陌生页面挑战"
                : nextTask.scaffold === "none"
                  ? "直接完成独立操作"
                : nextTask.scaffold === "fact-check"
                  ? "先核对页面中的一个真实数字，再继续操作"
                  : nextTask.scaffold === "worked-example"
                    ? "先跟着局部示范重做一次，再换新页面独立完成"
                    : "先完成一道针对当前困惑的修正题"}。
            </small>
          ) : null}
          {nextTask?.scaffold === "correction-question" && correction ? (
            <div
              className="entry-diagnostic__next-task"
              role="group"
              aria-label="针对当前困惑的修正题"
            >
              <strong>下一道修正题</strong>
              <p>{correction.correctionQuestion}</p>
              <small>
                这条建议来自你在{" "}
                {repeatedMisconception?.sourceEventIds.length ?? 0}{" "}
                个不同学习步骤中重复出现的同一判断；原步骤会保留在学习证据里。
              </small>
            </div>
          ) : null}
        </aside>
      ) : null}

      {state.phase !== "idle" ? (
        <LearningProgressReceipt
          steps={[
            {
              id: "prediction",
              label: "先做预测",
              complete: state.prediction !== null,
              evidence: state.predictionCorrect
                ? "预测与实际规则一致"
                : state.independentCreditEligible
                  ? "预测已保留，观察后可以修正"
                  : "这一步使用过跳过或示范，不计独立预测",
            },
            {
              id: "operation",
              label: "亲手操作",
              complete: state.observedPaddingPx === 32,
              evidence: state.independentCreditEligible
                ? "已把 padding 调到 32px并保存"
                : "已看到目标变化；本轮使用过支架",
            },
            {
              id: "explanation",
              label: "解释原因",
              complete: state.explanationCorrect === true,
              evidence: `经过 ${state.explanationAttempts} 次尝试说清了因果关系`,
            },
            {
              id: "transfer",
              label: "新页面挑战",
              complete: state.transferPassed === true,
              evidence: state.independentCreditEligible
                ? "在结构不同的新页面独立写出 CSS"
                : "新页面运行正确；本轮只记为有支架完成",
            },
          ]}
          events={events}
          evidence={state.evidence}
        />
      ) : null}

      {state.phase === "idle" ? (
        <div className="box-lesson__start">
          <p>不用上传，不用麦克风。先猜，再拖动，最后在新页面亲手写一行 CSS。</p>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => void run(onStart)}
          >
            {busy ? "正在准备…" : "开始一分钟盒模型课"}
          </button>
        </div>
      ) : null}

      {state.phase === "predict" ? (
        <fieldset className="box-lesson__question">
          <legend>如果内容宽度不变，把左右里面留白调大，卡片总宽会怎样？</legend>
          <button type="button" onClick={() => onPredict("grows")}>
            会变大
          </button>
          <button type="button" onClick={() => onPredict("same")}>
            保持不变
          </button>
          <button type="button" onClick={() => onPredict("unsure")}>
            我还不确定
          </button>
        </fieldset>
      ) : null}

      {state.phase === "observe" ? (
        <div className="box-lesson__step" aria-live="polite">
          <strong>
            {state.predictionCorrect
              ? "记住你的判断，现在用页面验证。"
              : "先不揭晓答案。内容区宽度没变；左右各多 16px，总宽一共会多多少？"}
          </strong>
          <p>在画布的“让里面更宽松”卡片里，把 padding 拖到 32px，并松手保存。</p>
          {widthFormula}
          {state.observedPaddingPx !== null && state.observedPaddingPx !== 32 ? (
            <small>刚才保存的是 {state.observedPaddingPx}px，还差一点点。</small>
          ) : null}
          <button type="button" className="is-secondary" onClick={onFocusLesson}>
            找到实验和滑块
          </button>
        </div>
      ) : null}

      {state.phase === "explain" ? (
        <fieldset className="box-lesson__question">
          <legend>刚才卡片为什么变宽了？</legend>
          {state.explanationCorrect === false ? (
            <p className="box-lesson__hint">
              这个解释还没有和页面里的宽度变化对上。可以再想一次，或展开下面的帮助。
            </p>
          ) : null}
          {state.explanationAttempts < 3 ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => onExplain("content-plus-padding"))
                }
              >
                width 只算内容区，左右 padding 另外加上
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("margin-pushes"))}
              >
                因为外边距把边框撑大了
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("font-grows"))}
              >
                因为文字自动变大了
              </button>
            </>
          ) : (
            <p role="status">
              已完成 3 次解释尝试。请展开下面的帮助，选择提示、示范、跳过或请老师接手。
            </p>
          )}
        </fieldset>
      ) : null}

      {state.phase === "transfer" ? (
        <form
          className="box-lesson__transfer"
          onSubmit={(event) => {
            event.preventDefault();
            setCodeError(null);
            void run(async () => {
              const passed = await onSubmitTransfer(code);
              if (!passed) {
                setCodeError(evaluateTransferDeclaration(code).message);
              }
            });
          }}
        >
          <strong>新页面挑战</strong>
          <p>提示卡的结构和上一张不同。请亲手补完一条 CSS，让里面留白变成 20px。</p>
          {state.transferBlockId ? (
            <label>
              <span>.notice &#123;</span>
              <input
                aria-label="补写 CSS 声明"
                value={code}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setCode(event.currentTarget.value)}
              />
              <span>&#125;</span>
            </label>
          ) : (
            <small>正在准备一张结构不同的新卡片…</small>
          )}
          <button
            type="submit"
            disabled={busy || !state.transferBlockId || !code.trim()}
          >
            {busy ? "正在检查…" : "运行我的 CSS"}
          </button>
          {codeError ? <small role="alert">{codeError}</small> : null}
        </form>
      ) : null}

      {activePhase ? (
        <details className="box-lesson__support">
          <summary>卡住了？可以这样继续</summary>
          {shownHint ? (
            <p className="box-lesson__hint" data-hint-level={shownHint.level}>
              第 {shownHint.level} 层提示：{shownHint.text}
            </p>
          ) : null}
          {latestSupport?.action === "demonstration" ? (
            <p className="box-lesson__hint" data-support-demonstration="true">
              {DEMONSTRATION_TEXT[activePhase]}
            </p>
          ) : null}
          {latestSupport ? (
            <p className="box-lesson__support-status" aria-live="polite">
              {SUPPORT_STATUS[latestSupport.action]}
            </p>
          ) : (
            <p>先要小提示；需要时再逐步增加帮助。</p>
          )}
          <div className="box-lesson__support-actions">
            {nextHintLevel ? (
              <button
                type="button"
                className="is-secondary"
                disabled={busy}
                onClick={() =>
                  void run(() => onSupport("hint", nextHintLevel))
                }
              >
                {nextHintLevel === 1
                  ? "给我一个小提示"
                  : `再看第 ${nextHintLevel} 层提示`}
              </button>
            ) : null}
            <button
              type="button"
              className="is-secondary"
              disabled={busy}
              onClick={() => void run(() => onSupport("skip"))}
            >
              跳过这一步
            </button>
            <button
              type="button"
              className="is-secondary"
              disabled={busy}
              onClick={() => void run(() => onSupport("demonstration"))}
            >
              直接看示范
            </button>
            <button
              type="button"
              className="is-secondary"
              disabled={busy}
              onClick={() => void run(() => onSupport("teacher-takeover"))}
            >
              请老师接手
            </button>
          </div>
          <small>第 3 层提示和直接示范会保留在记录里，本轮不计独立达成。</small>
        </details>
      ) : null}

      {state.phase === "complete" ? (
        <div className="box-lesson__receipt" aria-label="本次学习记录">
          <strong>
            {state.independentCreditEligible
              ? "这次不是只把数值调对"
              : "这次在帮助下完成了路线"}
          </strong>
          <p>
            {state.independentCreditEligible
              ? "你完成了预测、亲手观察、因果解释，并在结构不同的新页面写出了 CSS。"
              : "新页面已经运行正确；因为这轮使用过示范、跳过或老师接手，只记录为有支架完成，不记作独立达成。"}
          </p>
          <dl>
            <div>
              <dt>预测</dt>
              <dd>{state.predictionCorrect ? "判断正确" : "观察后修正"}</dd>
            </div>
            <div>
              <dt>操作</dt>
              <dd>padding 16px → 32px</dd>
            </div>
            <div>
              <dt>解释</dt>
              <dd>{state.explanationAttempts} 次完成</dd>
            </div>
            <div>
              <dt>新页面</dt>
              <dd>
                {state.independentCreditEligible
                  ? "独立运行正确"
                  : "有支架运行正确"}
              </dd>
            </div>
          </dl>
          <small>
            {lessonElapsedSeconds(state) !== null
              ? `本次用时 ${lessonElapsedSeconds(state)} 秒。这是当前一节课的达成记录，不代表长期掌握。`
              : "这是当前一节课的达成记录，不代表长期掌握。"}
          </small>
          <button type="button" className="is-secondary" onClick={onFocusLesson}>
            回看我的实验
          </button>
          <div className="box-lesson__record-actions">
            <button type="button" onClick={() => setReplayOpen(true)}>
              回放学习过程
            </button>
            <button type="button" className="is-secondary" onClick={onDownload}>
              导出我的记录
            </button>
          </div>
          <details className="lesson-evidence-details">
            <summary>查看这次记录为什么成立</summary>
            <ol>
              {state.evidence.map((item) => {
                const eventIndex = timelineEvents.findIndex(
                  (event) => event.eventId === item.eventId,
                );
                const sourceEvent =
                  eventIndex >= 0 ? timelineEvents[eventIndex] : null;
                return (
                  <li key={item.id} data-evidence-passed={item.passed}>
                    <strong>
                      {eventIndex >= 0 ? `第 ${eventIndex + 1} 步` : "缺少原始步骤"} · {item.kind}
                    </strong>
                    <span>{item.criterion}</span>
                    <small>{item.detail}</small>
                    <small>
                      过程记录 v{sourceEvent?.eventVersion ?? "?"} · 判定规则 {item.evaluatorId} · {item.observed}
                    </small>
                  </li>
                );
              })}
            </ol>
          </details>
        </div>
      ) : null}

      {replayOpen ? (
        <LearningProofReplay
          timelineEvents={timelineEvents}
          finalState={state}
          authoritativeSnapshot={authoritativeSnapshot}
          onClose={() => setReplayOpen(false)}
        />
      ) : null}
    </section>
  );
}
