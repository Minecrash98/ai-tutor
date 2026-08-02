import { realtimeClientDiagnosticBatchSchema } from "@ai-tutor/contracts";

import { getRealtimeSessionLog } from "@/features/tutor/server/realtime-session-log";
import { getRealtimeProvider } from "@/features/tutor/server/codex-realtime-provider";
import {
  consumeRealtimeRate,
  readBoundedJson,
  realtimeBoundaryResponse,
  requireRealtimeOwner,
  requireRealtimeSessionOwner,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const owner = requireRealtimeOwner(request);
    requireRealtimeSessionOwner(sessionId, owner.ownerId);
    consumeRealtimeRate(owner.ownerId, "diagnostics", 60);
    if (!getRealtimeProvider().hasSession(sessionId)) {
      return Response.json(
        { code: "REALTIME_SESSION_NOT_FOUND", message: "这次学习会话已结束。" },
        { status: 404 },
      );
    }
    const parsed = realtimeClientDiagnosticBatchSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 65_536,
        maxDepth: 8,
        maxKeys: 1_000,
      }),
    );
    if (!parsed.success) {
      return Response.json(
        {
          code: "INVALID_REALTIME_DIAGNOSTICS",
          message: "浏览器诊断日志格式无效。",
        },
        { status: 400 },
      );
    }
    await getRealtimeSessionLog().recordBrowserEvents(sessionId, parsed.data.events);
    return Response.json({ ok: true, accepted: parsed.data.events.length });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime diagnostics write failed", error);
    return Response.json(
      {
        code: "REALTIME_LOG_WRITE_FAILED",
        message: "浏览器诊断日志写入失败。",
      },
      { status: 500 },
    );
  }
}
