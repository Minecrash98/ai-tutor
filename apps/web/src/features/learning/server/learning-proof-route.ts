import { z } from "zod";

import {
  LearningProofStoreError,
  getLearningProofStore,
} from "./learning-proof-store";
import {
  realtimeBoundaryResponse,
  type RealtimeOwnerContext,
} from "@/features/tutor/server/realtime-request-guard";

const sessionIdSchema = z.string().uuid();

export function parseLearningSessionId(value: string): string {
  const parsed = sessionIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new LearningProofStoreError(
      "LEARNING_SESSION_ID_INVALID",
      400,
      "学习记录编号无效。",
    );
  }
  return parsed.data;
}

export function learningJson(
  value: unknown,
  init: ResponseInit = {},
  owner?: RealtimeOwnerContext | null,
): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  headers.set("Content-Type", "application/json; charset=utf-8");
  if (owner?.setCookie) headers.append("Set-Cookie", owner.setCookie);
  return new Response(JSON.stringify(value), { ...init, headers });
}

export function learningErrorResponse(
  error: unknown,
  owner?: RealtimeOwnerContext | null,
): Response {
  const boundary = realtimeBoundaryResponse(error);
  if (boundary) {
    if (owner?.setCookie) boundary.headers.append("Set-Cookie", owner.setCookie);
    return boundary;
  }
  if (error instanceof LearningProofStoreError) {
    return learningJson(
      { code: error.code, message: error.message },
      { status: error.status },
      owner,
    );
  }
  const postgresCode = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return null;
    if ("code" in value && value.code) return value.code;
    return "cause" in value ? postgresCode(value.cause) : null;
  };
  if (postgresCode(error) === "53100") {
    return learningJson(
      {
        code: "LEARNING_STORAGE_FULL",
        message: "学习记录空间暂时不足；当前操作仍保存在这台设备，请稍后重试。",
      },
      { status: 507, headers: { "Retry-After": "5" } },
      owner,
    );
  }
  console.error("Learning proof request failed", error);
  return learningJson(
    {
      code: "LEARNING_RECORD_FAILED",
      message: "学习记录暂时不可用；当前操作仍保存在这台设备。",
    },
    { status: 500 },
    owner,
  );
}

export function learningStore() {
  return getLearningProofStore();
}
