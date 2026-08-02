export interface CodexConfigSnapshot {
  readonly config?: {
    readonly mcp_servers?: Readonly<Record<string, unknown>>;
  };
}

export const TUTOR_DISABLED_FEATURES = [
  "apps",
  "auth_elicitation",
  "hooks",
  "js_repl",
  "memories",
  "multi_agent",
  "remote_plugin",
  "shell_tool",
  "tool_suggest",
] as const;

export function configuredMcpNames(snapshot: CodexConfigSnapshot): readonly string[] {
  return Object.keys(snapshot.config?.mcp_servers ?? {}).sort();
}

export function buildTutorCapabilityConfig(snapshot: CodexConfigSnapshot) {
  const mcpServers = Object.fromEntries(
    configuredMcpNames(snapshot).map((name) => [name, { enabled: false }]),
  );
  const disabledFeatures = Object.fromEntries(
    TUTOR_DISABLED_FEATURES.map((feature) => [feature, false] as const),
  ) as Record<(typeof TUTOR_DISABLED_FEATURES)[number], false>;

  return {
    agents: { enabled: false },
    apps: {
      _default: {
        destructive_enabled: false,
        enabled: false,
        open_world_enabled: false,
      },
    },
    features: {
      ...disabledFeatures,
      realtime_conversation: true,
    },
    mcp_servers: mcpServers,
    tools: { view_image: false, web_search: false },
    web_search: "disabled",
  } as const;
}
