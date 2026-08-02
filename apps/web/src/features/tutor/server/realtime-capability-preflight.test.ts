import { describe, expect, it } from "vitest";

import {
  CodexAppServerError,
  type CodexAppServerClient,
} from "./codex-app-server-client";
import { checkTutorRealtimeCapabilities } from "./realtime-capability-preflight";

class FakePreflightClient {
  readonly requests: string[] = [];
  started = false;
  closed = false;

  async start() {
    this.started = true;
  }

  async request<T>(method: string): Promise<T> {
    this.requests.push(method);
    if (method === "account/read") {
      return { account: { type: "chatgpt" }, requiresOpenaiAuth: true } as T;
    }
    if (method === "model/list") return { data: [{ id: "available" }] } as T;
    if (method === "thread/realtime/listVoices") {
      return { voices: { v1: [], v2: [] } } as T;
    }
    return {} as T;
  }

  async close() {
    this.closed = true;
  }
}

describe("Realtime capability preflight", () => {
  it("checks account, provider catalog, and voice support without a session", async () => {
    const fake = new FakePreflightClient();
    await expect(
      checkTutorRealtimeCapabilities(fake as unknown as CodexAppServerClient),
    ).resolves.toMatchObject({
      ready: true,
      textAvailable: true,
      voiceAvailable: true,
    });
    expect(fake.started).toBe(true);
    expect(fake.requests).toEqual([
      "account/read",
      "model/list",
      "thread/realtime/listVoices",
    ]);
    expect(fake.closed).toBe(true);
    expect(fake.requests).not.toContain("thread/realtime/start");
  });

  it("always closes the isolated app-server when the check fails", async () => {
    const fake = new FakePreflightClient();
    fake.request = async () => {
      throw new Error("offline");
    };
    await expect(
      checkTutorRealtimeCapabilities(fake as unknown as CodexAppServerClient),
    ).rejects.toThrow("offline");
    expect(fake.closed).toBe(true);
  });

  it("retries once with a fresh client after a transient app-server exit", async () => {
    const first = new FakePreflightClient();
    first.start = async () => {
      first.started = true;
      throw new CodexAppServerError(
        "process exited",
        "CODEX_APP_SERVER_EXITED",
      );
    };
    const second = new FakePreflightClient();
    const clients = [first, second];
    let created = 0;

    await expect(
      checkTutorRealtimeCapabilities({
        createClient: () =>
          clients[created++] as unknown as CodexAppServerClient,
        retryDelayMs: 0,
      }),
    ).resolves.toMatchObject({ ready: true });

    expect(created).toBe(2);
    expect(first.closed).toBe(true);
    expect(second.closed).toBe(true);
  });

  it("does not retry account, model, or voice capability failures", async () => {
    const fake = new FakePreflightClient();
    fake.start = async () => {
      fake.started = true;
      throw new CodexAppServerError("login required", "CODEX_AUTH_REQUIRED");
    };
    let created = 0;

    await expect(
      checkTutorRealtimeCapabilities({
        createClient: () => {
          created += 1;
          return fake as unknown as CodexAppServerClient;
        },
        retryDelayMs: 0,
      }),
    ).rejects.toMatchObject({ code: "CODEX_AUTH_REQUIRED" });

    expect(created).toBe(1);
    expect(fake.closed).toBe(true);
  });
});
