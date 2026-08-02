import { describe, expect, it } from "vitest";

import { isRectNearViewport } from "./visibility";

const viewport = { x: 100, y: 100, width: 800, height: 600 };

describe("canvas visibility detection", () => {
  it("includes shapes inside the viewport and preload margin", () => {
    expect(
      isRectNearViewport({ x: 140, y: 120, width: 200, height: 100 }, viewport),
    ).toBe(true);
    expect(
      isRectNearViewport(
        { x: -180, y: 120, width: 40, height: 40 },
        viewport,
        320,
      ),
    ).toBe(true);
  });

  it("excludes shapes beyond the preload margin", () => {
    expect(
      isRectNearViewport(
        { x: -400, y: 120, width: 40, height: 40 },
        viewport,
        320,
      ),
    ).toBe(false);
  });

  it("rejects a negative visibility margin", () => {
    expect(() =>
      isRectNearViewport(
        { x: 0, y: 0, width: 10, height: 10 },
        viewport,
        -1,
      ),
    ).toThrow("Visibility margin cannot be negative.");
  });
});
