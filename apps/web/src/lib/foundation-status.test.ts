import { describe, expect, it } from "vitest";

import { foundationStatus } from "./foundation-status";

describe("P8 phase boundary", () => {
  it("records P7 capabilities while P8 acceptance is active", () => {
    expect(foundationStatus.phase).toBe("P8");
    expect(foundationStatus.nextPhase).toBe("Competition readiness");
    expect(foundationStatus.enabledCapabilities).toContain("teaching-canvas");
    expect(foundationStatus.enabledCapabilities).toContain("sandboxed-runtime");
    expect(foundationStatus.enabledCapabilities).toContain(
      "element-selection",
    );
    expect(foundationStatus.enabledCapabilities).toContain("css-controls");
    expect(foundationStatus.enabledCapabilities).toContain("realtime-ai");
    expect(foundationStatus.enabledCapabilities).toContain(
      "postgresql-authoritative-persistence",
    );
    expect(foundationStatus.enabledCapabilities).toContain(
      "learning-proof-replay",
    );
    expect(foundationStatus.deferredCapabilities).toContain("deployment");
  });
});
