"use client";

import type {
  BoxModelLessonRecordedEvent,
  BoxModelLessonState,
  LearningLessonRecordedEvent,
} from "@ai-tutor/contracts";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import {
  isCorrectTransferDeclaration,
  replayBoxModelLessonEvents,
} from "@/features/lesson/box-model-lesson";
import {
  isLearningAuditEvent,
  learningAuditEventLabel,
} from "./learning-audit-timeline";
import { useReplayDialogFocus } from "./use-replay-dialog-focus";

interface LearningProofReplayProps {
  readonly timelineEvents: readonly LearningLessonRecordedEvent[];
  readonly finalState: BoxModelLessonState;
  readonly authoritativeSnapshot: {
    readonly throughSequence: number;
    readonly lessonState: BoxModelLessonState;
  } | null;
  readonly onClose: () => void;
}

const PHASE_LABELS: Readonly<Record<BoxModelLessonState["phase"], string>> = {
  idle: "准备开始",
  predict: "先做预测",
  observe: "动手观察",
  explain: "解释原因",
  transfer: "挑战新页面",
  complete: "完成本节",
};

function isBoxModelEvent(
  event: LearningLessonRecordedEvent,
): event is BoxModelLessonRecordedEvent {
  return !event.type.startsWith("scenario-") && !isLearningAuditEvent(event);
}

function eventLabel(event: LearningLessonRecordedEvent): string {
  if (isLearningAuditEvent(event)) return learningAuditEventLabel(event);
  if (!isBoxModelEvent(event)) return "已切换到另一节课程";
  switch (event.type) {
    case "start":
      return "课程和实验已准备好";
    case "predict":
      return event.answer === "grows"
        ? "预测：卡片会变大"
        : event.answer === "same"
          ? "预测：卡片保持不变"
          : "预测：还不确定";
    case "experiment-saved":
      return `保存操作：${event.property} 调到 ${event.value}`;
    case "explain":
      return event.answer === "content-plus-padding"
        ? "解释：内容宽度和左右留白一起决定总宽"
        : "解释没有成立，继续根据提示思考";
    case "support":
      return event.action === "hint"
        ? `查看第 ${event.hintLevel} 层提示`
        : event.action === "skip"
          ? "选择跳过当前步骤"
          : event.action === "demonstration"
            ? "选择直接看示范，本轮不计独立达成"
            : event.action === "timeout"
              ? "等待超时，课程停在当前步骤"
              : "请求老师接手";
    case "attach-transfer":
      return "结构不同的新页面已准备好";
    case "transfer-submit":
      return isCorrectTransferDeclaration(event.code)
        ? "新页面挑战：写出 padding: 20px"
        : `新页面挑战：尝试 ${event.code.trim() || "空答案"}`;
  }
}

export function LearningProofReplay({
  timelineEvents,
  finalState,
  authoritativeSnapshot,
  onClose,
}: LearningProofReplayProps) {
  const { dialogRef, closeButtonRef } = useReplayDialogFocus(onClose);
  const [cursor, setCursor] = useState(timelineEvents.length);
  const [playing, setPlaying] = useState(false);
  const replayed = useMemo(
    () =>
      replayBoxModelLessonEvents(
        timelineEvents.slice(0, cursor).filter(isBoxModelEvent),
      ),
    [cursor, timelineEvents],
  );
  const currentEvent = cursor > 0 ? timelineEvents[cursor - 1] : null;
  const finalMatches =
    cursor === timelineEvents.length &&
    JSON.stringify(replayed) === JSON.stringify(finalState);
  const authoritativeMatches =
    cursor === timelineEvents.length &&
    authoritativeSnapshot?.throughSequence === timelineEvents.length
      ? JSON.stringify(replayed) ===
        JSON.stringify(authoritativeSnapshot.lessonState)
      : null;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= timelineEvents.length) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 850);
    return () => window.clearInterval(timer);
  }, [playing, timelineEvents.length]);

  return createPortal(
    <section
      ref={dialogRef}
      tabIndex={-1}
      className="learning-replay"
      role="dialog"
      aria-modal="true"
      aria-label="学习过程回放"
    >
      <header>
        <div>
          <span>学习过程回放</span>
          <strong>{PHASE_LABELS[replayed.phase]}</strong>
        </div>
        <button
          ref={closeButtonRef}
          type="button"
          className="is-secondary"
          onClick={onClose}
        >
          关闭回放
        </button>
      </header>

      <div className="learning-replay__stage" aria-live="polite">
        <small>
          第 {cursor} / {timelineEvents.length} 步
        </small>
        <p>{currentEvent ? eventLabel(currentEvent) : "还没有开始，先看看完整路线。"}</p>
        <ol>
          <li data-done={replayed.prediction !== null}>先做预测</li>
          <li data-done={replayed.observedPaddingPx === 32}>亲手观察</li>
          <li data-done={replayed.explanationCorrect === true}>说清原因</li>
          <li data-done={replayed.transferPassed === true}>挑战新页面</li>
        </ol>
        {!replayed.independentCreditEligible ? (
          <p>这轮使用过示范、跳过或老师接手，只记为有支架完成。</p>
        ) : null}
      </div>

      <label className="learning-replay__scrubber">
        <span>拖动查看任一步</span>
        <input
          type="range"
          min={0}
          max={timelineEvents.length}
          value={cursor}
          aria-label="回放步骤"
          onChange={(event) => {
            setPlaying(false);
            setCursor(Number(event.currentTarget.value));
          }}
        />
      </label>

      <div className="learning-replay__controls">
        <button
          type="button"
          className="is-secondary"
          disabled={cursor === 0}
          onClick={() => {
            setPlaying(false);
            setCursor((current) => Math.max(0, current - 1));
          }}
        >
          上一步
        </button>
        <button
          type="button"
          onClick={() => {
            if (cursor >= timelineEvents.length) setCursor(0);
            setPlaying((current) => !current);
          }}
        >
          {playing ? "暂停" : "自动播放"}
        </button>
        <button
          type="button"
          className="is-secondary"
          disabled={cursor >= timelineEvents.length}
          onClick={() => {
            setPlaying(false);
            setCursor((current) =>
              Math.min(timelineEvents.length, current + 1),
            );
          }}
        >
          下一步
        </button>
      </div>

      {cursor === timelineEvents.length ? (
        <p
          className={
            finalMatches
              ? "learning-replay__match is-matched"
              : "learning-replay__match"
          }
          data-replay-final-match={finalMatches}
          data-replay-authoritative-match={
            authoritativeMatches === null ? "unavailable" : authoritativeMatches
          }
        >
          {!finalMatches
            ? "回放结果还没有和当前记录对上，请先恢复最新记录。"
            : authoritativeMatches === true
              ? "回放结果和已保存的最终快照一致。"
              : authoritativeMatches === false
                ? "回放结果和已保存快照不一致，请先恢复最新记录。"
                : "回放结果和这台设备的当前记录一致；在线快照还没确认。"}
        </p>
      ) : null}
    </section>,
    document.body,
  );
}
