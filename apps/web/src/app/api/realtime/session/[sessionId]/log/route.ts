import { getRealtimeSessionLog } from "@/features/tutor/server/realtime-session-log";
import {
  consumeRealtimeRate,
  realtimeBoundaryResponse,
  requireRealtimeOwner,
  requireRealtimeSessionOwner,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const owner = requireRealtimeOwner(request);
    requireRealtimeSessionOwner(sessionId, owner.ownerId);
    consumeRealtimeRate(owner.ownerId, "log-export", 20);
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    throw error;
  }
  const sessionLog = getRealtimeSessionLog();
  if (!(await sessionLog.hasLog(sessionId))) {
    return Response.json(
      { code: "REALTIME_LOG_NOT_FOUND", message: "这节课程还没有可用日志。" },
      { status: 404 },
    );
  }
  try {
    const exported = await sessionLog.export(sessionId);
    const format = new URL(request.url).searchParams.get("format");
    if (format === "ndjson") {
      const content = exported.records.map((record) => JSON.stringify(record)).join("\n");
      return new Response(`${content}\n`, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Disposition": `attachment; filename="ai-tutor-${sessionId}.ndjson"`,
          "Content-Type": "application/x-ndjson; charset=utf-8",
        },
      });
    }
    return new Response(JSON.stringify(exported, null, 2), {
      headers: {
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="ai-tutor-${sessionId}.json"`,
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Realtime log export failed", error);
    return Response.json(
      {
        code: "REALTIME_LOG_EXPORT_FAILED",
        message: "课程日志导出失败。",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const owner = requireRealtimeOwner(request);
    requireRealtimeSessionOwner(sessionId, owner.ownerId);
    consumeRealtimeRate(owner.ownerId, "log-delete", 10);
    await getRealtimeSessionLog().delete(sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime log deletion failed", error);
    return Response.json(
      { code: "REALTIME_LOG_DELETE_FAILED", message: "学习记录删除失败。" },
      { status: 500 },
    );
  }
}
