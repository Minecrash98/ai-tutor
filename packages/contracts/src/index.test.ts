import { describe, expect, it } from "vitest";

import {
  inspectionResultSchema,
  RUNTIME_PROTOCOL_VERSION,
  runtimeComparisonViewportStateSchema,
  runtimeMessageEnvelopeSchema,
} from "./index";

describe("runtime message envelope", () => {
  it("accepts a versioned runtime message", () => {
    const result = runtimeMessageEnvelopeSchema.safeParse({
      protocolVersion: RUNTIME_PROTOCOL_VERSION,
      runtimeInstanceId: "runtime-1",
      messageId: "message-1",
      type: "runtime.ready",
      payload: {},
    });

    expect(result.success).toBe(true);
  });

  it("rejects unsupported protocol versions", () => {
    const result = runtimeMessageEnvelopeSchema.safeParse({
      protocolVersion: 2,
      runtimeInstanceId: "runtime-1",
      messageId: "message-1",
      type: "runtime.ready",
      payload: {},
    });

    expect(result.success).toBe(false);
  });

  it("validates structured P4 inspection results", () => {
    const result = inspectionResultSchema.safeParse({
      target: {
        runtimeInstanceId: "runtime-1",
        domPath: "main#card",
        fingerprint: "main|card|body|0",
      },
      domPath: "main#card",
      tagName: "main",
      attributes: { id: "card" },
      boundingRect: {
        x: 10,
        y: 20,
        width: 120,
        height: 80,
        top: 20,
        right: 130,
        bottom: 100,
        left: 10,
      },
      boxModel: {
        content: { width: 92, height: 52 },
        padding: { top: 12, right: 12, bottom: 12, left: 12 },
        border: { top: 2, right: 2, bottom: 2, left: 2 },
        margin: { top: 8, right: 8, bottom: 8, left: 8 },
        boxSizing: "content-box",
      },
      computedStyles: { display: "block" },
      matchedRules: [],
      diagnostics: [],
    });

    expect(result.success).toBe(true);
  });

  it("validates the fixed-zoom comparison viewport receipt", () => {
    const state = {
      mode: "focus",
      scrollTop: 120,
      scrollLeft: 0,
      maxScrollTop: 640,
      maxScrollLeft: 0,
      viewportWidth: 800,
      viewportHeight: 600,
      documentWidth: 800,
      documentHeight: 1240,
      scrollRatio: 0.1875,
      zoom: 1,
      targetViewportCenterY: 300,
    };
    expect(runtimeComparisonViewportStateSchema.safeParse(state).success).toBe(true);
    expect(runtimeComparisonViewportStateSchema.safeParse({ ...state, zoom: 0.8 }).success).toBe(false);
    expect(runtimeComparisonViewportStateSchema.safeParse({ ...state, scrollRatio: 1.1 }).success).toBe(false);
  });
});
