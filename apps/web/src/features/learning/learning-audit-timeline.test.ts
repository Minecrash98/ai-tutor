import type { LearningAuditRecordedEvent } from "@ai-tutor/contracts";
import { describe, expect, it } from "vitest";

import { learningAuditEventLabel } from "./learning-audit-timeline";

const identity = {
  eventVersion: 1 as const,
  eventId: "10000000-0000-4000-8000-000000000051",
  sessionId: "20000000-0000-4000-8000-000000000051",
  at: "2026-08-02T00:00:01.000Z",
};

describe("learning audit timeline labels", () => {
  it("shows a privacy-safe message without reconstructing its text", () => {
    const event: LearningAuditRecordedEvent = {
      ...identity,
      type: "audit-tutor-message",
      actorType: "user",
      mode: "voice",
      realtimeSessionId: "40000000-0000-4000-8000-000000000051",
      role: "user",
      contentStored: false,
      text: null,
      characterCount: 12,
    };
    expect(learningAuditEventLabel(event)).toBe(
      "我发出一条 12 字的消息；正文未保存",
    );
  });

  it("uses student-facing language for tools and insufficient facts", () => {
    const tool: LearningAuditRecordedEvent = {
      ...identity,
      type: "audit-tutor-tool",
      actorType: "ai",
      mode: "text",
      realtimeSessionId: "40000000-0000-4000-8000-000000000051",
      requestId: "request-1",
      tool: "apply_css_change",
      success: true,
      mutatesCanvas: true,
    };
    const fact: LearningAuditRecordedEvent = {
      ...identity,
      eventId: "10000000-0000-4000-8000-000000000052",
      type: "audit-fact-receipt",
      actorType: "system",
      mode: "text",
      realtimeSessionId: "40000000-0000-4000-8000-000000000051",
      requestId: "request-2",
      allowed: false,
      target: "当前页面",
      property: null,
      beforeValue: null,
      afterValue: null,
      selector: null,
      source: null,
      ruleValue: null,
      uncertainty: "还没有前后版本。",
    };
    expect(learningAuditEventLabel(tool)).toBe("修改页面样式完成");
    expect(learningAuditEventLabel(fact)).toBe(
      "页面事实还不足：还没有前后版本。",
    );
  });
});
