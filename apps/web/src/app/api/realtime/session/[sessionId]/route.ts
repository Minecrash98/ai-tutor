import { getRealtimeProvider } from "@/features/tutor/server/codex-realtime-provider";
import {
  consumeRealtimeRate,
  realtimeBoundaryResponse,
  releaseRealtimeSessionOwner,
  requireRealtimeOwner,
  requireRealtimeSessionOwner,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await context.params;
  try {
    const owner = requireRealtimeOwner(request);
    requireRealtimeSessionOwner(sessionId, owner.ownerId);
    consumeRealtimeRate(owner.ownerId, "session-stop", 20);
    const provider = getRealtimeProvider();
    if (provider.hasSession(sessionId)) await provider.stopSession(sessionId);
    releaseRealtimeSessionOwner(sessionId);
    return Response.json({ ok: true });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime session stop failed", error);
    return Response.json(
      { code: "REALTIME_STOP_FAILED", message: "暂时无法结束会话，请再试一次。" },
      { status: 500 },
    );
  }
}
