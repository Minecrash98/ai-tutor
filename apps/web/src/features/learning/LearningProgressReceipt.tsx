"use client";

import type {
  LearningLessonEvidence,
  LearningLessonRecordedEvent,
} from "@ai-tutor/contracts";

import { buildLearningFeedbackTimeline } from "./learning-feedback";

interface LearningProgressStep {
  readonly id: string;
  readonly label: string;
  readonly complete: boolean;
  readonly evidence: string;
}

const STATUS_LABELS = {
  met: "这次通过",
  "not-met": "这次未通过",
  supported: "使用了帮助",
  blocked: "证据还不够",
} as const;

export function LearningProgressReceipt({
  steps,
  events,
  evidence,
}: {
  readonly steps: readonly LearningProgressStep[];
  readonly events: readonly LearningLessonRecordedEvent[];
  readonly evidence: readonly LearningLessonEvidence[];
}) {
  const completed = steps.filter((step) => step.complete).length;
  const timeline = buildLearningFeedbackTimeline(events, evidence);
  return (
    <details className="learning-progress-receipt">
      <summary>
        查看目前学习记录（{completed}/{steps.length}）
      </summary>
      <p>
        未完成或没有记录的步骤会明确留空，不会自动算作掌握。
      </p>
      <ol className="learning-progress-receipt__steps">
        {steps.map((step) => (
          <li key={step.id} data-step-complete={step.complete}>
            <strong>{step.complete ? "已完成" : "还未完成"} · {step.label}</strong>
            <span>
              {step.complete
                ? step.evidence
                : "还没有对应的学生操作记录。"}
            </span>
          </li>
        ))}
      </ol>
      <details>
        <summary>逐步查看原始过程</summary>
        {timeline.length > 0 ? (
          <ol className="learning-progress-receipt__events">
            {timeline.map(({ event, feedback, code }, index) => (
              <li
                key={event.eventId}
                data-feedback-status={feedback.status}
                data-feedback-version={feedback.feedbackVersion}
                data-event-version={event.eventVersion}
              >
                <strong>
                  第 {index + 1} 次学生操作 · {STATUS_LABELS[feedback.status]}
                </strong>
                {feedback.correctsEventId ? <em>这次修正了前一次尝试</em> : null}
                <dl>
                  <div><dt>当前目标</dt><dd>{feedback.goal}</dd></div>
                  <div><dt>你的实际操作</dt><dd>{feedback.observedBehavior}</dd></div>
                  <div><dt>为什么这样判断</dt><dd>{feedback.causalEvidence}</dd></div>
                  <div><dt>下一小步</dt><dd>{feedback.nextSmallestAction}</dd></div>
                </dl>
                {code !== null ? (
                  <pre><code aria-label="本次提交的 CSS">{code || "（空白提交）"}</code></pre>
                ) : null}
                <time dateTime={event.at}>{new Date(event.at).toLocaleString("zh-CN")}</time>
              </li>
            ))}
          </ol>
        ) : (
          <p>还没有过程记录。</p>
        )}
      </details>
    </details>
  );
}
