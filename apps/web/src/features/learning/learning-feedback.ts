import type {
  LearningFeedbackReceipt,
  LearningLessonEvidence,
  LearningLessonRecordedEvent,
} from "@ai-tutor/contracts";

export interface LearningFeedbackTimelineEntry {
  readonly event: LearningLessonRecordedEvent;
  readonly feedback: LearningFeedbackReceipt;
  readonly code: string | null;
}

function eventKind(event: LearningLessonRecordedEvent): string | null {
  if (event.type === "predict" || event.type === "scenario-predict") return "prediction";
  if (event.type === "experiment-saved" || event.type === "scenario-experiment-saved") return "observation";
  if (event.type === "explain" || event.type === "scenario-explain") return "explanation";
  if (event.type === "support" || event.type === "scenario-support") return "support";
  if (event.type === "transfer-submit" || event.type === "scenario-transfer-submit") return "transfer";
  return null;
}

function goalFor(kind: string): string {
  return {
    prediction: "先根据现象做出可修正的预测",
    observation: "亲手保存一个指定的页面变化",
    explanation: "用页面事实说清变化原因",
    support: "在需要时获得一小步帮助",
    transfer: "在结构不同的新页面完成挑战",
  }[kind] ?? "完成当前学习动作";
}

function answerLabel(value: string): string {
  return {
    grows: "会变大",
    same: "保持不变",
    unsure: "还不确定",
    "content-plus-padding": "内容宽之外还要加内边距和边框",
    "margin-pushes": "认为是外边距把卡片撑大",
    "font-grows": "认为是文字变大",
    "gap-separates-items": "间距只改变项目之间的空白",
    "gap-resizes-items": "认为间距会改变项目自身大小",
    "absolute-leaves-flow": "绝对定位会离开普通队伍",
    "relative-leaves-flow": "认为相对定位会离开普通队伍",
    "axes-are-independent": "主轴与交叉轴分别控制",
    "gap-changes-item-size": "认为间距改变项目自身大小",
    "justify-is-cross-axis": "认为主轴对齐控制交叉方向",
    "nearest-positioned-ancestor": "从最近的已定位祖先量偏移",
    "viewport-always": "认为总是从浏览器窗口量偏移",
  }[value] ?? value;
}

function observedBehavior(event: LearningLessonRecordedEvent): string {
  if (event.type === "predict" || event.type === "scenario-predict") {
    return `选择了“${answerLabel(event.answer)}”`;
  }
  if (event.type === "experiment-saved" || event.type === "scenario-experiment-saved") {
    return `保存了 ${event.property}: ${event.value}`;
  }
  if (event.type === "explain" || event.type === "scenario-explain") {
    return `选择了“${answerLabel(event.answer)}”作为解释`;
  }
  if (event.type === "support" || event.type === "scenario-support") {
    return event.action === "hint"
      ? `查看了第 ${event.hintLevel} 层提示`
      : event.action === "demonstration"
        ? "选择查看局部示范"
        : event.action === "skip"
          ? "选择跳过当前一步"
          : event.action === "timeout"
            ? "两分钟内还没有完成当前操作"
            : "标记为需要老师接手";
  }
  if (event.type === "transfer-submit" || event.type === "scenario-transfer-submit") {
    return "提交了一段新页面 CSS";
  }
  return "完成了一次学习操作";
}

function nextAction(kind: string, status: LearningFeedbackReceipt["status"]): string {
  if (status === "blocked") return "先等待页面生成可核对结果，再查看这次记录";
  if (status === "supported") return "按提示只完成当前最小一步，然后重新核对";
  if (status === "not-met") return "对照上面的具体差异，只改一处后再试一次";
  return {
    prediction: "继续亲手操作，用真实结果核对预测",
    observation: "继续完成下一个指定变化",
    explanation: "去新页面做一次不带答案的挑战",
    transfer: "保留这次结果，之后再做一次延迟复测",
  }[kind] ?? "继续下一步";
}

export function buildLearningFeedbackTimeline(
  events: readonly LearningLessonRecordedEvent[],
  evidence: readonly LearningLessonEvidence[],
): readonly LearningFeedbackTimelineEntry[] {
  const evidenceByEvent = new Map(evidence.map((item) => [item.eventId, item]));
  const latestFailureByKind = new Map<string, string>();
  const timeline: LearningFeedbackTimelineEntry[] = [];
  for (const event of events) {
    const kind = eventKind(event);
    if (!kind) continue;
    const matchingEvidence = evidenceByEvent.get(event.eventId) ?? null;
    const isSupport = kind === "support";
    const status: LearningFeedbackReceipt["status"] = isSupport
      ? "supported"
      : matchingEvidence
        ? matchingEvidence.passed
          ? "met"
          : "not-met"
        : "blocked";
    const correctsEventId = status === "met" ? (latestFailureByKind.get(kind) ?? null) : null;
    if (status === "not-met") latestFailureByKind.set(kind, event.eventId);
    if (status === "met") latestFailureByKind.delete(kind);
    const hintLevel =
      (event.type === "support" || event.type === "scenario-support") && event.action === "hint"
        ? (event.hintLevel ?? 0)
        : 0;
    timeline.push({
      event,
      feedback: {
        feedbackVersion: 1,
        eventId: event.eventId,
        goal: goalFor(kind),
        observedBehavior: observedBehavior(event),
        causalEvidence:
          matchingEvidence?.detail ??
          (isSupport
            ? "这次帮助类型和层级已写入学习记录"
            : "这次操作还没有对应的确定性页面结果，不能自动算作通过"),
        nextSmallestAction: nextAction(kind, status),
        hintLevel,
        status,
        correctsEventId,
      },
      code:
        event.type === "transfer-submit" || event.type === "scenario-transfer-submit"
          ? event.code
          : null,
    });
  }
  return Object.freeze(timeline);
}
