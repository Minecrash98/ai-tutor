import { describe, expect, it } from "vitest";

import {
  classifyCanvasAssistantSegment,
  canvasGroundingRequirement,
  parseTutorFactReceipt,
  requiresCanvasGrounding,
} from "./use-realtime-tutor";

describe("requiresCanvasGrounding", () => {
  it.each([
    "给我做一个能看懂 padding 变化的盒模型小实验",
    "建一个能看懂内边距变化的盒模型小实验",
    "做一个三个小方块的 Flex 演示",
    "把 gap 改成 32px 并做前后对比",
    "我刚才改了什么？页面为什么变成这样？",
  ])("recognizes canvas-grounded teaching requests: %s", (request) => {
    expect(requiresCanvasGrounding(request)).toBe(true);
  });

  it.each([
    "padding 是什么？",
    "为什么 absolute 会脱离普通文档流？",
    "请只解释原因，不要修改画布。",
    "我行实验",
  ])("leaves concept-only questions audible: %s", (request) => {
    expect(requiresCanvasGrounding(request)).toBe(false);
  });
});

describe("classifyCanvasAssistantSegment", () => {
  it("holds and suppresses process narration around canvas tools", () => {
    expect(
      classifyCanvasAssistantSegment(
        "明白,我来准备一个可以拖动的小实验。",
        false,
        true,
      ),
    ).toBe("suppress");
    expect(
      classifyCanvasAssistantSegment("我先准备一下。", true, false),
    ).toBe("suppress");
  });

  it("reveals grounded result language as soon as it is identifiable", () => {
    expect(
      classifyCanvasAssistantSegment("我已", true, false),
    ).toBe("reveal");
    expect(
      classifyCanvasAssistantSegment(
        "你刚把 padding 从四零像素拖到四四像素。",
        true,
        false,
      ),
    ).toBe("reveal");
    expect(
      classifyCanvasAssistantSegment("画布上已经出现盒模型实验。", true, false),
    ).toBe("reveal");
  });

  it("waits for an ambiguous segment and reveals it only after a tool result", () => {
    expect(
      classifyCanvasAssistantSegment("可以看到", true, false),
    ).toBe("wait");
    expect(
      classifyCanvasAssistantSegment("可以看到盒子变大了。", true, true),
    ).toBe("reveal");
    expect(
      classifyCanvasAssistantSegment("可以看到盒子变大了。", false, true),
    ).toBe("suppress");
  });
});

describe("canvasGroundingRequirement", () => {
  it("requires an assertion receipt for causal page questions", () => {
    expect(canvasGroundingRequirement("这张卡片刚才为什么变大？")).toBe(
      "causal-assertion",
    );
    expect(canvasGroundingRequirement("是哪条规则让它移动了？")).toBe(
      "causal-assertion",
    );
  });

  it("keeps mutations separate and ignores an explicit no-change request", () => {
    expect(canvasGroundingRequirement("把 padding 调到 32px")).toBe(
      "canvas-change",
    );
    expect(canvasGroundingRequirement("不要修改我的页面，只解释 CSS 概念")).toBeNull();
  });
});

describe("parseTutorFactReceipt", () => {
  it("extracts the exact target, changed value, and source rule", () => {
    expect(
      parseTutorFactReceipt(
        JSON.stringify({
          factType: "teaching-assertion-evidence",
          assertionAllowed: true,
          target: { domPath: "main > article.card" },
          beforeAfter: {
            property: "padding",
            beforeValue: "16px",
            afterValue: "24px",
          },
          relevantRules: [
            {
              selector: ".card",
              source: { filePath: "styles/card.css", line: 12 },
              declarations: [{ property: "padding", value: "24px" }],
            },
          ],
          uncertainty: null,
        }),
      ),
    ).toEqual({
      allowed: true,
      target: "main > article.card",
      property: "padding",
      beforeValue: "16px",
      afterValue: "24px",
      selector: ".card",
      source: "styles/card.css 第 12 行",
      ruleValue: "24px",
      uncertainty: null,
    });
  });

  it("keeps an insufficient-evidence result visible without inventing facts", () => {
    expect(
      parseTutorFactReceipt(
        JSON.stringify({
          factType: "teaching-assertion-evidence",
          assertionAllowed: false,
          target: {},
          relevantRules: [],
          uncertainty: "还没有读取到这次变化前后的值。",
        }),
      ),
    ).toEqual({
      allowed: false,
      target: "当前选中的页面内容",
      property: null,
      beforeValue: null,
      afterValue: null,
      selector: null,
      source: null,
      ruleValue: null,
      uncertainty: "还没有读取到这次变化前后的值。",
    });
  });

  it("ignores unrelated or malformed tool messages", () => {
    expect(parseTutorFactReceipt("not json")).toBeNull();
    expect(parseTutorFactReceipt(JSON.stringify({ factType: "other" }))).toBeNull();
  });
});
