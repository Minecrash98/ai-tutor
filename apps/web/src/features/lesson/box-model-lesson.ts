import {
  BOX_MODEL_LESSON_STATE_VERSION,
  LEARNING_PROOF_SCHEMA_VERSION,
  type BoxModelLessonEvidence,
  type BoxModelLessonRecordedEvent,
  type BoxModelLessonState,
  type LearningSupportAction,
} from "@ai-tutor/contracts";
import { BOX_MODEL_COURSE } from "@ai-tutor/curriculum";

export type {
  BoxModelExplanation,
  BoxModelLessonEvidence,
  BoxModelLessonRecordedEvent,
  BoxModelLessonState,
  BoxModelPrediction,
} from "@ai-tutor/contracts";

export type BoxModelLessonPhase = BoxModelLessonState["phase"];

export const INITIAL_BOX_MODEL_LESSON: BoxModelLessonState = Object.freeze({
  version: BOX_MODEL_LESSON_STATE_VERSION,
  sessionId: null,
  phase: "idle",
  lessonBlockId: null,
  transferBlockId: null,
  prediction: null,
  predictionCorrect: null,
  observedPaddingPx: null,
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

export type BoxModelLessonEvent =
  | BoxModelLessonRecordedEvent
  | { readonly type: "reset" };

function evidence(
  event: BoxModelLessonRecordedEvent,
  kind: BoxModelLessonEvidence["kind"],
  passed: boolean,
  criterion: string,
  observed: string,
  detail: string,
): BoxModelLessonEvidence {
  return Object.freeze({
    schemaVersion: LEARNING_PROOF_SCHEMA_VERSION,
    id: `${event.eventId}:${kind}`,
    eventId: event.eventId,
    at: event.at,
    kind,
    skillId: BOX_MODEL_COURSE.skillId,
    evaluatorId: BOX_MODEL_COURSE.evaluatorId,
    passed,
    criterion,
    observed,
    detail,
  });
}

function parsePx(value: string): number | null {
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)px$/i);
  if (!match?.[1]) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

const SUPPORT_DETAIL: Readonly<Record<LearningSupportAction, string>> = {
  hint: "学生主动查看了一层提示；提示使用会留在学习记录中",
  skip: "学生选择跳过当前步骤；本轮只记为有支架完成",
  demonstration: "学生选择直接看示范；本轮不计独立达成",
  timeout: "等待时间已到；课程停在原步骤并提供恢复入口",
  "teacher-takeover": "学生请求老师接手；本轮不计独立达成",
};

export interface TransferDeclarationEvaluation {
  readonly passed: boolean;
  readonly normalizedValue: string | null;
  readonly message: string;
}

export interface BoxModelWidthBreakdown {
  readonly contentPx: number;
  readonly horizontalPaddingPx: number;
  readonly borderPx: number;
  readonly totalPx: number;
}

export function boxModelWidthBreakdown(
  paddingPx: number,
): BoxModelWidthBreakdown {
  const safePadding = Number.isFinite(paddingPx) ? paddingPx : 0;
  const contentPx = 280;
  const borderPx = 8;
  const horizontalPaddingPx = safePadding * 2;
  return Object.freeze({
    contentPx,
    horizontalPaddingPx,
    borderPx,
    totalPx: contentPx + horizontalPaddingPx + borderPx,
  });
}

export function evaluateTransferDeclaration(
  code: string,
): TransferDeclarationEvaluation {
  const normalized = code.replace(/\/\*[\s\S]*?\*\//g, "").trim();
  if (
    !normalized ||
    normalized.includes("{") ||
    normalized.includes("}") ||
    normalized.includes("@") ||
    normalized.includes("/*")
  ) {
    return {
      passed: false,
      normalizedValue: null,
      message: "这里只写一条 CSS 声明，不要加入选择器、花括号或规则块。",
    };
  }
  const declaration = normalized.match(/^([a-z-]+)\s*:\s*([^;]+)\s*;?$/i);
  if (!declaration) {
    return {
      passed: false,
      normalizedValue: null,
      message: "这里只写一条 CSS 声明；多条样式不能作为这道题的答案。",
    };
  }
  if (declaration[1]?.toLowerCase() !== "padding") {
    return {
      passed: false,
      normalizedValue: null,
      message: "这道题练的是内边距 padding，不是 margin 或其他属性。",
    };
  }
  const tokens = declaration[2]!.trim().split(/\s+/);
  const allSidesAreTwenty =
    tokens.length >= 1 &&
    tokens.length <= 4 &&
    tokens.every((token) => {
      const length = token.match(/^(\d+(?:\.\d+)?)px$/i);
      return Number(length?.[1]) === 20;
    });
  if (!allSidesAreTwenty) {
    return {
      passed: false,
      normalizedValue: null,
      message: "请把四个方向的 padding 都设为 20px；不要用同像素的定位或尺寸技巧绕过目标。",
    };
  }
  return {
    passed: true,
    normalizedValue: tokens.map(() => "20px").join(" "),
    message: "四个方向的内边距都是 20px。",
  };
}

export function isCorrectTransferDeclaration(code: string): boolean {
  return evaluateTransferDeclaration(code).passed;
}

export function reduceBoxModelLesson(
  state: BoxModelLessonState,
  event: BoxModelLessonEvent,
): BoxModelLessonState {
  if (event.type === "reset") return INITIAL_BOX_MODEL_LESSON;

  if (event.type === "start") {
    return Object.freeze({
      ...INITIAL_BOX_MODEL_LESSON,
      sessionId: event.sessionId,
      phase: "predict",
      lessonBlockId: event.blockId,
      personalizedOrigin: event.personalizedOrigin ?? null,
      startedAt: event.at,
    });
  }

  if (!state.sessionId || event.sessionId !== state.sessionId) return state;

  if (event.type === "predict") {
    if (state.phase !== "predict") return state;
    const passed = event.answer === "grows";
    return Object.freeze({
      ...state,
      phase: "observe",
      prediction: event.answer,
      predictionCorrect: passed,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          event,
          "prediction",
          passed,
          "预测 content-box 在内容宽度不变时，左右 padding 增大会让总宽变大",
          event.answer,
          `预测卡片总宽${event.answer === "grows" ? "会变大" : event.answer === "same" ? "不变" : "不知道"}`,
        ),
      ]),
    });
  }

  if (event.type === "experiment-saved") {
    if (
      state.phase !== "observe" ||
      event.blockId !== state.lessonBlockId ||
      event.property !== "padding"
    ) {
      return state;
    }
    const value = parsePx(event.value);
    if (value === null) return state;
    const reachedTarget = value === 32;
    return Object.freeze({
      ...state,
      phase: reachedTarget ? "explain" : state.phase,
      observedPaddingPx: value,
      evidence: reachedTarget
        ? Object.freeze([
            ...state.evidence,
            evidence(
              event,
              "observation",
              true,
              "亲手把目标卡片的 padding 从 16px 调到 32px并保存版本",
              `padding=${event.value}; revision=${event.revisionId}`,
              "亲手把 padding 从 16px 调到 32px，并保存了不可变版本",
            ),
          ])
        : state.evidence,
    });
  }

  if (event.type === "explain") {
    if (state.phase !== "explain" || state.explanationAttempts >= 3) {
      return state;
    }
    const passed = event.answer === "content-plus-padding";
    return Object.freeze({
      ...state,
      phase: passed ? "transfer" : state.phase,
      explanationCorrect: passed,
      explanationAttempts: state.explanationAttempts + 1,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          event,
          "explanation",
          passed,
          "解释 content-box 的 width、左右 padding 与总宽之间的因果关系",
          event.answer,
          passed
            ? "指出 content-box 的 width 只算内容区，左右 padding 会加到总宽"
            : "因果解释尚未通过，再给一级提示",
        ),
      ]),
    });
  }

  if (event.type === "support") {
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
      observedPaddingPx:
        event.action === "demonstration" && state.phase === "observe"
          ? 32
          : state.observedPaddingPx,
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

  if (event.type === "attach-transfer") {
    if (state.phase !== "transfer") return state;
    return Object.freeze({ ...state, transferBlockId: event.blockId });
  }

  if (event.type === "transfer-submit") {
    if (state.phase !== "transfer" || !state.transferBlockId) return state;
    const passed = isCorrectTransferDeclaration(event.code);
    return Object.freeze({
      ...state,
      phase: passed ? "complete" : state.phase,
      transferCode: event.code,
      transferPassed: passed,
      completedAt: passed ? event.at : null,
      evidence: Object.freeze([
        ...state.evidence,
        evidence(
          event,
          "transfer",
          passed,
          state.independentCreditEligible
            ? "在结构不同的新页面中独立写出目标 CSS 声明"
            : "在结构不同的新页面中完成目标 CSS 声明，但本轮使用过示范或跳过",
          event.code,
          passed
            ? state.independentCreditEligible
              ? "在结构不同的提示卡中独立写出 padding: 20px"
              : "代码运行正确；因本轮使用过示范或跳过，只记为有支架完成"
            : "迁移代码尚未满足目标约束",
        ),
      ]),
    });
  }

  return state;
}

export function replayBoxModelLessonEvents(
  events: readonly BoxModelLessonRecordedEvent[],
): BoxModelLessonState {
  return events.reduce<BoxModelLessonState>(
    (state, event) => reduceBoxModelLesson(state, event),
    INITIAL_BOX_MODEL_LESSON,
  );
}

export function lessonElapsedSeconds(state: BoxModelLessonState): number | null {
  if (!state.startedAt || !state.completedAt) return null;
  const elapsed =
    new Date(state.completedAt).getTime() - new Date(state.startedAt).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed / 1000) : null;
}
