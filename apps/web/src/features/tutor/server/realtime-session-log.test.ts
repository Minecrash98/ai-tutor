import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { RealtimeSessionLog } from "./realtime-session-log";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createLog() {
  const root = await mkdtemp(path.join(tmpdir(), "ai-tutor-realtime-log-"));
  temporaryRoots.push(root);
  return new RealtimeSessionLog(root);
}

describe("realtime session log", () => {
  it("persists ordered records and redacts credentials and raw SDP", async () => {
    const sessionId = randomUUID();
    const log = await createLog();
    await log.setConsent(sessionId, true);

    await log.record(sessionId, "next-server", "session.start_requested", {
      oauthToken: "do-not-store",
      sdp: "v=0 raw offer",
      localSdpLength: 13,
      stderr: "authorization: Bearer private-value and sk-1234567890abcdef",
    });
    await log.record(sessionId, "browser", "microphone.level", {
      rms: 0.25,
      peak: 0.5,
    });

    const exported = await log.export(sessionId);
    expect(exported.records.map((record) => record.sequence)).toEqual([1, 2]);
    expect(exported.records[0]?.payload).toEqual({
      oauthToken: "[REDACTED]",
      sdp: "[REDACTED]",
      localSdpLength: 13,
      stderr:
        "authorization: Bearer [REDACTED] and [REDACTED API KEY]",
    });
  });

  it("builds transcript, teaching actions, and issues for course summaries", async () => {
    const sessionId = randomUUID();
    const log = await createLog();
    await log.setConsent(sessionId, true);

    await log.record(sessionId, "next-server", "text.input.accepted", {
      role: "user",
      text: "padding 改变了什么？",
    });
    await log.record(sessionId, "tool-executor", "tool.call", {
      requestId: "request-1",
      tool: "create_demo_block",
      arguments: { topic: "box-model" },
    });
    await log.record(
      sessionId,
      "tool-executor",
      "tool.result",
      {
        requestId: "request-1",
        result: { success: true, message: "已创建演示块 demo-1。" },
      },
    );
    await log.record(
      sessionId,
      "next-server",
      "realtime.error",
      { message: "example failure" },
      "error",
    );

    const material = (await log.export(sessionId)).courseSummaryMaterial;
    expect(material.transcript).toEqual([
      expect.objectContaining({
        role: "user",
        text: "padding 改变了什么？",
        source: "text",
      }),
    ]);
    expect(material.teachingActions).toEqual([
      expect.objectContaining({
        requestId: "request-1",
        tool: "create_demo_block",
        result: { success: true, message: "已创建演示块 demo-1。" },
      }),
    ]);
    expect(material.issues).toEqual([
      expect.objectContaining({ event: "realtime.error", message: "example failure" }),
    ]);
  });

  it("writes nothing before consent and deletes a consented record on request", async () => {
    const sessionId = randomUUID();
    const log = await createLog();

    await log.record(sessionId, "next-server", "text.input.accepted", {
      text: "student@example.com 13812345678",
    });
    expect(await log.hasLog(sessionId)).toBe(false);

    await log.setConsent(sessionId, true);
    await log.record(sessionId, "next-server", "text.input.accepted", {
      text: "student@example.com 13812345678",
    });
    expect((await log.export(sessionId)).records[0]?.payload.text).toBe(
      "[REDACTED EMAIL] [REDACTED PHONE]",
    );
    await log.delete(sessionId);
    expect(await log.hasLog(sessionId)).toBe(false);
  });

  it("stores an explicit opt-out as a short operational record with no content", async () => {
    const sessionId = randomUUID();
    const log = await createLog();
    await log.setConsent(sessionId, false);
    await log.record(sessionId, "next-server", "session.start_failed", {
      mode: "text",
      code: "CODEX_APP_SERVER_EXITED",
      latencyMs: 412,
      retryable: true,
      text: "student@example.com 13812345678",
      message: "C:\\Users\\Student\\private.txt",
      arguments: { selector: "#private" },
      userAgent: "fingerprint",
    });

    const exported = await log.export(sessionId);
    expect(exported.recordKind).toBe("operational");
    expect(exported.records).toHaveLength(1);
    expect(exported.records[0]?.payload).toEqual({
      mode: "text",
      code: "CODEX_APP_SERVER_EXITED",
      latencyMs: 412,
      retryable: true,
    });
    expect(exported.courseSummaryMaterial).toEqual({
      transcript: [],
      teachingActions: [],
      issues: [
        expect.objectContaining({
          event: "session.start_failed",
          message: "session.start_failed",
        }),
      ],
    });
    await log.delete(sessionId);
    expect(await log.hasLog(sessionId)).toBe(false);
    await log.record(sessionId, "next-server", "session.closed", {
      latencyMs: 1,
    });
    expect(await log.hasLog(sessionId)).toBe(false);
  });
});
