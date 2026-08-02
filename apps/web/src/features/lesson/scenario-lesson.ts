import {
  SCENARIO_LESSON_STATE_VERSION,
  type ScenarioExplanation,
  type ScenarioLessonEvidence,
  type ScenarioLessonKind,
  type ScenarioLessonRecordedEvent,
  type ScenarioLessonState,
  type ScenarioPrediction,
  type LearningSupportAction,
} from "@ai-tutor/contracts";
import { COURSE_BY_ID } from "@ai-tutor/curriculum";

export type {
  ScenarioExplanation,
  ScenarioLessonBlock,
  ScenarioLessonEvidence,
  ScenarioLessonKind,
  ScenarioLessonRecordedEvent,
  ScenarioLessonState,
  ScenarioPrediction,
} from "@ai-tutor/contracts";

export const INITIAL_SCENARIO_LESSON: ScenarioLessonState = Object.freeze({
  version: SCENARIO_LESSON_STATE_VERSION,
  lessonKind: null,
  sessionId: null,
  phase: "idle",
  blocks: Object.freeze([]),
  transferBlockId: null,
  prediction: null,
  predictionCorrect: null,
  observations: Object.freeze([]),
  explanation: null,
  explanationCorrect: null,
  explanationAttempts: 0,
  supportHistory: Object.freeze([]),
  personalizedOrigin: null,
  independentCreditEligible: true,
  transferCode: null,
  transferPassed: null,
  startedAt: null,
  completedAt: null,
  evidence: Object.freeze([]),
});

const EXPECTED_OBSERVATIONS = {
  "flex-v1": [
    { role: "experiment", property: "gap", value: "32px" },
    { role: "experiment", property: "justify-content", value: "center" },
    { role: "experiment", property: "align-items", value: "flex-end" },
  ],
  "positioning-v1": [
    { role: "static", property: "top", value: "40px" },
    { role: "relative", property: "top", value: "40px" },
    { role: "absolute", property: "top", value: "48px" },
  ],
} as const;

const SUPPORT_DETAIL: Readonly<Record<LearningSupportAction, string>> = {
  hint: "学生主动查看了一层提示；提示使用会留在学习记录中",
  skip: "学生选择跳过当前步骤；本轮只记为有支架完成",
  demonstration: "学生选择直接看示范；本轮不计独立达成",
  timeout: "等待时间已到；课程停在原步骤并提供恢复入口",
  "teacher-takeover": "学生请求老师接手；本轮不计独立达成",
};

function skill(kind: ScenarioLessonKind) {
  const course = COURSE_BY_ID[kind];
  return {
    skillId: course.skillId,
    evaluatorId: course.evaluatorId,
  };
}

function evidence(
  kind: ScenarioLessonKind,
  event: ScenarioLessonRecordedEvent,
  evidenceKind: ScenarioLessonEvidence["kind"],
  passed: boolean,
  criterion: string,
  observed: string,
  detail: string,
): ScenarioLessonEvidence {
  return Object.freeze({
    schemaVersion: event.eventVersion,
    id: `${event.eventId}:${evidenceKind}`,
    eventId: event.eventId,
    at: event.at,
    kind: evidenceKind,
    ...skill(kind),
    passed,
    criterion,
    observed,
    detail,
  });
}

function predictionPasses(
  kind: ScenarioLessonKind,
  answer: ScenarioPrediction,
): boolean {
  return kind === "flex-v1"
    ? answer === "gap-separates-items"
    : answer === "absolute-leaves-flow";
}

function explanationPasses(
  kind: ScenarioLessonKind,
  answer: ScenarioExplanation,
): boolean {
  return kind === "flex-v1"
    ? answer === "axes-are-independent"
    : answer === "nearest-positioned-ancestor";
}

function normalizeValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function observationPasses(
  state: ScenarioLessonState,
  event: Extract<
    ScenarioLessonRecordedEvent,
    { type: "scenario-experiment-saved" }
  >,
): boolean {
  if (!state.lessonKind) return false;
  const role = state.blocks.find((block) => block.blockId === event.blockId)?.role;
  if (!role) return false;
  return EXPECTED_OBSERVATIONS[state.lessonKind].some(
    (expected) =>
      expected.role === role &&
      expected.property === event.property &&
      normalizeValue(expected.value) === normalizeValue(event.value),
  );
}

export function scenarioObservationProgress(
  state: ScenarioLessonState,
): { readonly completed: number; readonly total: number } {
  if (!state.lessonKind) return { completed: 0, total: 0 };
  const expected = EXPECTED_OBSERVATIONS[state.lessonKind];
  const usedRevisions = new Set<string>();
  let completed = 0;
  for (const target of expected) {
    const blockId = state.blocks.find((block) => block.role === target.role)?.blockId;
    const match = state.observations.find(
      (observation) =>
        observation.passed &&
        !usedRevisions.has(observation.revisionId) &&
        observation.blockId === blockId &&
        observation.property === target.property &&
        normalizeValue(observation.value) === normalizeValue(target.value),
    );
    if (match) {
      usedRevisions.add(match.revisionId);
      completed += 1;
    }
  }
  return { completed, total: expected.length };
}

