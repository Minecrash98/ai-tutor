import type {
  LearningLessonState,
  TutorToolName,
} from "@ai-tutor/contracts";

const NON_ANSWERING_TOOLS = new Set<TutorToolName>([
  "read_canvas_state",
  "inspect_selected_element",
  "read_relevant_source",
  "read_last_student_action",
  "read_teaching_assertion_evidence",
  "focus_block",
]);

const TAKEOVER_ACTIONS = new Set(["demonstration", "teacher-takeover"]);

export interface TutorLessonGateDecision {
  readonly allowed: boolean;
  readonly code:
    | "NO_ACTIVE_LESSON"
    | "READ_ONLY"
    | "GUIDED_TAKEOVER"
    | "WAIT_FOR_STUDENT";
  readonly message: string;
}

export function evaluateTutorToolLessonGate(
  tool: TutorToolName,
  lessonState: LearningLessonState | null,
): TutorLessonGateDecision {
  if (
    !lessonState ||
    lessonState.phase === "idle" ||
    lessonState.phase === "complete"
  ) {
    return {
      allowed: true,
      code: "NO_ACTIVE_LESSON",
      message: "当前没有需要保护的独立作答步骤。",
    };
  }
  if (NON_ANSWERING_TOOLS.has(tool)) {
    return {
      allowed: true,
      code: "READ_ONLY",
      message: "此操作不会替学生完成课程答案。",
    };
  }
  if (
    !lessonState.independentCreditEligible &&
    lessonState.supportHistory.some((record) =>
      TAKEOVER_ACTIONS.has(record.action),
    )
  ) {
    return {
      allowed: true,
      code: "GUIDED_TAKEOVER",
      message: "学生已选择示范或老师接手，本轮按有帮助完成记录。",
    };
  }
  return {
    allowed: false,
    code: "WAIT_FOR_STUDENT",
    message:
      "这一步要留给学生自己完成。可以提问、查看画布或聚焦内容，但不能替学生改答案。",
  };
}
