import { realtimeTutorCueRequestSchema } from "@ai-tutor/contracts";

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
    consumeRealtimeRate(owner.ownerId, "tutor-cue", 5);
    const parsed = realtimeTutorCueRequestSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 512,
        maxDepth: 3,
        maxKeys: 2,
      }),
    );
    if (!parsed.success) {
      return Response.json(
        { code: "INVALID_TUTOR_CUE", message: "这一步暂时无法继续。" },
        { status: 400 },
      );
    }
    await getRealtimeProvider().appendTutorCue(sessionId, parsed.data.cue);
    return Response.json({ ok: true });
  } catch (error) {
    const boundary = realtimeBoundaryResponse(error);
    if (boundary) return boundary;
    console.error("Realtime tutor cue failed", error);
    return Response.json(
      {
        code: "REALTIME_TUTOR_CUE_FAILED",
        message: "刚才的追问没有发出，请用文字继续。",
      },
      { status: 502 },
    );
  }
}
