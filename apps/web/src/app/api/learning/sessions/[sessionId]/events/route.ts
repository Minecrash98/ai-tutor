import { appendLearningEventsRequestSchema } from "@ai-tutor/contracts";

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

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const owner = requireRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-event-append", 240);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const parsed = appendLearningEventsRequestSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 256 * 1_024,
        maxDepth: 8,
        maxKeys: 4_000,
      }),
    );
    if (!parsed.success) {
      return learningJson(
        {
          code: "LEARNING_EVENTS_INVALID",
          message: "有一个学习步骤无法识别，尚未写入记录。",
        },
        { status: 400 },
      );
    }
    const result = await learningStore().appendEvents(
      owner.ownerId,
      sessionId,
      parsed.data,
    );
    return learningJson(result);
  } catch (error) {
    return learningErrorResponse(error);
  }
}
