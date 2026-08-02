import {
  createLearningEvidenceAnalysisRequestSchema,
  createLearningEvidenceAnalysisResponseSchema,
  learningEvidenceAnalysisListResponseSchema,
} from "@ai-tutor/contracts";

import {
  learningErrorResponse,
  learningJson,
  parseLearningSessionId,
} from "@/features/learning/server/learning-proof-route";
import { getLearningProofStore } from "@/features/learning/server/learning-proof-store";
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
    consumeRealtimeRate(owner.ownerId, "learning-analysis-read", 120);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const result = await getLearningProofStore().listEvidenceAnalyses(
      owner.ownerId,
      sessionId,
    );
    return learningJson(learningEvidenceAnalysisListResponseSchema.parse(result));
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
    consumeRealtimeRate(owner.ownerId, "learning-analysis-create", 30);
    const sessionId = parseLearningSessionId((await context.params).sessionId);
    const input = createLearningEvidenceAnalysisRequestSchema.parse(
      await readBoundedJson(request, {
        maxBytes: 512,
        maxDepth: 2,
        maxKeys: 2,
      }),
    );
    const result = await getLearningProofStore().createEvidenceAnalysis(
      owner.ownerId,
      sessionId,
      input.mode,
    );
    return learningJson(
      createLearningEvidenceAnalysisResponseSchema.parse(result),
      { status: result.created ? 201 : 200 },
    );
  } catch (error) {
    return learningErrorResponse(error);
  }
}
