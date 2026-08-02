import { createRealtimeSessionRequestSchema } from "@ai-tutor/contracts";
import { NextResponse } from "next/server";

import { CodexAppServerError } from "@/features/tutor/server/codex-app-server-client";
import { getRealtimeProvider } from "@/features/tutor/server/codex-realtime-provider";
import {
  LearningProofStoreError,
  getLearningProofStore,
} from "@/features/learning/server/learning-proof-store";
import { learningErrorResponse } from "@/features/learning/server/learning-proof-route";
import {
  bindRealtimeSessionOwner,
  consumeRealtimeRate,
  establishRealtimeOwner,
  readBoundedJson,
  realtimeBoundaryResponse,
  reserveRealtimeSession,
  type RealtimeOwnerContext,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let owner: RealtimeOwnerContext | null = null;
  let releaseReservation: () => void = () => undefined;
  try {
    owner = establishRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "session-start", 6);
    releaseReservation = reserveRealtimeSession(owner.ownerId);
    const parsed = createRealtimeSessionRequestSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 1_050_000,
        maxDepth: 6,
        maxKeys: 32,
      }),
    );
    if (!parsed.success) {
      const response = NextResponse.json(
        {
          code: "INVALID_REALTIME_SESSION_REQUEST",
          message: "学习会话的模式、主题或语音配置无效。",
        },
        { status: 400 },
      );
      if (owner.setCookie) response.headers.append("Set-Cookie", owner.setCookie);
      return response;
    }
    const learningProofStore = getLearningProofStore();
    let learningSessionId = parsed.data.learningSessionId ?? null;
    if (learningSessionId) {
      await learningProofStore.getCurrentLessonState(
        owner.ownerId,
        learningSessionId,
      );
    } else {
      learningSessionId = await learningProofStore.findLatestActiveSessionId(
        owner.ownerId,
      );
    }
    const sessionInput = learningSessionId
      ? { ...parsed.data, learningSessionId }
      : parsed.data;
    const session = await getRealtimeProvider().startSession(sessionInput, {
      learningOwnerId: owner.ownerId,
    });
    bindRealtimeSessionOwner(session.sessionId, owner.ownerId);
    const response = NextResponse.json(session, { status: 201 });
    if (owner.setCookie) response.headers.append("Set-Cookie", owner.setCookie);
    return response;
  } catch (error) {
    if (error instanceof LearningProofStoreError) {
      return learningErrorResponse(error, owner);
    }
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    const code =
      error instanceof CodexAppServerError
        ? error.code
        : "REALTIME_SESSION_FAILED";
    const publicMessages: Readonly<Record<string, string>> = {
      CODEX_AUTH_REQUIRED: "请先在 Codex Desktop 中登录，再重试。",
      CODEX_VOICE_NOT_AVAILABLE: "当前账户暂时不能使用语音，请选择文字问答。",
      CODEX_APP_SERVER_NOT_FOUND: "本机学习服务没有启动，请先打开 Codex Desktop。",
    };
    const message =
      publicMessages[code] ?? "AI 学习服务暂时不可用，请稍后重试。";
    const status =
      code === "CODEX_AUTH_REQUIRED" || code === "CODEX_VOICE_NOT_AVAILABLE"
        ? 403
        : code === "CODEX_APP_SERVER_NOT_FOUND"
          ? 503
          : 502;
    console.error("Realtime session startup failed", error);
    const response = NextResponse.json({ code, message }, { status });
    if (owner?.setCookie) response.headers.append("Set-Cookie", owner.setCookie);
    return response;
  } finally {
    releaseReservation();
  }
}
