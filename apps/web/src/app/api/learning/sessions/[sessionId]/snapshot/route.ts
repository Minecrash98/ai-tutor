import { saveLearningSnapshotRequestSchema } from "@ai-tutor/contracts";

import {
  learningErrorResponse,
  learningJson,
  learningStore,
  parseLearningSessionId,
} from "@/features/learning/server/learning-proof-route";
import {
  consumeRealtimeRate,
  readBoundedJson,
  requireRealtimeOwner,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const owner = requireRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-snapshot-save", 60);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const parsed = saveLearningSnapshotRequestSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 6 * 1_024 * 1_024,
        maxDepth: 16,
        maxKeys: 80_000,
      }),
    );
    if (!parsed.success) {
      return learningJson(
        {
          code: "LEARNING_SNAPSHOT_INVALID",
          message: "当前回放快照不完整，尚未覆盖已保存记录。",
        },
        { status: 400 },
      );
    }
    const snapshot = await learningStore().saveSnapshot(
      owner.ownerId,
      sessionId,
      parsed.data,
    );
    return learningJson(snapshot);
  } catch (error) {
    return learningErrorResponse(error);
  }
}
