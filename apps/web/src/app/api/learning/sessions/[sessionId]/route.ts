import {
  learningErrorResponse,
  learningJson,
  learningStore,
  parseLearningSessionId,
} from "@/features/learning/server/learning-proof-route";
import {
  consumeRealtimeRate,
  requireRealtimeOwner,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const owner = requireRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-replay-read", 120);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const replay = await learningStore().getReplay(owner.ownerId, sessionId);
    const download = new URL(request.url).searchParams.get("download") === "1";
    return learningJson(
      replay,
      download
        ? {
            headers: {
              "Content-Disposition": `attachment; filename="learning-proof-${sessionId}.json"`,
            },
          }
        : {},
    );
  } catch (error) {
    return learningErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const owner = requireRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-session-delete", 30);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const result = await learningStore().deleteSession(owner.ownerId, sessionId);
    return learningJson(result, {}, owner);
  } catch (error) {
    return learningErrorResponse(error);
  }
}
