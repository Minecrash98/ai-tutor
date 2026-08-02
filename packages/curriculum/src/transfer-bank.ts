import type { CurriculumCourseId } from "./schema";

export interface HiddenTransferManifestEntry {
  readonly itemId: string;
  readonly courseId: CurriculumCourseId;
  readonly sha256: string;
  readonly visibility: "server-hidden";
  readonly kind: "immediate-hidden" | "delayed-retention";
  readonly dueWindowHours: readonly [24, 72] | null;
}

export const HIDDEN_TRANSFER_MANIFEST: readonly HiddenTransferManifestEntry[] =
  Object.freeze([
    {
      itemId: "box-transfer-b-1",
      courseId: "box-model-v1",
      sha256: "7ef009aaf125fa750b25910b9d57fa1f6977e3d39bef68226ba57f9e97b23bef",
      visibility: "server-hidden",
      kind: "immediate-hidden",
      dueWindowHours: null,
    },
    {
      itemId: "box-transfer-b-2",
      courseId: "box-model-v1",
      sha256: "78a139fe02c464d9ecdb1fbb762c5147bf3346f1515283d88fc6089ae40820f2",
      visibility: "server-hidden",
      kind: "delayed-retention",
      dueWindowHours: [24, 72],
    },
    {
      itemId: "flex-transfer-b-1",
      courseId: "flex-v1",
      sha256: "60d0169558eff59cc6b971448a1bb27ddb2dc04917ee433599669cffc9637053",
      visibility: "server-hidden",
      kind: "immediate-hidden",
      dueWindowHours: null,
    },
    {
      itemId: "flex-transfer-b-2",
      courseId: "flex-v1",
      sha256: "598f6c6f79cbac856a2e70be6c52fdf50452f99fba9f33de971280cfe916b4e8",
      visibility: "server-hidden",
      kind: "delayed-retention",
      dueWindowHours: [24, 72],
    },
    {
      itemId: "positioning-transfer-b-1",
      courseId: "positioning-v1",
      sha256: "f5ee2c03453f481a5193b409ba392b080fd670203b7843e52246a2a7b3f9be92",
      visibility: "server-hidden",
      kind: "immediate-hidden",
      dueWindowHours: null,
    },
    {
      itemId: "positioning-transfer-b-2",
      courseId: "positioning-v1",
      sha256: "8857ccb99f1405803c1f4af69a9244f05b53e7fe0d981648940eeab8dafa784c",
      visibility: "server-hidden",
      kind: "delayed-retention",
      dueWindowHours: [24, 72],
    },
  ]);

export function scheduleDelayedTransfer(
  completedAt: string,
  delayHours: number,
): string {
  if (!Number.isInteger(delayHours) || delayHours < 24 || delayHours > 72) {
    throw new Error("delayed transfer must be scheduled between 24 and 72 hours");
  }
  const completedMs = Date.parse(completedAt);
  if (!Number.isFinite(completedMs)) throw new Error("invalid completion time");
  return new Date(completedMs + delayHours * 60 * 60 * 1_000).toISOString();
}
