import { afterEach, describe, expect, it, vi } from "vitest";

import {
  bindRealtimeSessionOwner,
  consumeRealtimeRate,
  establishRealtimeOwner,
  readBoundedJson,
  REALTIME_OWNER_TTL_MS,
  releaseRealtimeSessionOwner,
  requireRealtimeOwner,
  requireRealtimeSessionOwner,
  reserveRealtimeSession,
  resetRealtimeRequestGuardForTests,
} from "./realtime-request-guard";

afterEach(() => {
  vi.useRealTimers();
  resetRealtimeRequestGuardForTests();
});

describe("Realtime request boundary", () => {
  it("issues an HttpOnly owner cookie and rejects cross-site requests", () => {
    const first = establishRealtimeOwner(
      new Request("http://127.0.0.1:3000/api/realtime/session", {
        headers: { origin: "http://127.0.0.1:3000" },
      }),
    );
    expect(first.setCookie).toMatch(/HttpOnly.*SameSite=Strict/);
    const cookie = first.setCookie!.split(";", 1)[0]!;
    expect(
      requireRealtimeOwner(
        new Request("http://127.0.0.1:3000/api/realtime/session/id", {
          headers: { cookie, origin: "http://127.0.0.1:3000" },
        }),
      ).ownerId,
    ).toBe(first.ownerId);
    expect(() =>
      establishRealtimeOwner(
        new Request("http://127.0.0.1:3000/api/realtime/session", {
          headers: { origin: "https://attacker.invalid" },
        }),
      ),
    ).toThrow("跨站请求已被拒绝");
  });

  it("binds every session to one owner", () => {
    bindRealtimeSessionOwner("session-1", "owner-a");
    expect(() => requireRealtimeSessionOwner("session-1", "owner-a")).not.toThrow();
    expect(() => requireRealtimeSessionOwner("session-1", "owner-b")).toThrow(
      "不属于当前页面",
    );
  });

  it("counts pending and active starts, then releases each reservation once", () => {
    const releaseFirst = reserveRealtimeSession("owner-a");
    const releaseSecond = reserveRealtimeSession("owner-a");
    expect(() => reserveRealtimeSession("owner-a")).toThrow(
      "请先结束正在进行的学习会话",
    );
    releaseFirst();
    releaseFirst();
    const releaseReplacement = reserveRealtimeSession("owner-a");
    releaseSecond();
    releaseReplacement();

    bindRealtimeSessionOwner("session-1", "owner-a");
    bindRealtimeSessionOwner("session-2", "owner-a");
    expect(() => reserveRealtimeSession("owner-a")).toThrow(
      "请先结束正在进行的学习会话",
    );
    releaseRealtimeSessionOwner("session-1");
    expect(() => reserveRealtimeSession("owner-a")).not.toThrow();
  });

  it("enforces rate windows and expires owner bindings after their TTL", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T00:00:00.000Z"));
    consumeRealtimeRate("owner-a", "input", 2, 1_000);
    consumeRealtimeRate("owner-a", "input", 2, 1_000);
    expect(() => consumeRealtimeRate("owner-a", "input", 2, 1_000)).toThrow(
      "操作太快了",
    );
    vi.advanceTimersByTime(1_001);
    expect(() => consumeRealtimeRate("owner-a", "input", 2, 1_000)).not.toThrow();

    bindRealtimeSessionOwner("session-ttl", "owner-a");
    expect(() =>
      requireRealtimeSessionOwner("session-ttl", "owner-a"),
    ).not.toThrow();
    vi.advanceTimersByTime(REALTIME_OWNER_TTL_MS + 1);
    expect(() =>
      requireRealtimeSessionOwner("session-ttl", "owner-a"),
    ).toThrow("不属于当前页面");
  });

  it("rejects JSON by bytes, depth, and key count before schema parsing", async () => {
    const options = { maxBytes: 32, maxDepth: 3, maxKeys: 4 };
    await expect(
      readBoundedJson(
        new Request("http://127.0.0.1:3000", {
          method: "POST",
          body: JSON.stringify({ value: "x".repeat(40) }),
        }),
        options,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readBoundedJson(
        new Request("http://127.0.0.1:3000", {
          method: "POST",
          body: JSON.stringify({ a: { b: { c: { d: true } } } }),
        }),
        { ...options, maxBytes: 128 },
      ),
    ).rejects.toMatchObject({ code: "REALTIME_JSON_TOO_DEEP" });
    await expect(
      readBoundedJson(
        new Request("http://127.0.0.1:3000", {
          method: "POST",
          body: JSON.stringify({ a: 1, b: 2, c: 3, d: 4, e: 5 }),
        }),
        { ...options, maxBytes: 128 },
      ),
    ).rejects.toMatchObject({ code: "REALTIME_JSON_TOO_COMPLEX" });
  });
});
