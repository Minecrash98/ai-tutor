"use client";

import type {
  LearningSupportAction,
  LearningLessonRecordedEvent,
  ScenarioExplanation,
  ScenarioLessonKind,
  ScenarioLessonRecordedEvent,
  ScenarioLessonState,
  ScenarioPrediction,
} from "@ai-tutor/contracts";
import {
  COURSE_BY_ID,
  buildEntryDiagnostic,
  chooseNextTask,
} from "@ai-tutor/curriculum";
import { useEffect, useMemo, useState } from "react";

import { ScenarioLearningProofReplay } from "../learning/ScenarioLearningProofReplay";
import { LearningProgressReceipt } from "../learning/LearningProgressReceipt";
import {
  deriveLearnerMisconceptionEvidence,
  strongestMisconceptionState,
} from "../learning/learning-misconception-evidence";
import type { LearningProofSyncStatus } from "../learning/use-learning-proof";
import {
  scenarioLessonElapsedSeconds,
  scenarioObservationProgress,
} from "./scenario-lesson";

interface ScenarioLessonPanelProps {
  readonly state: ScenarioLessonState;
  readonly ready: boolean;
  readonly onStart: (kind: ScenarioLessonKind) => Promise<void>;
  readonly onPredict: (answer: ScenarioPrediction) => void;
  readonly onExplain: (answer: ScenarioExplanation) => Promise<void>;
  readonly onSupport: (
    action: LearningSupportAction,
    hintLevel?: 1 | 2 | 3 | null,
  ) => Promise<void>;
  readonly onSubmitTransfer: (code: string) => Promise<boolean>;
  readonly onFocusLesson: () => void;
  readonly events: readonly ScenarioLessonRecordedEvent[];
  readonly timelineEvents: readonly LearningLessonRecordedEvent[];
  readonly authoritativeSnapshot: {
    readonly throughSequence: number;
    readonly lessonState: ScenarioLessonState;
  } | null;
  readonly syncStatus: LearningProofSyncStatus;
  readonly onRetrySync: () => void;
  readonly onDownload: () => void;
  readonly hiddenTransferOutcome: "passed" | "failed" | null;
}

