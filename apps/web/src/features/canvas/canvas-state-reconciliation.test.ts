import { describe, expect, it } from "vitest";

import {
  reconcileComparisonsWithTombstones,
  reconcileMapKeysWithTombstones,
  retainMapKeys,
  retainValidComparisons,
} from "./canvas-state-reconciliation";

describe("canvas semantic state reconciliation", () => {
  it("removes runtime projects that no longer have a runnable canvas block", () => {
    const projects = new Map([
      ["visible", { revision: 2 }],
      ["orphan-a", { revision: 1 }],
      ["orphan-b", { revision: 3 }],
    ]);

    expect([...retainMapKeys(projects, new Set(["visible"]))]).toEqual([
      ["visible", { revision: 2 }],
    ]);
  });

  it("keeps the original map when every runtime project is still visible", () => {
    const projects = new Map([["visible", { revision: 2 }]]);

    expect(retainMapKeys(projects, new Set(["visible"]))).toBe(projects);
  });

  it("removes comparisons without both a canvas block and a live source", () => {
    const comparisons = new Map([
      ["valid-comparison", { sourceBlockId: "visible" }],
      ["missing-shape", { sourceBlockId: "visible" }],
      ["missing-source", { sourceBlockId: "orphan" }],
    ]);

    expect([
      ...retainValidComparisons(
        comparisons,
        new Set(["valid-comparison", "missing-source"]),
        new Set(["visible"]),
      ),
    ]).toEqual([
      ["valid-comparison", { sourceBlockId: "visible" }],
    ]);
  });

  it("restores deleted semantic state when the canvas deletion is undone", () => {
    const projectTombstones = new Map<string, { revision: number }>();
    const original = new Map([["block-1", { revision: 2 }]]);
    const deleted = reconcileMapKeysWithTombstones(
      original,
      new Set(),
      projectTombstones,
    );
    expect(deleted.size).toBe(0);
    expect(projectTombstones.get("block-1")).toEqual({ revision: 2 });

    const restored = reconcileMapKeysWithTombstones(
      deleted,
      new Set(["block-1"]),
      projectTombstones,
    );
    expect(restored.get("block-1")).toEqual({ revision: 2 });
    expect(projectTombstones.size).toBe(0);
  });

  it("restores a comparison only when both it and its source return", () => {
    const tombstones = new Map<string, { sourceBlockId: string }>();
    const original = new Map([
      ["comparison-1", { sourceBlockId: "block-1" }],
    ]);
    const deleted = reconcileComparisonsWithTombstones(
      original,
      new Set(),
      new Set(),
      tombstones,
    );
    expect(deleted.size).toBe(0);

    const missingSource = reconcileComparisonsWithTombstones(
      deleted,
      new Set(["comparison-1"]),
      new Set(),
      tombstones,
    );
    expect(missingSource.size).toBe(0);
    const restored = reconcileComparisonsWithTombstones(
      missingSource,
      new Set(["comparison-1"]),
      new Set(["block-1"]),
      tombstones,
    );
    expect(restored.get("comparison-1")).toEqual({
      sourceBlockId: "block-1",
    });
  });
});
