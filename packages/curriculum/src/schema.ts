export type CurriculumCourseId =
  | "box-model-v1"
  | "flex-v1"
  | "positioning-v1";
export type MeasurableBehaviorKind =
  | "prediction"
  | "operation"
  | "explanation"
  | "transfer";
export type StructuralDifference = "dom" | "rules" | "visual";

export interface MeasurableBehavior {
  readonly id: string;
  readonly kind: MeasurableBehaviorKind;
  readonly studentAction: string;
  readonly observable: string;
  readonly successCriterion: string;
  readonly independent: boolean;
}

export interface MisconceptionDefinition {
  readonly id: string;
  readonly label: string;
  readonly conceptTags: readonly string[];
  readonly elicitationPrompt: string;
  readonly evidenceSignals: readonly string[];
  readonly minimumOccurrences: number;
  readonly singleErrorState: "uncertain";
  readonly supportHint: string;
  readonly correctionQuestion: string;
  readonly correctionCriterion: string;
}

export interface HintDefinition {
  readonly level: 1 | 2 | 3;
  readonly text: string;
  readonly revealsAnswer: boolean;
  readonly creditEligibleAfterUse: boolean;
}

export interface TeachingFactSource {
  readonly id: string;
  readonly kind:
    | "browser-measurement"
    | "computed-style"
    | "matched-css-rule"
    | "source-location";
  readonly requiredFields: readonly string[];
}

export interface CurriculumCourse<
  TId extends CurriculumCourseId = CurriculumCourseId,
  TSkillId extends string = string,
  TEvaluatorId extends string = string,
> {
  readonly id: TId;
  readonly version: 1;
  readonly conceptId: string;
  readonly skillId: TSkillId;
  readonly evaluatorId: TEvaluatorId;
  readonly title: string;
  readonly outcome: string;
  readonly prerequisiteConceptIds: readonly string[];
  readonly behaviors: readonly MeasurableBehavior[];
  readonly misconceptions: readonly MisconceptionDefinition[];
  readonly hints: readonly HintDefinition[];
  readonly factSources: readonly TeachingFactSource[];
  readonly transfer: {
    readonly sourceStructure: string;
    readonly targetStructure: string;
    readonly differences: readonly StructuralDifference[];
    readonly hiddenItemIds: readonly [string, string];
  };
  readonly accessibility: {
    readonly regionLabel: string;
    readonly operationLabel: string;
    readonly transferInputLabel: string;
  };
}

export function lintCurriculumCourse(course: CurriculumCourse): string[] {
  const errors: string[] = [];
  const behaviorKinds = course.behaviors.map((behavior) => behavior.kind);
  for (const kind of [
    "prediction",
    "operation",
    "explanation",
    "transfer",
  ] as const) {
    if (behaviorKinds.filter((candidate) => candidate === kind).length !== 1) {
      errors.push(`${course.id}: requires exactly one ${kind} behavior`);
    }
  }
  if (new Set(course.behaviors.map((item) => item.id)).size !== course.behaviors.length) {
    errors.push(`${course.id}: behavior IDs must be unique`);
  }
  if (course.hints.map((hint) => hint.level).join(",") !== "1,2,3") {
    errors.push(`${course.id}: hints must be ordered levels 1,2,3`);
  }
  if (course.hints[0]?.revealsAnswer) {
    errors.push(`${course.id}: level-one hint must not reveal the answer`);
  }
  if (!course.hints[2]?.revealsAnswer || course.hints[2]?.creditEligibleAfterUse) {
    errors.push(
      `${course.id}: demonstration hint must reveal the answer and remove independent credit`,
    );
  }
  for (const misconception of course.misconceptions) {
    if (
      misconception.minimumOccurrences < 2 ||
      misconception.conceptTags.length === 0 ||
      !misconception.elicitationPrompt ||
      misconception.evidenceSignals.length < 2 ||
      !misconception.supportHint ||
      !misconception.correctionQuestion ||
      !misconception.correctionCriterion
    ) {
      errors.push(
        `${course.id}: misconception ${misconception.id} needs repeated evidence and a correction check`,
      );
    }
  }
  if (course.factSources.length < 3) {
    errors.push(`${course.id}: at least three browser/source fact types are required`);
  }
  if (
    course.transfer.sourceStructure === course.transfer.targetStructure ||
    new Set(course.transfer.differences).size !== 3 ||
    !["dom", "rules", "visual"].every((kind) =>
      course.transfer.differences.includes(kind as StructuralDifference),
    )
  ) {
    errors.push(
      `${course.id}: transfer must differ in DOM, rules, and visual structure`,
    );
  }
  if (new Set(course.transfer.hiddenItemIds).size !== 2) {
    errors.push(`${course.id}: two distinct hidden transfer items are required`);
  }
  for (const [field, value] of Object.entries(course.accessibility)) {
    if (!value.trim()) errors.push(`${course.id}: accessibility ${field} is empty`);
  }
  return errors;
}
