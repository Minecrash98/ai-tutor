import { realtimeToolResultSchema } from "@ai-tutor/contracts";

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
  context: { params: Promise<{ sessionId: string; requestId: string }> },
) {
  const { sessionId, requestId } = await context.params;
  try {
    const owner = requireRealtimeOwner(request);
    requireRealtimeSessionOwner(sessionId, owner.ownerId);
    consumeRealtimeRate(owner.ownerId, "tool-result", 120);
    const parsed = realtimeToolResultSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 8_192,
        maxDepth: 4,
        maxKeys: 8,
      }),
    );
    if (!parsed.success) {
      return Response.json(
        { code: "INVALID_TOOL_RESULT", message: "教学工具结果格式无效。" },
        { status: 400 },
      );
    }
    await getRealtimeProvider().completeTool(sessionId, requestId, parsed.data);
    return Response.json({ ok: true });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime tool result failed", error);
    return Response.json(
      {
        code: "TOOL_RESULT_NOT_ACCEPTED",
        message: "这次画布操作没有被接受，请重试当前步骤。",
      },
      { status: 409 },
    );
  }
}
