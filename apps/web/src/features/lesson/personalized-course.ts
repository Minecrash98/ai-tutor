import type { InspectionResult } from "@ai-tutor/runtime-core";
import { EXPERIMENT_STYLES_FILE } from "@ai-tutor/runtime-static-html";
import {
  COURSE_BY_ID,
  HIDDEN_TRANSFER_MANIFEST,
  type CurriculumCourseId,
} from "@ai-tutor/curriculum";
import type { CodeRevision } from "@ai-tutor/teaching-model";
import { z } from "zod";

export type PersonalizedCourseTopic = "box-model" | "flex" | "positioning";

export interface PersonalizedCourseCandidate {
  readonly topic: PersonalizedCourseTopic;
  readonly selector: string;
  readonly sourceFilePath: string;
  readonly approximateLine: number;
  readonly declarations: Readonly<Record<string, string>>;
}

export interface PersonalizedCourseVerification {
  readonly revisionId: string;
  readonly capturedAt: string;
  readonly computedValue: string;
  readonly boundingWidth: number;
  readonly boundingHeight: number;
  readonly boundingX: number;
  readonly boundingY: number;
}

export interface PersonalizedCoursePlan {
  readonly version: 1;
  readonly id: string;
  readonly blockId: string;
  readonly baseRevisionId: string;
  readonly baseContentHash: string;
  readonly analyzerVersion: "personalized-course-rules-v1";
  readonly topic: PersonalizedCourseTopic;
  readonly courseId: CurriculumCourseId;
  readonly title: string;
  readonly selector: string;
  readonly generatedAt: string;
  readonly source: {
    readonly filePath: string;
    readonly line: number;
    readonly column: number;
    readonly selector: string;
    readonly declarations: Readonly<Record<string, string>>;
  };
  readonly before: {
    readonly computedValue: string;
    readonly boundingWidth: number;
    readonly boundingHeight: number;
    readonly boundingX: number;
    readonly boundingY: number;
    readonly childCount: number;
    readonly parentDomPath: string | null;
  };
  readonly experiment: {
    readonly property: "padding" | "gap" | "top" | "right" | "bottom" | "left";
    readonly trialValue: string;
    readonly predictionQuestion: string;
    readonly predictionChoices: readonly {
      readonly id: string;
      readonly label: string;
      readonly correct: boolean;
    }[];
    readonly explanationQuestion: string;
    readonly explanationChoices: readonly {
      readonly id: string;
      readonly label: string;
      readonly correct: boolean;
    }[];
  };
  readonly hiddenTransferItemId: string;
  readonly hiddenTransferItemHash: string;
  readonly progress: {
    readonly predictionAnswer: string | null;
    readonly verification: PersonalizedCourseVerification | null;
    readonly explanationAnswer: string | null;
    readonly explanationAttempts: number;
    readonly explanationCorrect: boolean | null;
  };
}

const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9-]*)?(?:#[a-zA-Z_][\w-]*|\.[a-zA-Z_][\w-]*)$/;
const MAX_CANDIDATES = 24;

function withoutCommentsKeepingLines(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
}

function declarationsFrom(value: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of value.matchAll(/([a-zA-Z-]+)\s*:\s*([^;{}]+)\s*(?:;|$)/g)) {
    const property = match[1]?.trim().toLowerCase();
    const declarationValue = match[2]?.trim();
    if (property && declarationValue) declarations.set(property, declarationValue);
  }
  return declarations;
}

function candidateTopics(
  declarations: ReadonlyMap<string, string>,
): readonly PersonalizedCourseTopic[] {
  const topics: PersonalizedCourseTopic[] = [];
  if (declarations.has("width") && declarations.has("padding")) {
    topics.push("box-model");
  }
  if (declarations.get("display")?.trim().toLowerCase() === "flex") {
    topics.push("flex");
  }
  if (
    ["absolute", "relative"].includes(
      declarations.get("position")?.trim().toLowerCase() ?? "",
    ) &&
    ["top", "right", "bottom", "left"].some((property) =>
      declarations.has(property),
    )
  ) {
    topics.push("positioning");
  }
  return topics;
}

