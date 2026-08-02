import { createLearningSessionRequestSchema } from "@ai-tutor/contracts";

import {
  learningErrorResponse,
  learningJson,
  learningStore,
} from "@/features/learning/server/learning-proof-route";
import {
  consumeRealtimeRate,
  establishRealtimeOwner,
  readBoundedJson,
  type RealtimeOwnerContext,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let owner: RealtimeOwnerContext | null = null;
  try {
    owner = establishRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-session-create", 20);
    const parsed = createLearningSessionRequestSchema.safeParse(
      await readBoundedJson(request, {
        maxBytes: 8_192,
        maxDepth: 4,
        maxKeys: 32,
      }),
    );
    if (!parsed.success) {
      return learningJson(
        {
          code: "LEARNING_SESSION_REQUEST_INVALID",
          message: "无法开始这份学习记录，请刷新后重试。",
        },
        { status: 400 },
        owner,
      );
    }
    const session = await learningStore().createSession(
      owner.ownerId,
      parsed.data,
    );
    return learningJson(session, { status: 201 }, owner);
  } catch (error) {
    return learningErrorResponse(error, owner);
  }
}