export interface ScenarioTransferChange {
  readonly property: string;
  readonly value: string;
}

function declarations(code: string): ReadonlyMap<string, string> | null {
  const cleaned = code.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (
    !cleaned ||
    cleaned.includes("/*") ||
    cleaned.includes("*/") ||
    /[{}@]/.test(cleaned)
  ) {
    return null;
  }
  const pairs = new Map<string, string>();
  for (const declaration of cleaned.split(";")) {
    if (!declaration.trim()) continue;
    const separator = declaration.indexOf(":");
    if (separator < 1 || separator !== declaration.lastIndexOf(":")) {
      return null;
    }
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = normalizeValue(declaration.slice(separator + 1));
    if (
      !/^[a-z][a-z0-9-]*$/.test(property) ||
      !/^[a-z0-9.-]+(?:\s+[a-z0-9.-]+)*$/.test(value) ||
      pairs.has(property)
    ) {
      return null;
    }
    pairs.set(property, value);
  }
  return pairs;
}

export function scenarioTransferChanges(
  kind: ScenarioLessonKind,
  code: string,
): readonly ScenarioTransferChange[] | null {
  const parsed = declarations(code);
  if (!parsed) return null;
  const expected: readonly (readonly [string, string])[] =
    kind === "flex-v1"
      ? [
          ["display", "flex"],
          ["gap", "24px"],
          ["justify-content", "space-between"],
          ["align-items", "center"],
        ]
      : [
          ["position", "absolute"],
          ["top", "16px"],
          ["right", "16px"],
        ];
  if (
    parsed.size !== expected.length ||
    expected.some(([property, value]) => parsed.get(property) !== value)
  ) {
    return null;
  }
  return Object.freeze(
    [...parsed].map(([property, value]) => Object.freeze({ property, value })),
  );
}

export function isCorrectScenarioTransfer(
  kind: ScenarioLessonKind,
  code: string,
): boolean {
  return scenarioTransferChanges(kind, code) !== null;
}

