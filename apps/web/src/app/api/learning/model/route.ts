import {
  learningErrorResponse,
  learningJson,
  learningStore,
} from "@/features/learning/server/learning-proof-route";
import {
  consumeRealtimeRate,
  establishRealtimeOwner,
  type RealtimeOwnerContext,
} from "@/features/tutor/server/realtime-request-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  let owner: RealtimeOwnerContext | null = null;
  try {
    owner = establishRealtimeOwner(request);
    consumeRealtimeRate(owner.ownerId, "learning-model-read", 60);
    return learningJson(
      await learningStore().getMinimalLearnerModel(owner.ownerId),
      {},
      owner,
    );
  } catch (error) {
    return learningErrorResponse(error, owner);
  }
}