export function extractPersonalizedCourseCandidates(
  revision: CodeRevision,
): PersonalizedCourseCandidate[] {
  const candidates: PersonalizedCourseCandidate[] = [];
  const seen = new Set<string>();
  for (const file of Object.values(revision.files)
    .filter(
      (candidate) =>
        candidate.encoding !== "base64" &&
        candidate.mimeType === "text/css" &&
        !candidate.path.startsWith("__ai_tutor_"),
    )
    .sort((left, right) => left.path.localeCompare(right.path))) {
    const css = withoutCommentsKeepingLines(file.content);
    for (const block of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = block[2] ?? "";
      const parsedDeclarations = declarationsFrom(body);
      const topics = candidateTopics(parsedDeclarations);
      if (topics.length === 0) continue;
      const selectorList = block[1] ?? "";
      const selectorStartOffset = Math.max(0, selectorList.search(/\S/));
      const approximateLine = file.content
        .slice(0, (block.index ?? 0) + selectorStartOffset)
        .split(/\r?\n/).length;
      for (const rawSelector of selectorList.split(",")) {
        const selector = rawSelector.trim();
        if (!SIMPLE_SELECTOR.test(selector)) continue;
        for (const topic of topics) {
          const key = `${file.path}:${approximateLine}:${topic}:${selector}`;
          if (seen.has(key)) continue;
          seen.add(key);
          candidates.push({
            topic,
            selector,
            sourceFilePath: file.path,
            approximateLine,
            declarations: Object.freeze(Object.fromEntries(parsedDeclarations)),
          });
          if (candidates.length >= MAX_CANDIDATES) return candidates;
        }
      }
    }
  }
  return candidates;
}

function directRuleFor(
  candidate: PersonalizedCourseCandidate,
  result: InspectionResult,
) {
  const normalizedPath = candidate.sourceFilePath.replace(/\\/g, "/");
  return result.matchedRules.find(
    (rule) =>
      !rule.inheritedFrom &&
      rule.pseudoElement === null &&
      rule.source.line !== null &&
      rule.source.column !== null &&
      rule.source.line === candidate.approximateLine &&
      rule.source.filePath.replace(/\\/g, "/") === normalizedPath &&
      rule.selectorText
        .split(",")
        .map((selector) => selector.trim())
        .includes(candidate.selector),
  );
}

type MatchedRule = InspectionResult["matchedRules"][number];
type MatchedDeclaration = MatchedRule["declarations"][number];

function cascadeBeats(
  left: { readonly rule: MatchedRule; readonly declaration: MatchedDeclaration; readonly index: number },
  right: { readonly rule: MatchedRule; readonly declaration: MatchedDeclaration; readonly index: number },
): boolean {
  if (left.declaration.important !== right.declaration.important) {
    return left.declaration.important;
  }
  for (let index = 0; index < 3; index += 1) {
    const delta = (left.rule.specificity[index] ?? 0) - (right.rule.specificity[index] ?? 0);
    if (delta !== 0) return delta > 0;
  }
  if (left.rule.sourceOrder !== right.rule.sourceOrder) {
    return left.rule.sourceOrder > right.rule.sourceOrder;
  }
  return left.index > right.index;
}

function ruleWinsProperty(
  result: InspectionResult,
  expectedRule: MatchedRule,
  expectedProperty: string,
  competingProperties: readonly string[] = [expectedProperty],
): boolean {
  let winner:
    | { readonly rule: MatchedRule; readonly declaration: MatchedDeclaration; readonly index: number }
    | null = null;
  for (const rule of result.matchedRules) {
    if (rule.inheritedFrom || rule.pseudoElement !== null) continue;
    for (const [index, declaration] of rule.declarations.entries()) {
      if (
        declaration.inherited ||
        !competingProperties.includes(declaration.property)
      ) {
        continue;
      }
      const contender = { rule, declaration, index };
      if (!winner || cascadeBeats(contender, winner)) winner = contender;
    }
  }
  return Boolean(
    winner &&
      winner.rule === expectedRule &&
      winner.declaration.property === expectedProperty,
  );
}