export function reduceScenarioLesson(
  state: ScenarioLessonState,
  event: ScenarioLessonRecordedEvent,
): ScenarioLessonState {
  if (event.type === "scenario-start") {
    return Object.freeze({
      ...INITIAL_SCENARIO_LESSON,
      lessonKind: event.lessonKind,
      sessionId: event.sessionId,
      phase: "predict",
      blocks: Object.freeze(event.blocks),
      personalizedOrigin: event.personalizedOrigin ?? null,
      startedAt: event.at,
    });
  }
  if (!state.sessionId || event.sessionId !== state.sessionId || !state.lessonKind) {
    return state;
  }

  if (event.type === "scenario-predict") {
    if (state.phase !== "predict") return state;
    const passed = predictionPasses(state.lessonKind, event.answer);
    return Object.freeze({
      ...state,
      phase: "observe",
      prediction: event.answer,
      predictionCorrect: passed,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          state.lessonKind,
          event,
          "prediction",
          passed,
          state.lessonKind === "flex-v1"
            ? "预测 gap 只增加相邻项目之间的间隔，不改变项目自身尺寸"
            : "预测 absolute 元素脱离普通文档流，relative 元素仍保留原位置",
          event.answer,
          passed ? "预测符合当前 CSS 规则" : "保留原判断，等待亲手观察后修正",
        ),
      ]),
    });
  }

  if (event.type === "scenario-experiment-saved") {
    if (
      state.phase !== "observe" ||
      !state.blocks.some((block) => block.blockId === event.blockId)
    ) {
      return state;
    }
    const passed = observationPasses(state, event);
    const observations = Object.freeze([
      ...state.observations,
      Object.freeze({
        eventId: event.eventId,
        blockId: event.blockId,
        revisionId: event.revisionId,
        property: event.property,
        value: event.value,
        passed,
      }),
    ]);
    const provisional = Object.freeze({ ...state, observations });
    const progress = scenarioObservationProgress(provisional);
    return Object.freeze({
      ...provisional,
      phase: progress.completed === progress.total ? "explain" : state.phase,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          state.lessonKind,
          event,
          "observation",
          passed,
          state.lessonKind === "flex-v1"
            ? "保存 gap、主轴对齐和交叉轴对齐三个目标变化"
            : "分别保存 static、relative 和 absolute 的偏移实验",
          `${event.property}=${event.value}; revision=${event.revisionId}`,
          passed
            ? `第 ${progress.completed}/${progress.total} 个目标操作已保存`
            : "这次保存未达到当前目标，记录保留但课程不会跳步",
        ),
      ]),
    });
  }

  if (event.type === "scenario-explain") {
    if (state.phase !== "explain" || state.explanationAttempts >= 3) {
      return state;
    }
    const passed = explanationPasses(state.lessonKind, event.answer);
    return Object.freeze({
      ...state,
      phase: passed ? "transfer" : state.phase,
      explanation: event.answer,
      explanationCorrect: passed,
      explanationAttempts: state.explanationAttempts + 1,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          state.lessonKind,
          event,
          "explanation",
          passed,
          state.lessonKind === "flex-v1"
            ? "区分主轴、交叉轴和 gap 各自控制的关系"
            : "解释 absolute 的脱流行为及其最近定位祖先",
          event.answer,
          passed ? "因果解释成立" : "因果解释尚未成立，继续给固定事实提示",
        ),
      ]),
    });
  }

  if (event.type === "scenario-support") {
    if (
      state.phase === "idle" ||
      state.phase === "complete" ||
      event.phase !== state.phase ||
      state.supportHistory.length >= 64
    ) {
      return state;
    }
    if (event.action === "hint") {
      const hintCount = state.supportHistory.filter(
        (item) => item.phase === state.phase && item.action === "hint",
      ).length;
      if (hintCount >= 3 || event.hintLevel !== hintCount + 1) return state;
    }
    const losesIndependentCredit =
      event.action === "skip" ||
      event.action === "demonstration" ||
      event.action === "teacher-takeover" ||
      (event.action === "hint" && event.hintLevel === 3);
    const advancesWithSupport =
      event.action === "skip" || event.action === "demonstration";
    const nextPhase = advancesWithSupport
      ? state.phase === "predict"
        ? "observe"
        : state.phase === "observe"
          ? "explain"
          : state.phase === "explain"
            ? "transfer"
            : state.phase
      : state.phase;
    return Object.freeze({
      ...state,
      phase: nextPhase,
      prediction:
        advancesWithSupport && state.phase === "predict"
          ? "unsure"
          : state.prediction,
      predictionCorrect:
        advancesWithSupport && state.phase === "predict"
          ? false
          : state.predictionCorrect,
      explanationCorrect:
        advancesWithSupport && state.phase === "explain"
          ? false
          : state.explanationCorrect,
      independentCreditEligible:
        state.independentCreditEligible && !losesIndependentCredit,
      supportHistory: Object.freeze([
        ...state.supportHistory,
        Object.freeze({
          eventId: event.eventId,
          at: event.at,
          phase: event.phase,
          action: event.action,
          hintLevel: event.hintLevel,
        }),
      ]),
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          state.lessonKind,
          event,
          "support",
          false,
          "支架、跳过、超时与接手必须显式记录，不能冒充独立达成",
          `phase=${event.phase}; action=${event.action}; hint=${event.hintLevel ?? "none"}`,
          event.action === "hint" && event.hintLevel
            ? `查看第 ${event.hintLevel} 层提示；${SUPPORT_DETAIL[event.action]}`
            : SUPPORT_DETAIL[event.action],
        ),
      ]),
    });
  }

  if (event.type === "scenario-attach-transfer") {
    if (state.phase !== "transfer") return state;
    return Object.freeze({ ...state, transferBlockId: event.blockId });
  }

  if (event.type === "scenario-transfer-submit") {
    if (state.phase !== "transfer" || !state.transferBlockId) return state;
    const passed = isCorrectScenarioTransfer(state.lessonKind, event.code);
    return Object.freeze({
      ...state,
      phase: passed ? "complete" : state.phase,
      transferCode: event.code,
      transferPassed: passed,
      completedAt: passed ? event.at : null,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          state.lessonKind,
          event,
          "transfer",
          passed,
          state.independentCreditEligible
            ? "在结构不同的新页面独立写出目标 CSS，不复用原实验节点"
            : "在结构不同的新页面完成目标 CSS，但本轮使用过示范或跳过",
          event.code.trim() || "空答案",
          passed
            ? state.independentCreditEligible
              ? "新页面迁移通过"
              : "代码运行正确；因本轮使用过示范或跳过，只记为有支架完成"
            : "迁移代码未满足全部确定性规则",
        ),
      ]),
    });
  }

  return state;
}

export function replayScenarioLessonEvents(
  events: readonly ScenarioLessonRecordedEvent[],
): ScenarioLessonState {
  return events.reduce<ScenarioLessonState>(
    (state, event) => reduceScenarioLesson(state, event),
    INITIAL_SCENARIO_LESSON,
  );
}

export function scenarioLessonElapsedSeconds(
  state: ScenarioLessonState,
): number | null {
  if (!state.startedAt || !state.completedAt) return null;
  const elapsed =
    new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 1000) : null;
}
