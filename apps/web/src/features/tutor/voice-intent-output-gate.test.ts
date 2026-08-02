import { describe, expect, it } from "vitest";

import { VoiceIntentOutputGate } from "./voice-intent-output-gate";

describe("VoiceIntentOutputGate", () => {
  it("holds premature assistant deltas until the user transcript resolves", () => {
    const gate = new VoiceIntentOutputGate();

    expect(gate.arm()).toBe(true);
    expect(gate.captureAssistantTranscript("正", false)).toBe(true);
    expect(gate.captureAssistantTranscript("在", false)).toBe(true);
    expect(gate.suppressedCharacterCount).toBe(2);
    expect(gate.resolve()).toEqual({
      armed: true,
      suppressedText: "正在",
    });
    expect(gate.armed).toBe(false);
  });

  it("uses a final transcript as the authoritative buffered segment", () => {
    const gate = new VoiceIntentOutputGate();
    gate.arm();
    gate.captureAssistantTranscript("我", false);
    gate.captureAssistantTranscript("我来创建一下。", true);

    expect(gate.resolve().suppressedText).toBe("我来创建一下。");
  });

  it("does not clear an active hold when VAD emits a duplicate arm", () => {
    const gate = new VoiceIntentOutputGate();
    gate.arm();
    gate.captureAssistantTranscript("我", false);

    expect(gate.arm()).toBe(false);
    expect(gate.resolve().suppressedText).toBe("我");
    expect(gate.captureAssistantTranscript("后续", false)).toBe(false);
  });
});
