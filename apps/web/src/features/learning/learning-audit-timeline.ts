import type {
  LearningAuditRecordedEvent,
  LearningLessonRecordedEvent,
} from "@ai-tutor/contracts";

const STATUS_LABELS: Readonly<
  Record<
    Extract<
      LearningAuditRecordedEvent,
      { type: "audit-tutor-session" }
    >["status"],
    string
  >
> = {
  checking: "学习搭档正在检查连接",
  "requesting-microphone": "学习搭档正在准备语音输入",
  connecting: "学习搭档正在连接",
  connected: "学习搭档已经连接",
  listening: "学习搭档正在听",
  thinking: "学习搭档正在思考",
  doing: "学习搭档正在调整页面",
  speaking: "学习搭档正在讲解",
  reconnecting: "学习搭档正在恢复连接",
  stopped: "本次学习搭档会话已结束",
  error: "学习搭档遇到问题，本次课程记录仍保留",
};

const TOOL_LABELS: Readonly<Record<string, string>> = {
  read_canvas_state: "查看当前画布",
  inspect_selected_element: "查看选中元素",
  read_relevant_source: "核对相关源码",
  read_last_student_action: "核对最近一次操作",
  read_teaching_assertion_evidence: "核对页面变化原因",
  create_minimal_verification: "建立最小验证",
  create_explanation_block: "添加讲解卡片",
  create_demo_block: "添加实验页面",
  apply_css_change: "修改页面样式",
  create_css_controller: "添加控制器",
  create_comparison: "建立前后对比",
  focus_block: "聚焦相关卡片",
};

export function isLearningAuditEvent(
  event: LearningLessonRecordedEvent,
): event is LearningAuditRecordedEvent {
  return event.type.startsWith("audit-");
}

function clipped(value: string, limit = 120): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= limit
    ? normalized
    : `${normalized.slice(0, limit)}…`;
}

export function learningAuditEventLabel(
  event: LearningAuditRecordedEvent,
): string {
  switch (event.type) {
    case "audit-tutor-session":
      return `${STATUS_LABELS[event.status]}（${event.mode === "voice" ? "语音" : "文字"}）`;
    case "audit-tutor-message": {
      const speaker =
        event.role === "user"
          ? "我"
          : event.role === "assistant"
            ? "学习搭档"
            : "系统提示";
      return event.contentStored && event.text
        ? `${speaker}：${clipped(event.text)}`
        : `${speaker}发出一条 ${event.characterCount} 字的消息；正文未保存`;
    }
    case "audit-tutor-tool":
      return `${TOOL_LABELS[event.tool] ?? "执行页面操作"}${event.success ? "完成" : "未完成"}`;
    case "audit-fact-receipt":
      return event.allowed
        ? `页面事实已核对${event.property ? `：${event.property}` : ""}`
        : `页面事实还不足${event.uncertainty ? `：${clipped(event.uncertainty)}` : "，没有猜测原因"}`;
    case "audit-canvas-action":
      return event.detail
        ? `${event.action}：${clipped(event.detail)}`
        : event.action;
  }
}
