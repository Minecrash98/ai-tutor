import { NextResponse } from "next/server";

import { CodexAppServerError } from "@/features/tutor/server/codex-app-server-client";
import { checkTutorRealtimeCapabilities } from "@/features/tutor/server/realtime-capability-preflight";
import {
  consumeRealtimeRate,
  establishRealtimeOwner,
  realtimeBoundaryResponse,
  type RealtimeOwnerContext,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let owner: RealtimeOwnerContext | null = null;
  try {
    owner = establishRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "capability-check", 10);
    const result = await checkTutorRealtimeCapabilities();
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    if (owner.setCookie) response.headers.append("Set-Cookie", owner.setCookie);
    return response;
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    const code =
      error instanceof CodexAppServerError
        ? error.code
        : "REALTIME_PREFLIGHT_FAILED";
    const message =
      code === "CODEX_AUTH_REQUIRED"
        ? "请先在 Codex Desktop 中登录，再开始语音讲解。"
        : code === "CODEX_VOICE_NOT_AVAILABLE"
          ? "当前账户暂时不能使用语音，请选择文字问答。"
          : "暂时无法连接语音服务，请选择文字问答或稍后重试。";
    console.error("Realtime capability preflight failed", error);
    const response = NextResponse.json(
      { code, message },
      { status: code === "CODEX_AUTH_REQUIRED" ? 403 : 503 },
    );
    if (owner?.setCookie) response.headers.append("Set-Cookie", owner.setCookie);
    return response;
  }
}
