import { describe, expect, it } from "vitest";

import {
  TUTOR_DISABLED_FEATURES,
  buildTutorCapabilityConfig,
  configuredMcpNames,
} from "./tutor-capability-profile";

describe("Tutor capability profile", () => {
  it("hard-disables every configured MCP and unrelated built-in capability", () => {
    const snapshot = {
      config: {
        mcp_servers: {
          blender: { command: "secret-command" },
          node_repl: { command: "secret-command" },
          openaiDeveloperDocs: { url: "https://example.invalid" },
          spineMCP: { command: "secret-command" },
        },
      },
    };

    const profile = buildTutorCapabilityConfig(snapshot);

    expect(configuredMcpNames(snapshot)).toEqual([
      "blender",
      "node_repl",
      "openaiDeveloperDocs",
      "spineMCP",
    ]);
    expect(profile.mcp_servers).toEqual({
      blender: { enabled: false },
      node_repl: { enabled: false },
      openaiDeveloperDocs: { enabled: false },
      spineMCP: { enabled: false },
    });
    expect(profile.features.realtime_conversation).toBe(true);
    expect(
      TUTOR_DISABLED_FEATURES.every(
        (feature) => profile.features[feature] === false,
      ),
    ).toBe(true);
    expect(profile).toMatchObject({
      agents: { enabled: false },
      apps: { _default: { enabled: false } },
      tools: { view_image: false, web_search: false },
      web_search: "disabled",
    });
    expect(JSON.stringify(profile)).not.toContain("secret-command");
  });
});