function px(value: string | undefined): number | null {
  const match = value?.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  const parsed = match?.[1] ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function nextTrial(value: number, minimum: number, maximum: number): number {
  const upward = Math.round(value + 16);
  return upward <= maximum ? upward : Math.max(minimum, Math.round(value - 16));
}

const TOPIC_COURSE: Readonly<Record<PersonalizedCourseTopic, CurriculumCourseId>> = {
  "box-model": "box-model-v1",
  flex: "flex-v1",
  positioning: "positioning-v1",
};

export function buildPersonalizedCoursePlan(input: {
  readonly blockId: string;
  readonly revisionId: string;
  readonly contentHash: string;
  readonly candidate: PersonalizedCourseCandidate;
  readonly result: InspectionResult;
  readonly generatedAt?: string;
}): PersonalizedCoursePlan | null {
  const { blockId, revisionId, contentHash, candidate, result } = input;
  const rule = directRuleFor(candidate, result);
  if (!rule || result.domPath.length > 2_048) return null;
  const declarations = Object.fromEntries(
    Object.entries(candidate.declarations).slice(0, 12),
  );
  let property: PersonalizedCoursePlan["experiment"]["property"];
  let baseline: number | null;
  let title: string;
  let predictionQuestion: string;
  let predictionChoices: PersonalizedCoursePlan["experiment"]["predictionChoices"];
  let explanationQuestion: string;
  let explanationChoices: PersonalizedCoursePlan["experiment"]["explanationChoices"];

  if (candidate.topic === "box-model") {
    const declaredWidth = px(candidate.declarations.width);
    const declaredPadding = px(candidate.declarations.padding);
    const runtimeWidth = rule.declarations.find((item) => item.property === "width");
    const padding = result.boxModel.padding;
    if (
      result.boxModel.boxSizing !== "content-box" ||
      declaredWidth === null ||
      declaredPadding === null ||
      px(runtimeWidth?.value) !== declaredWidth ||
      Math.abs(result.boxModel.content.width - declaredWidth) > 0.5 ||
      ![padding.right, padding.bottom, padding.left].every(
        (value) => value === padding.top,
      ) ||
      Math.abs(padding.top - declaredPadding) > 0.5 ||
      !ruleWinsProperty(result, rule, "width") ||
      !["padding-top", "padding-right", "padding-bottom", "padding-left"].every(
        (side) => {
          const authoredProperty = rule.declarations.some(
            (declaration) => declaration.property === side,
          )
            ? side
            : "padding";
          const authoredValue = rule.declarations.find(
            (declaration) => declaration.property === authoredProperty,
          )?.value;
          return (
            px(authoredValue) === declaredPadding &&
            ruleWinsProperty(result, rule, authoredProperty, ["padding", side])
          );
        },
      )
    ) {
      return null;
    }
    property = "padding";
    baseline = padding.top;
    title = "用我的卡片看懂总宽";
    predictionQuestion = "只把里面留白调大，外框总宽会怎样？";
    predictionChoices = [
      { id: "outer-grows", label: "外框会变宽", correct: true },
      { id: "outer-same", label: "外框保持不变", correct: false },
    ];
    explanationQuestion = "为什么外框会发生这个变化？";
    explanationChoices = [
      {
        id: "content-box-adds-padding",
        label: "这里是 content-box，width 之外还要加左右留白",
        correct: true,
      },
      { id: "margin-grows-border", label: "因为外边距会撑大边框", correct: false },
    ];
  } else if (candidate.topic === "flex") {
    if (
      result.computedStyles.display?.trim() !== "flex" ||
      (result.relations?.children.length ?? 0) < 2 ||
      !rule.declarations.some(
        (item) => item.property === "display" && item.value.trim() === "flex",
      ) ||
      !ruleWinsProperty(result, rule, "display")
    ) {
      return null;
    }
    property = "gap";
    const rowGap = result.computedStyles["row-gap"] ?? result.computedStyles.gap;
    const columnGap =
      result.computedStyles["column-gap"] ?? result.computedStyles.gap;
    const rowGapPx = px(rowGap);
    const columnGapPx = px(columnGap);
    baseline = rowGapPx === columnGapPx ? rowGapPx : null;
    if (
      baseline === null &&
      rowGap?.trim() === "normal" &&
      columnGap?.trim() === "normal"
    ) {
      baseline = 0;
    }
    title = "用我的排列看懂项目间距";
    predictionQuestion = "只把 gap 调大，里面每个项目自身会变大吗？";
    predictionChoices = [
      { id: "items-same", label: "项目不变，相邻空隙变大", correct: true },
      { id: "items-grow", label: "每个项目都会变大", correct: false },
    ];
    explanationQuestion = "为什么项目本身没有跟着变大？";
    explanationChoices = [
      { id: "gap-between", label: "gap 管项目之间的距离，不直接改项目尺寸", correct: true },
      { id: "gap-is-padding", label: "gap 就是每个项目的里面留白", correct: false },
    ];
  } else {
    const computedPosition = result.computedStyles.position?.trim();
    const directPosition = rule.declarations.find(
      (item) => item.property === "position",
    )?.value;
    const offset = (["top", "right", "bottom", "left"] as const).find(
      (name) => rule.declarations.some((item) => item.property === name),
    );
    const directOffset = offset
      ? rule.declarations.find((item) => item.property === offset)?.value
      : undefined;
    if (
      !offset ||
      !["absolute", "relative"].includes(computedPosition ?? "") ||
      directPosition?.trim() !== computedPosition ||
      !result.relations?.parent ||
      !ruleWinsProperty(result, rule, "position") ||
      !ruleWinsProperty(result, rule, offset) ||
      px(directOffset) !== px(result.computedStyles[offset])
    ) {
      return null;
    }
    property = offset;
    baseline = px(result.computedStyles[offset]);
    title = "用我的元素看懂定位偏移";
    predictionQuestion = `把 ${offset} 调大 16px，这个元素会沿对应方向移动吗？`;
    predictionChoices = [
      { id: "offset-moves", label: "会按偏移方向移动", correct: true },
      { id: "offset-resizes", label: "只会改变元素大小", correct: false },
    ];
    explanationQuestion = "这次变化由哪条证据直接支持？";
    explanationChoices = [
      {
        id: "position-and-offset",
        label: `源码同时设置了 position: ${computedPosition} 和 ${offset}`,
        correct: true,
      },
      { id: "text-length", label: "因为文字长度发生了变化", correct: false },
    ];
  }

  const minimum = property === "padding" || property === "gap" ? 0 : -160;
  const maximum = property === "padding" || property === "gap" ? 96 : 160;
  if (baseline === null || baseline < minimum || baseline > maximum) return null;
  const trial = nextTrial(baseline, minimum, maximum);
  if (trial === baseline) return null;
  const courseId = TOPIC_COURSE[candidate.topic];
  const hiddenTransferItemId = COURSE_BY_ID[courseId].transfer.hiddenItemIds[0];
  const hiddenTransfer = HIDDEN_TRANSFER_MANIFEST.find(
    (entry) => entry.itemId === hiddenTransferItemId,
  );
  if (!hiddenTransfer || hiddenTransfer.kind !== "immediate-hidden") return null;
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  return Object.freeze({
    version: 1,
    id: `personal-course:${blockId}:${revisionId}:${candidate.topic}:${candidate.selector}`,
    blockId,
    baseRevisionId: revisionId,
    baseContentHash: contentHash,
    analyzerVersion: "personalized-course-rules-v1",
    topic: candidate.topic,
    courseId,
    title,
    selector: result.domPath,
    generatedAt,
    source: Object.freeze({
      filePath: rule.source.filePath,
      line: rule.source.line!,
      column: rule.source.column!,
      selector: candidate.selector,
      declarations: Object.freeze(declarations),
    }),
    before: Object.freeze({
      computedValue: `${baseline}px`,
      boundingWidth: result.boundingRect.width,
      boundingHeight: result.boundingRect.height,
      boundingX: result.boundingRect.x,
      boundingY: result.boundingRect.y,
      childCount: result.relations?.children.length ?? 0,
      parentDomPath: result.relations?.parent?.domPath ?? null,
    }),
    experiment: Object.freeze({
      property,
      trialValue: `${trial}px`,
      predictionQuestion,
      predictionChoices: Object.freeze(predictionChoices),
      explanationQuestion,
      explanationChoices: Object.freeze(explanationChoices),
    }),
    hiddenTransferItemId,
    hiddenTransferItemHash: hiddenTransfer.sha256,
    progress: Object.freeze({
      predictionAnswer: null,
      verification: null,
      explanationAnswer: null,
      explanationAttempts: 0,
      explanationCorrect: null,
    }),
  });
}

export function recordPersonalizedCourseAnswer(
  plan: PersonalizedCoursePlan,
  kind: "prediction" | "explanation",
  answer: string,
): PersonalizedCoursePlan {
  const choices =
    kind === "prediction"
      ? plan.experiment.predictionChoices
      : plan.experiment.explanationChoices;
  const choice = choices.find((candidate) => candidate.id === answer);
  if (!choice) return plan;
  return Object.freeze({
    ...plan,
    progress: Object.freeze({
      ...plan.progress,
      ...(kind === "prediction"
        ? { predictionAnswer: answer }
        : {
            explanationAnswer: answer,
            explanationAttempts: plan.progress.explanationAttempts + 1,
            explanationCorrect: choice.correct,
          }),
    }),
  });
}

export function verifyPersonalizedCourseExperiment(
  plan: PersonalizedCoursePlan,
  snapshot: {
    readonly blockId: string;
    readonly revisionId: string;
    readonly capturedAt: string;
    readonly result: InspectionResult;
  },
): PersonalizedCourseVerification | null {
  if (
    snapshot.blockId !== plan.blockId ||
    snapshot.revisionId === plan.baseRevisionId ||
    snapshot.result.domPath !== plan.selector
  ) {
    return null;
  }
  const property = plan.experiment.property;
  const computedValue =
    property === "padding"
      ? snapshot.result.computedStyles["padding-top"]
      : property === "gap"
        ? snapshot.result.computedStyles["column-gap"] ??
          snapshot.result.computedStyles.gap
      : snapshot.result.computedStyles[property];
  if (computedValue?.trim() !== plan.experiment.trialValue) return null;
  if (
    property === "gap" &&
    (snapshot.result.computedStyles["row-gap"] ?? computedValue)?.trim() !==
      plan.experiment.trialValue
  ) {
    return null;
  }
  const declarationMatches = (declaration: MatchedDeclaration) =>
    declaration.value.replace(/\s*!important\s*$/i, "").trim() ===
    plan.experiment.trialValue;
  const grounded = snapshot.result.matchedRules.some(
    (rule) => {
      if (rule.inheritedFrom || rule.pseudoElement !== null) return false;
      const direct = rule.declarations.find(
        (declaration) => declaration.property === property,
      );
      if (direct && declarationMatches(direct)) return true;
      const expanded =
        property === "padding"
          ? ["padding-top", "padding-right", "padding-bottom", "padding-left"]
          : property === "gap"
            ? ["row-gap", "column-gap"]
            : [];
      return (
        expanded.length > 0 &&
        expanded.every((name) =>
          rule.declarations.some(
            (declaration) =>
              declaration.property === name && declarationMatches(declaration),
          ),
        )
      );
    },
  );
  if (!grounded) return null;
  return Object.freeze({
    revisionId: snapshot.revisionId,
    capturedAt: snapshot.capturedAt,
    computedValue: computedValue.trim(),
    boundingWidth: snapshot.result.boundingRect.width,
    boundingHeight: snapshot.result.boundingRect.height,
    boundingX: snapshot.result.boundingRect.x,
    boundingY: snapshot.result.boundingRect.y,
  });
}

export function attachPersonalizedCourseVerification(
  plan: PersonalizedCoursePlan,
  verification: PersonalizedCourseVerification,
): PersonalizedCoursePlan {
  return Object.freeze({
    ...plan,
    progress: Object.freeze({ ...plan.progress, verification }),
  });
}

export function revisionDescendsFrom(
  revisions: readonly CodeRevision[],
  revisionId: string,
  ancestorRevisionId: string,
): boolean {
  const byId = new Map(revisions.map((revision) => [revision.id, revision]));
  const visited = new Set<string>();
  let cursor = byId.get(revisionId);
  while (cursor) {
    if (cursor.id === ancestorRevisionId) return true;
    if (visited.has(cursor.id) || cursor.parentRevisionId === null) return false;
    visited.add(cursor.id);
    cursor = byId.get(cursor.parentRevisionId);
  }
  return false;
}

export function personalizedCourseSourceUnchanged(
  plan: PersonalizedCoursePlan,
  revisions: readonly CodeRevision[],
  currentRevisionId: string,
): boolean {
  const base = revisions.find((revision) => revision.id === plan.baseRevisionId);
  const current = revisions.find((revision) => revision.id === currentRevisionId);
  if (!base || !current || base.contentHash !== plan.baseContentHash) return false;
  const sourceEntries = (revision: CodeRevision) =>
    Object.entries(revision.files)
      .filter(([path]) => path !== EXPERIMENT_STYLES_FILE)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, file]) => [
        path,
        file.mimeType,
        file.encoding ?? "utf8",
        file.content,
      ]);
  return JSON.stringify(sourceEntries(base)) === JSON.stringify(sourceEntries(current));
}

