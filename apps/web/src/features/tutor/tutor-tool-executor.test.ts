import { describe, expect, it, vi } from "vitest";

import {
  createTutorToolExecutor,
  type TutorCanvasOperations,
} from "./tutor-tool-executor";

const teachingAction = {
  target: "demo-1 #demo",
  evidence: [
    { reference: "selected-element", observation: "padding 当前为 16px" },
  ],
  expectedStudentAction: "亲手调整 padding 并保存",
  successCriterion: "保存后的 padding 为目标值",
  hintLevel: 0 as const,
  feedback: {
    observedBehavior: "尚未观察到新的学生操作",
    causalEvidence: "当前值来自浏览器计算样式",
    nextSmallestAction: "只调整一次 padding",
  },
};

function operations(): TutorCanvasOperations {
  return {
    readCanvasState: vi.fn(() => "one runnable block"),
    inspectSelectedElement: vi.fn(() => '{"factType":"selected-element"}'),
    readRelevantSource: vi.fn(() => '{"factType":"relevant-source"}'),
    readLastStudentAction: vi.fn(() => '{"factType":"last-student-action"}'),
    readTeachingAssertionEvidence: vi.fn(
      () => '{"factType":"teaching-assertion-evidence"}',
    ),
    createMinimalVerification: vi.fn(
      () => '{"factType":"minimal-verification-experiment"}',
    ),
    createExplanation: vi.fn(() => "explanation-1"),
    createDemo: vi.fn(() => "demo-1"),
    applyCssChange: vi.fn(() => "revision-2"),
    createController: vi.fn(() => "controller-1"),
    createComparison: vi.fn(() => "comparison-1"),
    focusBlock: vi.fn(),
  };
}

describe("P6 tutor tool executor", () => {
  it("executes one allowlisted tool only once for a repeated request id", async () => {
    const canvas = operations();
    const executor = createTutorToolExecutor(canvas);
    const argumentsValue = {
      requestId: "same-request",
      topic: "box-model",
      title: "盒模型",
      teachingAction,
    };

    const [first, second] = await Promise.all([
      executor.execute("create_demo_block", argumentsValue),
      executor.execute("create_demo_block", argumentsValue),
    ]);

    expect(first).toEqual(second);
    expect(first.success).toBe(true);
    expect(canvas.createDemo).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown tools before any canvas operation", async () => {
    const canvas = operations();
    const executor = createTutorToolExecutor(canvas);

    const result = await executor.execute("delete_canvas", {
      requestId: "bad-request",
    });

    expect(result.success).toBe(false);
    expect(result.message).toContain("Unknown tutor tool");
    expect(canvas.createDemo).not.toHaveBeenCalled();
    expect(canvas.applyCssChange).not.toHaveBeenCalled();
  });

  it("rejects reuse of one request id with different arguments", async () => {
    const canvas = operations();
    const executor = createTutorToolExecutor(canvas);
    const first = await executor.execute("apply_css_change", {
      requestId: "same-request",
      blockId: "demo-1",
      selector: "#demo",
      property: "padding",
      value: "24px",
      teachingAction,
    });
    const conflicting = await executor.execute("apply_css_change", {
      requestId: "same-request",
      blockId: "demo-1",
      selector: "#demo",
      property: "padding",
      value: "32px",
      teachingAction,
    });

    expect(first.success).toBe(true);
    expect(conflicting).toEqual({
      success: false,
      message: "同一个操作编号不能对应两组不同参数。",
    });
    expect(canvas.applyCssChange).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["inspect_selected_element", "inspectSelectedElement"],
    ["read_relevant_source", "readRelevantSource"],
    ["read_teaching_assertion_evidence", "readTeachingAssertionEvidence"],
  ] as const)(
    "executes the bounded read-only %s tool against one validated block",
    async (tool, operation) => {
      const canvas = operations();
      const executor = createTutorToolExecutor(canvas);

      const result = await executor.execute(tool, {
        requestId: `read-${tool}`,
        blockId: "demo-1",
      });

      expect(result.success).toBe(true);
      expect(canvas[operation]).toHaveBeenCalledWith({ blockId: "demo-1" });
    },
  );

  it("reads the newest meaningful student action without requiring a block id", async () => {
    const canvas = operations();
    const executor = createTutorToolExecutor(canvas);

    const result = await executor.execute("read_last_student_action", {
      requestId: "read-last-action",
    });

    expect(result.success).toBe(true);
    expect(canvas.readLastStudentAction).toHaveBeenCalledTimes(1);
  });

  it("creates a bounded minimal verification from one validated block only", async () => {
    const canvas = operations();
    const executor = createTutorToolExecutor(canvas);
    const result = await executor.execute("create_minimal_verification", {
      requestId: "verify-one",
      blockId: "demo-1",
      teachingAction,
    });
    expect(result.success).toBe(true);
    expect(canvas.createMinimalVerification).toHaveBeenCalledWith({
      blockId: "demo-1",
    });
  });

  it("returns entity validation failures without hiding them", async () => {
    const canvas = operations();
    canvas.applyCssChange = vi.fn(() => {
      throw new Error("运行块不存在：missing-block");
    });
    const executor = createTutorToolExecutor(canvas);

    const result = await executor.execute("apply_css_change", {
      requestId: "missing-entity",
      blockId: "missing-block",
      selector: "#demo",
      property: "padding",
      value: "24px",
      teachingAction,
    });

    expect(result).toEqual({
      success: false,
      message: "运行块不存在：missing-block",
    });
  });

});
