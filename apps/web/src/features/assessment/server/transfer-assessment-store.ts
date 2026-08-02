import type {
  LearningReplayBundle,
  SubmitTransferAssessmentResponse,
  TransferAssessmentItem,
  TransferAssessmentListResponse,
  TransferAssessmentStatus,
} from "@ai-tutor/contracts";
import { HIDDEN_TRANSFER_MANIFEST } from "@ai-tutor/curriculum";
import { and, desc, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import { createDatabase, type Database } from "@/db";
import {
  transferAssessmentAssignments,
  transferAssessmentAttempts,
} from "@/db/schema";
import {
  LearningProofStoreError,
  getLearningProofStore,
} from "@/features/learning/server/learning-proof-store";

import {
  hiddenTransferById,
  hiddenTransferHash,
  hiddenTransfersForCourse,
  type HiddenTransferDefinition,
} from "./hidden-transfer-items";

const HOUR_MS = 60 * 60 * 1_000;

interface LearningReplayReader {
  getReplay(ownerId: string, sessionId: string): Promise<LearningReplayBundle>;
}

function fail(code: string, status: number, message: string): never {
  throw new LearningProofStoreError(code, status, message);
}

function manifestEntry(item: HiddenTransferDefinition) {
  const manifest = HIDDEN_TRANSFER_MANIFEST.find(
    (entry) => entry.itemId === item.itemId,
  );
  const actualHash = hiddenTransferHash(item);
  if (
    !manifest ||
    manifest.courseId !== item.courseId ||
    manifest.kind !== item.kind ||
    manifest.sha256 !== actualHash
  ) {
    fail(
      "TRANSFER_ITEM_MANIFEST_MISMATCH",
      500,
      "迁移题未通过冻结清单校验，已停止出题。",
    );
  }
  return { manifest, actualHash };
}

export interface TransferAnswerEvaluation {
  readonly passed: boolean;
  readonly normalizedAnswer: string | null;
  readonly feedback: string;
}

function pxNumber(value: string): number | null {
  const match = value.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function matchesExpectedValue(
  item: HiddenTransferDefinition,
  value: string,
): boolean {
  if (item.evaluationRule === "keyword-v1") {
    return value === item.expectedValue;
  }
  const expected = pxNumber(item.expectedValue);
  if (expected === null) return false;
  const tokens = value.split(/\s+/).filter(Boolean);
  if (item.evaluationRule === "uniform-padding-px-v1") {
    return (
      tokens.length >= 1 &&
      tokens.length <= 4 &&
      tokens.every((token) => pxNumber(token) === expected)
    );
  }
  if (item.evaluationRule === "horizontal-gap-px-v1") {
    return (
      (tokens.length === 1 && pxNumber(tokens[0] ?? "") === expected) ||
      (tokens.length === 2 && pxNumber(tokens[1] ?? "") === expected)
    );
  }
  return false;
}

export function evaluateHiddenTransferAnswer(
  item: HiddenTransferDefinition,
  answer: string,
): TransferAnswerEvaluation {
  const withoutComments = answer.replace(/\/\*[\s\S]*?\*\//g, " ").trim();
  const match = withoutComments.match(
    /^([a-z-]+)\s*:\s*([^;{}]+?)\s*;?$/i,
  );
  if (!match?.[1] || !match[2]) {
    return {
      passed: false,
      normalizedAnswer: null,
      feedback: "只写一条“属性: 值;”格式的 CSS 声明，不要写选择器或多条规则。",
    };
  }
  const property = match[1].toLowerCase();
  const value = match[2].trim().replace(/\s+/g, " ").toLowerCase();
  const normalizedAnswer = `${property}: ${value};`;
  if (property !== item.expectedProperty) {
    return {
      passed: false,
      normalizedAnswer,
      feedback: "这条声明改了别的属性。回到题目里的空间或排列线索，再试一次。",
    };
  }
  if (!matchesExpectedValue(item, value)) {
    return {
      passed: false,
      normalizedAnswer,
      feedback: "属性找对了，但值还没有达到新页面的目标。请根据题目给出的数值或位置再检查。",
    };
  }
  return {
    passed: true,
    normalizedAnswer,
    feedback: "这条声明在陌生页面上通过了确定性检查。",
  };
}

export function transferAssessmentStatus(
  assignment: {
    readonly assessmentKind: string;
    readonly dueAt: Date | null;
    readonly closesAt: Date | null;
    readonly passedAt: Date | null;
    readonly passedInWindow: boolean | null;
  },
  now: Date,
): TransferAssessmentStatus {
  if (assignment.passedAt) {
    return assignment.passedInWindow === false
      ? "passed-late"
      : "passed-on-time";
  }
  if (
    assignment.assessmentKind === "delayed-retention" &&
    assignment.dueAt &&
    now < assignment.dueAt
  ) {
    return "locked";
  }
  return "available";
}

export class TransferAssessmentStore {
  constructor(
    private readonly database: Database,
    private readonly learningProof: LearningReplayReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async ensureAssignments(
    ownerId: string,
    sessionId: string,
  ): Promise<LearningReplayBundle> {
    const replay = await this.learningProof.getReplay(ownerId, sessionId);
    if (replay.session.status !== "completed" || !replay.session.endedAt) {
      fail(
        "TRANSFER_ASSESSMENT_LESSON_INCOMPLETE",
        409,
        "先完成当前小课，新的迁移挑战才会出现。",
      );
    }
    const items = hiddenTransfersForCourse(replay.session.lessonKind);
    if (items.length !== 2) {
      fail(
        "TRANSFER_ASSESSMENT_BANK_INCOMPLETE",
        500,
        "这门课的迁移题库不完整，已停止出题。",
      );
    }
    const completedAt = new Date(replay.session.endedAt);
    const values = items.map((item) => {
      const { actualHash } = manifestEntry(item);
      const delayed = item.kind === "delayed-retention";
      return {
        sessionId,
        itemId: item.itemId,
        itemHash: actualHash,
        assessmentKind: item.kind,
        dueAt: delayed
          ? new Date(completedAt.getTime() + 24 * HOUR_MS)
          : null,
        closesAt: delayed
          ? new Date(completedAt.getTime() + 72 * HOUR_MS)
          : null,
      };
    });
    await this.database
      .insert(transferAssessmentAssignments)
      .values(values)
      .onConflictDoNothing();
    const stored = await this.database
      .select()
      .from(transferAssessmentAssignments)
      .where(eq(transferAssessmentAssignments.sessionId, sessionId));
    if (
      stored.length !== 2 ||
      stored.some((assignment) => {
        const item = hiddenTransferById(assignment.itemId);
        return (
          !item ||
          item.courseId !== replay.session.lessonKind ||
          item.kind !== assignment.assessmentKind ||
          hiddenTransferHash(item) !== assignment.itemHash
        );
      })
    ) {
      fail(
        "TRANSFER_ASSESSMENT_ASSIGNMENT_MISMATCH",
        500,
        "迁移题分配与冻结清单不一致，已停止出题。",
      );
    }
    return replay;
  }

  async list(
    ownerId: string,
    sessionId: string,
  ): Promise<TransferAssessmentListResponse> {
    const replay = await this.ensureAssignments(ownerId, sessionId);
    const now = this.now();
    const assignments = await this.database
      .select()
      .from(transferAssessmentAssignments)
      .where(eq(transferAssessmentAssignments.sessionId, sessionId));
    const items: TransferAssessmentItem[] = [];
    for (const assignment of assignments.sort((left, right) =>
      left.assessmentKind.localeCompare(right.assessmentKind),
    )) {
      const item = hiddenTransferById(assignment.itemId);
      if (!item) {
        fail(
          "TRANSFER_ASSESSMENT_ITEM_MISSING",
          500,
          "冻结的迁移题已经缺失，已停止出题。",
        );
      }
      const status = transferAssessmentStatus(assignment, now);
      let revealedAt = assignment.revealedAt;
      if (status !== "locked" && !revealedAt) {
        const updated = await this.database
          .update(transferAssessmentAssignments)
          .set({ revealedAt: now })
          .where(
            and(
              eq(transferAssessmentAssignments.id, assignment.id),
              sql`${transferAssessmentAssignments.revealedAt} is null`,
            ),
          )
          .returning({ revealedAt: transferAssessmentAssignments.revealedAt });
        revealedAt = updated[0]?.revealedAt ?? now;
      }
      const attempts = await this.database
        .select({ sequence: transferAssessmentAttempts.attemptSequence })
        .from(transferAssessmentAttempts)
        .where(eq(transferAssessmentAttempts.assignmentId, assignment.id));
      items.push({
        itemId: item.itemId,
        courseId: item.courseId,
        kind: item.kind,
        status,
        dueAt: assignment.dueAt?.toISOString() ?? null,
        closesAt: assignment.closesAt?.toISOString() ?? null,
        revealedAt: revealedAt?.toISOString() ?? null,
        passedAt: assignment.passedAt?.toISOString() ?? null,
        attemptCount: attempts.length,
        ...(status !== "locked"
          ? {
              prompt: item.prompt,
              html: item.html,
              baseCss: item.baseCss,
              targetSelector: item.targetSelector,
            }
          : {}),
      });
    }
    return {
      sessionId,
      courseId: replay.session.lessonKind,
      claimBoundary: "两次迁移和延迟保持均有证据后，才可讨论长期掌握。",
      items,
    };
  }

  async submit(
    ownerId: string,
    sessionId: string,
    itemId: string,
    answer: string,
  ): Promise<SubmitTransferAssessmentResponse> {
    await this.ensureAssignments(ownerId, sessionId);
    const assignmentRows = await this.database
      .select()
      .from(transferAssessmentAssignments)
      .where(
        and(
          eq(transferAssessmentAssignments.sessionId, sessionId),
          eq(transferAssessmentAssignments.itemId, itemId),
        ),
      );
    const assignment = assignmentRows[0];
    const item = hiddenTransferById(itemId);
    if (!assignment || !item) {
      fail(
        "TRANSFER_ASSESSMENT_ITEM_NOT_FOUND",
        404,
        "没有找到这道迁移题。",
      );
    }
    const now = this.now();
    if (transferAssessmentStatus(assignment, now) === "locked") {
      fail(
        "TRANSFER_ASSESSMENT_NOT_DUE",
        409,
        "延迟挑战还没到时间；到期后再独立完成，才能留下保持证据。",
      );
    }
    if (assignment.passedAt) {
      fail(
        "TRANSFER_ASSESSMENT_ALREADY_PASSED",
        409,
        "这道挑战已经通过；旧结果不会被新提交改写。",
      );
    }
    const evaluation = evaluateHiddenTransferAnswer(item, answer);
    const submittedInWindow =
      !assignment.closesAt || now <= assignment.closesAt;
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${assignment.id}))`,
      );
      const currentAssignment = await transaction
        .select({
          passedAt: transferAssessmentAssignments.passedAt,
        })
        .from(transferAssessmentAssignments)
        .where(eq(transferAssessmentAssignments.id, assignment.id))
        .limit(1);
      if (currentAssignment[0]?.passedAt) {
        fail(
          "TRANSFER_ASSESSMENT_ALREADY_PASSED",
          409,
          "这道挑战已经通过；旧结果不会被并发提交改写。",
        );
      }
      const latest = await transaction
        .select({ sequence: transferAssessmentAttempts.attemptSequence })
        .from(transferAssessmentAttempts)
        .where(eq(transferAssessmentAttempts.assignmentId, assignment.id))
        .orderBy(desc(transferAssessmentAttempts.attemptSequence))
        .limit(1);
      const attemptSequence = (latest[0]?.sequence ?? 0) + 1;
      await transaction.insert(transferAssessmentAttempts).values({
        assignmentId: assignment.id,
        attemptSequence,
        submittedAnswer: answer,
        normalizedAnswer: evaluation.normalizedAnswer,
        answerHash: createHash("sha256").update(answer).digest("hex"),
        passed: evaluation.passed,
        submittedInWindow,
        evaluatorId: item.evaluatorId,
        submittedAt: now,
      });
      if (evaluation.passed) {
        await transaction
          .update(transferAssessmentAssignments)
          .set({
            passedAt: now,
            passedInWindow: submittedInWindow,
            revealedAt: assignment.revealedAt ?? now,
          })
          .where(eq(transferAssessmentAssignments.id, assignment.id));
      }
      return {
        itemId,
        passed: evaluation.passed,
        submittedInWindow,
        attemptSequence,
        feedback: evaluation.feedback,
        normalizedAnswer: evaluation.normalizedAnswer,
      };
    });
  }
}

const transferStoreGlobal = globalThis as typeof globalThis & {
  __aiTutorTransferAssessmentStore?: TransferAssessmentStore;
  __aiTutorTransferAssessmentDatabaseUrl?: string;
};

export function getTransferAssessmentStore(): TransferAssessmentStore {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    fail(
      "LEARNING_DATABASE_UNAVAILABLE",
      503,
      "在线学习记录暂时不可用；当前小课仍可在这台设备继续。",
    );
  }
  if (
    !transferStoreGlobal.__aiTutorTransferAssessmentStore ||
    transferStoreGlobal.__aiTutorTransferAssessmentDatabaseUrl !== databaseUrl
  ) {
    transferStoreGlobal.__aiTutorTransferAssessmentStore =
      new TransferAssessmentStore(
        createDatabase(databaseUrl).db,
        getLearningProofStore(),
      );
    transferStoreGlobal.__aiTutorTransferAssessmentDatabaseUrl = databaseUrl;
  }
  return transferStoreGlobal.__aiTutorTransferAssessmentStore;
}

export function resetTransferAssessmentStoreForTests(): void {
  delete transferStoreGlobal.__aiTutorTransferAssessmentStore;
  delete transferStoreGlobal.__aiTutorTransferAssessmentDatabaseUrl;
}
