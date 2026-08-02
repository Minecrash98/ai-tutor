import { learningProofAuditBundleSchema } from "@ai-tutor/contracts";

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
    consumeRealtimeRate(owner.ownerId, "learning-audit-read", 30);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const bundle = learningProofAuditBundleSchema.parse(
      await learningStore().getAuditBundle(owner.ownerId, sessionId),
    );
    return learningJson(bundle, {
      headers: {
        "Content-Disposition": `attachment; filename="learning-proof-audit-${sessionId}.json"`,
      },
    });
  } catch (error) {
    return learningErrorResponse(error);
  }
}
