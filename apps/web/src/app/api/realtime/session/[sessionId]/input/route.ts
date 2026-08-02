import { realtimeTextInputSchema } from "@ai-tutor/contracts";

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
    consumeRealtimeRate(owner.ownerId, "text-input", 30);
    const parsed = realtimeTextInputSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 8_192,
        maxDepth: 4,
        maxKeys: 8,
      }),
    );
    if (!parsed.success) {
      return Response.json(
        { code: "INVALID_REALTIME_TEXT", message: "请输入有效的文字问题。" },
        { status: 400 },
      );
    }
    await getRealtimeProvider().appendText(sessionId, parsed.data.text);
    return Response.json({ ok: true });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime text input failed", error);
    return Response.json(
      {
        code: "REALTIME_TEXT_FAILED",
        message: "文字消息发送失败，请重试。",
      },
      { status: 502 },
    );
  }
}
