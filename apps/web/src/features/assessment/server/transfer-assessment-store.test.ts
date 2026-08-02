import { HIDDEN_TRANSFER_MANIFEST } from "@ai-tutor/curriculum";
import { describe, expect, it } from "vitest";

import {
  HIDDEN_TRANSFER_ITEMS,
  hiddenTransferHash,
} from "./hidden-transfer-items";
import {
  evaluateHiddenTransferAnswer,
  transferAssessmentStatus,
} from "./transfer-assessment-store";

describe("hidden transfer assessment boundaries", () => {
  it("matches every server-only item to the public frozen hash manifest", () => {
    expect(HIDDEN_TRANSFER_ITEMS).toHaveLength(6);
    for (const courseId of [
      "box-model-v1",
      "flex-v1",
      "positioning-v1",
    ] as const) {
      const courseItems = HIDDEN_TRANSFER_ITEMS.filter(
        (item) => item.courseId === courseId,
      );
      expect(courseItems.map((item) => item.kind).sort()).toEqual([
        "delayed-retention",
        "immediate-hidden",
      ]);
    }
    expect(
      HIDDEN_TRANSFER_MANIFEST.map((entry) => ({
        itemId: entry.itemId,
        courseId: entry.courseId,
        kind: entry.kind,
        sha256: entry.sha256,
        visibility: entry.visibility,
      })),
    ).toEqual(
      HIDDEN_TRANSFER_ITEMS.map((item) => ({
        itemId: item.itemId,
        courseId: item.courseId,
        kind: item.kind,
        sha256: hiddenTransferHash(item),
        visibility: "server-hidden",
      })),
    );
    expect(JSON.stringify(HIDDEN_TRANSFER_MANIFEST)).not.toContain(
      "expectedValue",
    );
    expect(JSON.stringify(HIDDEN_TRANSFER_MANIFEST)).not.toContain(
      "answerPlaceholder",
    );
  });

  it("accepts one exact declaration and preserves wrong attempts as failures", () => {
    const item = HIDDEN_TRANSFER_ITEMS[0]!;
    expect(evaluateHiddenTransferAnswer(item, "/* my work */ padding:24px;"))
      .toMatchObject({
        passed: true,
        normalizedAnswer: "padding: 24px;",
      });
    expect(evaluateHiddenTransferAnswer(item, "margin: 24px;").passed).toBe(
      false,
    );
    expect(
      evaluateHiddenTransferAnswer(
        item,
        "padding: 24px; color: transparent;",
      ).passed,
    ).toBe(false);
    expect(evaluateHiddenTransferAnswer(item, ".x { padding: 24px }").passed)
      .toBe(false);
    expect(evaluateHiddenTransferAnswer(item, "padding: 24px 24px;").passed)
      .toBe(true);
    expect(
      evaluateHiddenTransferAnswer(
        item,
        "padding: 24.0px 24px 24px 24px;",
      ).passed,
    ).toBe(true);
    expect(
      evaluateHiddenTransferAnswer(item, "padding: 24px 24px 20px 24px;")
        .passed,
    ).toBe(false);

    const flexItem = HIDDEN_TRANSFER_ITEMS.find(
      (candidate) => candidate.itemId === "flex-transfer-b-1",
    )!;
    expect(evaluateHiddenTransferAnswer(flexItem, "gap: 0px 28px;").passed)
      .toBe(true);
    expect(evaluateHiddenTransferAnswer(flexItem, "gap: 28px 20px;").passed)
      .toBe(false);
  });

  it("keeps delayed content locked until 24 hours and marks late passes", () => {
    const dueAt = new Date("2026-08-03T08:00:00.000Z");
    const closesAt = new Date("2026-08-05T08:00:00.000Z");
    const pending = {
      assessmentKind: "delayed-retention",
      dueAt,
      closesAt,
      passedAt: null,
      passedInWindow: null,
    };
    expect(
      transferAssessmentStatus(
        pending,
        new Date("2026-08-03T07:59:59.999Z"),
      ),
    ).toBe("locked");
    expect(transferAssessmentStatus(pending, dueAt)).toBe("available");
    expect(
      transferAssessmentStatus(
        {
          ...pending,
          passedAt: new Date("2026-08-05T09:00:00.000Z"),
          passedInWindow: false,
        },
        new Date("2026-08-05T09:00:00.000Z"),
      ),
    ).toBe("passed-late");
  });
});
