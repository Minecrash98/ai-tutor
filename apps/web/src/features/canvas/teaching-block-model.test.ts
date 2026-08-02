import { describe, expect, it } from "vitest";

import {
  TEACHING_BLOCK_DEFINITIONS,
  TEACHING_BLOCK_TYPES,
  teachingBlockIdToShapeId,
  teachingShapeIdToBlockId,
} from "./teaching-block-model";

describe("teaching block model", () => {
  it("defines all six P2 block shells", () => {
    expect(TEACHING_BLOCK_TYPES).toHaveLength(6);
    expect(Object.keys(TEACHING_BLOCK_DEFINITIONS)).toEqual(
      expect.arrayContaining([...TEACHING_BLOCK_TYPES]),
    );
  });

  it("round-trips the semantic block id through a tldraw shape id", () => {
    const shapeId = teachingBlockIdToShapeId("runnable-demo");

    expect(shapeId).toBe("shape:teaching-runnable-demo");
    expect(teachingShapeIdToBlockId(shapeId)).toBe("runnable-demo");
    expect(teachingShapeIdToBlockId("shape:geo-demo")).toBeNull();
  });
});