const choiceSchema = z.object({
  id: z.string().min(1).max(120),
  label: z.string().min(1).max(300),
  correct: z.boolean(),
});

export const personalizedCoursePlanSchema = z.object({
  version: z.literal(1),
  id: z.string().min(1).max(2_000),
  blockId: z.string().min(1).max(200),
  baseRevisionId: z.string().min(1).max(200),
  baseContentHash: z.string().min(1).max(200),
  analyzerVersion: z.literal("personalized-course-rules-v1"),
  topic: z.enum(["box-model", "flex", "positioning"]),
  courseId: z.enum(["box-model-v1", "flex-v1", "positioning-v1"]),
  title: z.string().min(1).max(300),
  selector: z.string().min(1).max(2_048),
  generatedAt: z.string().datetime({ offset: true }),
  source: z.object({
    filePath: z.string().min(1).max(1_024),
    line: z.number().int().positive(),
    column: z.number().int().positive(),
    selector: z.string().min(1).max(2_048),
    declarations: z.record(z.string(), z.string()).refine(
      (declarations) => Object.keys(declarations).length <= 12,
      "too many source declarations",
    ),
  }),
  before: z.object({
    computedValue: z.string().min(1).max(200),
    boundingWidth: z.number().finite(),
    boundingHeight: z.number().finite(),
    boundingX: z.number().finite(),
    boundingY: z.number().finite(),
    childCount: z.number().int().nonnegative(),
    parentDomPath: z.string().max(2_048).nullable(),
  }),
  experiment: z.object({
    property: z.enum(["padding", "gap", "top", "right", "bottom", "left"]),
    trialValue: z.string().regex(/^-?\d+(?:\.\d+)?px$/),
    predictionQuestion: z.string().min(1).max(500),
    predictionChoices: z.array(choiceSchema).min(2).max(6),
    explanationQuestion: z.string().min(1).max(500),
    explanationChoices: z.array(choiceSchema).min(2).max(6),
  }),
  hiddenTransferItemId: z.string().min(1).max(200),
  hiddenTransferItemHash: z.string().regex(/^[0-9a-f]{64}$/),
  progress: z.object({
    predictionAnswer: z.string().max(120).nullable(),
    verification: z.object({
      revisionId: z.string().min(1).max(200),
      capturedAt: z.string().datetime({ offset: true }),
      computedValue: z.string().min(1).max(200),
      boundingWidth: z.number().finite(),
      boundingHeight: z.number().finite(),
      boundingX: z.number().finite(),
      boundingY: z.number().finite(),
    }).nullable(),
    explanationAnswer: z.string().max(120).nullable(),
    explanationAttempts: z.number().int().nonnegative().max(100),
    explanationCorrect: z.boolean().nullable(),
  }),
});

export function isPersonalizedCoursePlan(
  value: unknown,
): value is PersonalizedCoursePlan {
  return personalizedCoursePlanSchema.safeParse(value).success;
}