const PHASE_LABELS: Readonly<Record<ScenarioLessonState["phase"], string>> = {
  idle: "任选一节",
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

function initialTransferCode(kind: ScenarioLessonKind | null): string {
  return kind === "positioning-v1"
    ? "position: absolute; top: "
    : kind === "flex-v1"
      ? "display: flex; gap: "
      : "";
}

export function ScenarioLessonPanel({
  state,
  ready,
  onStart,
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
}: ScenarioLessonPanelProps) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState(() =>
    initialTransferCode(state.lessonKind),
  );
  const [codeError, setCodeError] = useState<string | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const isFlex = state.lessonKind === "flex-v1";
  const activeCourse = state.lessonKind ? COURSE_BY_ID[state.lessonKind] : null;
  const progress = scenarioObservationProgress(state);
  const activePhase = ["predict", "observe", "explain", "transfer"].includes(
    state.phase,
  )
    ? state.phase
    : null;
  const phaseSupport = activePhase
    ? state.supportHistory.filter((item) => item.phase === activePhase)
    : [];
  const hintCount = phaseSupport.filter((item) => item.action === "hint").length;
  const shownHint = hintCount > 0 ? activeCourse?.hints[hintCount - 1] : null;
  const latestSupport = phaseSupport.at(-1) ?? null;
  const nextHintLevel =
    hintCount < 3 ? ((hintCount + 1) as 1 | 2 | 3) : null;
  const entryDiagnostic = state.lessonKind && state.prediction
    ? buildEntryDiagnostic({
        courseId: state.lessonKind,
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
      state.lessonKind && state.sessionId
        ? deriveLearnerMisconceptionEvidence({
            lessonKind: state.lessonKind,
            sessionId: state.sessionId,
            events,
          })
        : [],
    [events, state.lessonKind, state.sessionId],
  );
  const misconceptionState =
    strongestMisconceptionState(misconceptionEvidence);
  const repeatedMisconception = misconceptionEvidence.find(
    (item) => item.state === "repeated-pattern",
  );
  const correction = activeCourse?.misconceptions.find(
    (item) => item.id === repeatedMisconception?.misconceptionId,
  );
  const adaptationSourceEventIds = [
    ...new Set(
      misconceptionEvidence.flatMap((item) => item.sourceEventIds),
    ),
  ];
  const nextTask = state.lessonKind && state.prediction
    ? chooseNextTask({
        courseId: state.lessonKind,
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
  const demonstrationText =
    activePhase === "predict"
      ? isFlex
        ? "示范：gap 只改变相邻项目之间的空隙，不会直接改变项目自身宽高。"
        : "示范：absolute 会离开普通队伍；relative 移动后仍保留原位置。"
      : activePhase === "observe"
        ? isFlex
          ? "示范：依次保存 gap 32px、justify-content center、align-items flex-end。"
          : "示范：分别保存 static top 40px、relative top 40px、absolute top 48px。"
        : activePhase === "explain"
          ? isFlex
            ? "示范：justify-content 管主轴，align-items 管交叉轴，gap 管项目间隔。"
            : "示范：absolute 从最近的已定位祖先开始量偏移，并离开普通文档流。"
          : isFlex
            ? "示范：display: flex; gap: 24px; justify-content: space-between; align-items: center;"
            : "示范：position: absolute; top: 16px; right: 16px;";

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
      className="box-lesson scenario-lesson"
      aria-label="Flex 与定位小课"
      data-scenario-kind={state.lessonKind ?? "idle"}
    >
      <header className="box-lesson__header">
        <div>
          <span>接下来挑战</span>
          <h1>
            {activeCourse?.title ?? "再选一节完整小课"}
          </h1>
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
                  ? "先核对页面中的一个真实位置或间距，再继续操作"
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
              complete: progress.total > 0 && progress.completed === progress.total,
              evidence: `已保存 ${progress.completed}/${progress.total} 个目标变化`,
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
        <div className="box-lesson__start scenario-lesson__choices">
          <p>两节都不需要麦克风。每节都要先判断、亲手保存三次，再去新页面挑战。</p>
          <button
            type="button"
            disabled={!ready || busy}
            onClick={() => void run(() => onStart("flex-v1"))}
          >
            开始 Flex 小课
          </button>
          <button
            type="button"
            className="is-secondary"
            disabled={!ready || busy}
            onClick={() => void run(() => onStart("positioning-v1"))}
          >
            开始定位小课
          </button>
        </div>
      ) : null}

      {state.phase === "predict" ? (
        <fieldset className="box-lesson__question">
          <legend>
            {isFlex
              ? "只把 gap 调大，方块自身会变大吗？"
              : "哪一种定位会让元素不再占据普通队伍里的位置？"}
          </legend>
          {isFlex ? (
            <>
              <button type="button" onClick={() => onPredict("gap-separates-items")}>
                方块不变，只把相邻间距拉开
              </button>
              <button type="button" onClick={() => onPredict("gap-resizes-items")}>
                每个方块都会跟着变大
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => onPredict("absolute-leaves-flow")}>
                absolute 会离开普通队伍
              </button>
              <button type="button" onClick={() => onPredict("relative-leaves-flow")}>
                relative 会离开普通队伍
              </button>
            </>
          )}
          <button type="button" onClick={() => onPredict("unsure")}>
            我还不确定
          </button>
        </fieldset>
      ) : null}

      {state.phase === "observe" ? (
        <div className="box-lesson__step" aria-live="polite">
          <strong>
            {state.predictionCorrect
              ? "记住你的判断，现在用三个真实保存来验证。"
              : "先保留刚才的判断；做完三个实验再回来解释。"}
          </strong>
          <p>
            {isFlex
              ? "在 Flex 分支依次保存 gap 32px、横向居中、底部对齐。"
              : "在 static、relative、absolute 三块依次保存 top 40px、40px、48px，比较谁保留原位置、谁离开队伍。"}
          </p>
          <small data-scenario-progress>
            已完成 {progress.completed} / {progress.total} 个目标保存
          </small>
          <button type="button" className="is-secondary" onClick={onFocusLesson}>
            找到实验和控制器
          </button>
        </div>
      ) : null}

      {state.phase === "explain" ? (
        <fieldset className="box-lesson__question">
          <legend>
            {isFlex
              ? "刚才横向居中和底部对齐为什么能分开控制？"
              : "absolute 的偏移是从哪里开始量的？"}
          </legend>
          {state.explanationCorrect === false ? (
            <p className="box-lesson__hint">
              这个解释还没有和页面变化对上。可以再想一次，或展开下面的帮助。
            </p>
          ) : null}
          {state.explanationAttempts >= 3 ? (
            <p role="status">
              已完成 3 次解释尝试。请展开下面的帮助，选择提示、示范、跳过或请老师接手。
            </p>
          ) : isFlex ? (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("axes-are-independent"))}
              >
                主轴和交叉轴分工，gap 只管项目间距
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("gap-changes-item-size"))}
              >
                gap 会改变每个方块的宽高
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("justify-is-cross-axis"))}
              >
                justify-content 只管交叉轴
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run(() => onExplain("nearest-positioned-ancestor"))
                }
              >
                从最近的已定位祖先开始量
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("viewport-always"))}
              >
                永远从浏览器左上角开始量
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => onExplain("relative-leaves-flow"))}
              >
                因为 relative 先离开普通队伍
              </button>
            </>
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
                setCodeError(
                  isFlex
                    ? "需要四条声明：flex、24px 间距、两端分开、垂直居中。"
                    : "需要三条声明：absolute、距上 16px、距右 16px。",
                );
              }
            });
          }}
        >
          <strong>新页面挑战</strong>
          <p>
            {isFlex
              ? "在结构不同的工具栏里写出四条声明：Flex、24px 间距、两端分开、垂直居中。"
              : "在结构不同的海报里，把角标绝对定位到距上和距右各 16px。"}
          </p>
          {state.transferBlockId ? (
            <label>
              <span>{isFlex ? ".toolbar {" : ".badge {"}</span>
              <input
                aria-label={isFlex ? "补写 Flex CSS 声明" : "补写定位 CSS 声明"}
                value={code}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setCode(event.currentTarget.value)}
              />
              <span>&#125;</span>
            </label>
          ) : (
            <small>正在准备一张结构不同的新页面…</small>
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
              {demonstrationText}
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
              ? "你完成了整条学习路线"
              : "这次在帮助下完成了路线"}
          </strong>
          <p>
            {state.independentCreditEligible
              ? "预测、三次真实保存、因果解释和新页面挑战都保留在这次记录里。"
              : "新页面已经运行正确；因为这轮使用过示范、跳过或老师接手，只记录为有支架完成，不记作独立达成。"}
          </p>
          <dl>
            <div>
              <dt>预测</dt>
              <dd>{state.predictionCorrect ? "判断正确" : "观察后修正"}</dd>
            </div>
            <div>
              <dt>操作</dt>
              <dd>{progress.completed} 个目标保存</dd>
            </div>
            <div>
              <dt>解释</dt>
              <dd>{state.explanationAttempts} 次完成</dd>
            </div>
            <div>
              <dt>新页面</dt>
              <dd>
                {state.independentCreditEligible
                  ? "独立写出 CSS"
                  : "有支架运行正确"}
              </dd>
            </div>
          </dl>
          <small>
            {scenarioLessonElapsedSeconds(state) !== null
              ? `本次用时 ${scenarioLessonElapsedSeconds(state)} 秒。这是当前一节课的达成记录，不代表长期掌握。`
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
          {state.lessonKind === "flex-v1" ? (
            <button
              type="button"
              data-next-lesson="positioning-v1"
              disabled={busy}
              onClick={() => void run(() => onStart("positioning-v1"))}
            >
              继续学习定位
            </button>
          ) : null}
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
        <ScenarioLearningProofReplay
          timelineEvents={timelineEvents}
          finalState={state}
          authoritativeSnapshot={authoritativeSnapshot}
          onClose={() => setReplayOpen(false)}
        />
      ) : null}
    </section>
  );
}
