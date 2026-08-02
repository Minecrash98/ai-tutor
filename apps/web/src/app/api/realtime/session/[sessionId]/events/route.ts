import { getRealtimeProvider } from "@/features/tutor/server/codex-realtime-provider";
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
    consumeRealtimeRate(owner.ownerId, "event-stream", 20);
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    throw error;
  }
  const provider = getRealtimeProvider();
  if (!provider.hasSession(sessionId)) {
    return Response.json(
      { code: "REALTIME_SESSION_NOT_FOUND", message: "Realtime 会话不存在。" },
      { status: 404 },
    );
  }

  const cursorHeader = request.headers.get("last-event-id");
  const cursorQuery = new URL(request.url).searchParams.get("cursor");
  const rawCursor = cursorHeader ?? cursorQuery;
  const afterEventId = rawCursor === null || rawCursor === "" ? null : Number(rawCursor);
  if (
    afterEventId !== null &&
    (!Number.isSafeInteger(afterEventId) || afterEventId < 0)
  ) {
    return Response.json(
      { code: "REALTIME_EVENT_CURSOR_INVALID", message: "连接恢复位置无效，请重新开始。" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const encoder = new TextEncoder();
  let cleanup = () => undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("retry: 1000\n\n"));
      const send = (event: unknown, eventId: number | null) => {
        controller.enqueue(
          encoder.encode(
            `${eventId === null ? "" : `id: ${eventId}\n`}data: ${JSON.stringify(event)}\n\n`,
          ),
        );
      };
      const unsubscribe = provider.subscribe(sessionId, send, afterEventId);
      const keepAlive = setInterval(() => {
        controller.enqueue(encoder.encode(": keepalive\n\n"));
      }, 15_000);
      cleanup = () => {
        clearInterval(keepAlive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // The browser may already have closed the stream.
        }
      };
      request.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
