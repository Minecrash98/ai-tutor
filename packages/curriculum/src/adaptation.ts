import type { CurriculumCourseId } from "./schema";

export type EntryPrediction = "correct" | "incorrect" | "unsure" | "skipped";
export type HiddenTransferOutcome = "passed" | "failed" | null;

export interface EntryDiagnosticInput {
  readonly courseId: CurriculumCourseId;
  readonly prediction: EntryPrediction;
  readonly hiddenTransferOutcome?: HiddenTransferOutcome;
}

export interface EntryDiagnostic {
  readonly version: 1;
  readonly ruleId: string;
  readonly confidence: number;
  readonly provisional: boolean;
  readonly scaffold: "none" | "fact-check" | "worked-example";
  readonly skipAllowed: true;
  readonly blocksFirstInteraction: false;
  readonly calibratedBy: "entry-prediction" | "hidden-transfer";
  readonly reasonCodes: readonly string[];
}

export function buildEntryDiagnostic(input: EntryDiagnosticInput): EntryDiagnostic {
  if (input.hiddenTransferOutcome === "passed") {
    return Object.freeze({
      version: 1,
      ruleId: `${input.courseId}:entry-diagnostic-v1`,
      confidence: 0.9,
      provisional: false,
      scaffold: "none",
      skipAllowed: true,
      blocksFirstInteraction: false,
      calibratedBy: "hidden-transfer",
      reasonCodes: Object.freeze(["hidden-transfer-passed"]),
    });
  }
  if (input.hiddenTransferOutcome === "failed") {
    return Object.freeze({
      version: 1,
      ruleId: `${input.courseId}:entry-diagnostic-v1`,
      confidence: 0.8,
      provisional: false,
      scaffold: "fact-check",
      skipAllowed: true,
      blocksFirstInteraction: false,
      calibratedBy: "hidden-transfer",
      reasonCodes: Object.freeze(["hidden-transfer-failed"]),
    });
  }
  const rule = {
    correct: { confidence: 0.55, scaffold: "none" as const },
    incorrect: { confidence: 0.55, scaffold: "fact-check" as const },
    unsure: { confidence: 0.35, scaffold: "fact-check" as const },
    skipped: { confidence: 0.15, scaffold: "none" as const },
  }[input.prediction];
  return Object.freeze({
    version: 1,
    ruleId: `${input.courseId}:entry-diagnostic-v1`,
    confidence: rule.confidence,
    provisional: true,
    scaffold: rule.scaffold,
    skipAllowed: true,
    blocksFirstInteraction: false,
    calibratedBy: "entry-prediction",
    reasonCodes: Object.freeze([`entry-${input.prediction}`, "single-answer-is-provisional"]),
  });
}

export interface NextTaskInput {
  readonly courseId: CurriculumCourseId;
  readonly latestOutcome: "passed" | "failed" | "unsure" | "not-attempted";
  readonly misconceptionState: "none" | "uncertain" | "supported";
  readonly hintLevel: 0 | 1 | 2 | 3;
  readonly hiddenTransferDue: boolean;
}

export interface NextTaskDecision {
  readonly version: 1;
  readonly ruleId: string;
  readonly taskVariantId: string;
  readonly difficulty: "foundation" | "guided" | "independent" | "hidden-transfer";
  readonly scaffold: "none" | "fact-check" | "correction-question" | "worked-example";
  readonly independentCreditEligible: boolean;
  readonly reasonCodes: readonly string[];
}

export function chooseNextTask(input: NextTaskInput): NextTaskDecision {
  const base = { version: 1 as const, ruleId: `${input.courseId}:next-task-v1` };
  if (input.hiddenTransferDue) {
    return Object.freeze({ ...base, taskVariantId: `${input.courseId}:hidden-transfer`, difficulty: "hidden-transfer", scaffold: "none", independentCreditEligible: true, reasonCodes: Object.freeze(["retention-window-due"]) });
  }
  if (input.misconceptionState === "supported") {
    return Object.freeze({ ...base, taskVariantId: `${input.courseId}:misconception-correction`, difficulty: "foundation", scaffold: "correction-question", independentCreditEligible: input.hintLevel < 3, reasonCodes: Object.freeze(["repeated-independent-observations", "misconception-supported"]) });
  }
  if (input.hintLevel === 3) {
    return Object.freeze({ ...base, taskVariantId: `${input.courseId}:guided-rebuild`, difficulty: "guided", scaffold: "worked-example", independentCreditEligible: false, reasonCodes: Object.freeze(["demonstration-used"]) });
  }
  if (input.latestOutcome === "failed" || input.latestOutcome === "unsure" || input.misconceptionState === "uncertain") {
    return Object.freeze({ ...base, taskVariantId: `${input.courseId}:guided-fact-check`, difficulty: "guided", scaffold: "fact-check", independentCreditEligible: true, reasonCodes: Object.freeze([input.misconceptionState === "uncertain" ? "evidence-insufficient" : `latest-${input.latestOutcome}`]) });
  }
  return Object.freeze({ ...base, taskVariantId: `${input.courseId}:independent-practice`, difficulty: "independent", scaffold: "none", independentCreditEligible: true, reasonCodes: Object.freeze([input.latestOutcome === "passed" ? "latest-passed" : "no-risk-signal"]) });
}
