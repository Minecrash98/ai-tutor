import {
  submitTransferAssessmentRequestSchema,
  submitTransferAssessmentResponseSchema,
  transferAssessmentListResponseSchema,
} from "@ai-tutor/contracts";

import {
  learningErrorResponse,
  learningJson,
  parseLearningSessionId,
} from "@/features/learning/server/learning-proof-route";
import { getTransferAssessmentStore } from "@/features/assessment/server/transfer-assessment-store";
import {
  consumeRealtimeRate,
  readBoundedJson,
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
    consumeRealtimeRate(owner.ownerId, "transfer-assessment-read", 120);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const result = await getTransferAssessmentStore().list(
      owner.ownerId,
      sessionId,
    );
    return learningJson(transferAssessmentListResponseSchema.parse(result));
  } catch (error) {
    return learningErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const owner = requireRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "transfer-assessment-submit", 30);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const input = submitTransferAssessmentRequestSchema.parse(
      await readBoundedJson(request, {
        maxBytes: 2_048,
        maxDepth: 3,
        maxKeys: 4,
      }),
    );
    const result = await getTransferAssessmentStore().submit(
      owner.ownerId,
      sessionId,
      input.itemId,
      input.answer,
    );
    return learningJson(
      submitTransferAssessmentResponseSchema.parse(result),
      { status: 201 },
    );
  } catch (error) {
    return learningErrorResponse(error);
  }
}
