import { describe, expect, it } from "vitest";

import {
  createWorkspaceState,
  inspectWorkspaceState,
  WORKSPACE_STATE_VERSION,
} from "./canvas-workspace-persistence";

describe("atomic canvas workspace envelope", () => {
  it("accepts an intact versioned state with matching checksum", async () => {
    const state = await createWorkspaceState({
      canvasSnapshot: { document: { store: { "shape:1": { type: "shape" } } } },
      semanticState: JSON.stringify({ version: 1, projects: [], comparisons: [] }),
      writerId: "writer-1",
      revisionId: "workspace-revision-1",
      savedAt: "2026-08-02T12:00:00.000Z",
    });

    await expect(inspectWorkspaceState(state)).resolves.toEqual({
      status: "ready",
      state,
    });
  });

  it("preserves a checksum mismatch as rescue data", async () => {
    const state = await createWorkspaceState({
      canvasSnapshot: { version: 1 },
      semanticState: "{\"version\":1}",
      writerId: "writer-1",
    });
    const damaged = { ...state, semanticState: "{\"version\":1,\"lost\":true}" };

    const result = await inspectWorkspaceState(damaged);

    expect(result).toMatchObject({ status: "rescue", reason: "corrupted" });
    const rescued =
      result.status === "rescue"
        ? (JSON.parse(result.raw) as { semanticState?: string })
        : {};
    expect(rescued.semanticState).toContain("\"lost\":true");
  });

  it("does not reinterpret a future schema as an empty workspace", async () => {
    const future = {
      version: WORKSPACE_STATE_VERSION + 1,
      semanticState: "future",
    };

    await expect(inspectWorkspaceState(future)).resolves.toMatchObject({
      status: "rescue",
      reason: "unsupported",
      raw: expect.stringContaining("future"),
    });
  });

  it("checks multi-megabyte semantic records without truncating them", async () => {
    const semanticState = "x".repeat(10 * 1024 * 1024);
    const state = await createWorkspaceState({
      canvasSnapshot: { version: 1 },
      semanticState,
      writerId: "writer-large",
    });

    const result = await inspectWorkspaceState(state);

    expect(result.status).toBe("ready");
    expect(result.status === "ready" ? result.state.semanticState.length : 0).toBe(
      semanticState.length,
    );
  });
});
