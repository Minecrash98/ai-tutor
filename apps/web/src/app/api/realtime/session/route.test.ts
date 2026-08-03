import { describe, expect, it, vi } from "vitest";

import { LearningProofStoreError } from "@/features/learning/server/learning-proof-store";

import { resolveRealtimeLearningSessionId } from "./route";

describe("resolveRealtimeLearningSessionId", () => {
  it("starts an unbound Tutor session when optional persistence is unavailable", async () => {
    const createStore = vi.fn(() => {
      throw new LearningProofStoreError(
        "LEARNING_DATABASE_UNAVAILABLE",
        503,
        "offline",
      );
    });

    await expect(
      resolveRealtimeLearningSessionId("owner-1", null, createStore),
    ).resolves.toBeNull();
  });

  it("still validates an explicitly requested learning session", async () => {
    const unavailable = new LearningProofStoreError(
      "LEARNING_DATABASE_UNAVAILABLE",
      503,
      "offline",
    );
    const createStore = vi.fn(() => {
      throw unavailable;
    });

    await expect(
      resolveRealtimeLearningSessionId(
        "owner-1",
        "8a7749f0-72ad-49b1-b974-b6b853257ab2",
        createStore,
      ),
    ).rejects.toBe(unavailable);
  });
});
