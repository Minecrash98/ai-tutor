import { describe, expect, it } from "vitest";

import { learningErrorResponse } from "./learning-proof-route";

describe("learning proof error boundary", () => {
  it("maps PostgreSQL disk-full errors to a retryable sanitized response", async () => {
    const response = learningErrorResponse({
      message: "Failed query with private SQL",
      cause: {
        code: "53100",
        message: "could not extend file /secret/database/path",
        detail: "raw database detail",
      },
    });
    expect(response.status).toBe(507);
    expect(response.headers.get("Retry-After")).toBe("5");
    expect(await response.json()).toEqual({
      code: "LEARNING_STORAGE_FULL",
      message: "学习记录空间暂时不足；当前操作仍保存在这台设备，请稍后重试。",
    });
  });
});
