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
const LEARNING_SCAFFOLD_TOOLS = new Set<TutorToolName>([
  "create_css_controller",
]);

const TAKEOVER_ACTIONS = new Set(["demonstration", "teacher-takeover"]);

export function isTutorToolLessonIndependent(tool: TutorToolName): boolean {
  return NON_ANSWERING_TOOLS.has(tool) || LEARNING_SCAFFOLD_TOOLS.has(tool);
}

export interface TutorLessonGateDecision {
  readonly allowed: boolean;
  readonly code:
    | "NO_ACTIVE_LESSON"
    | "READ_ONLY"
    | "LEARNING_SCAFFOLD"
    | "GUIDED_TAKEOVER"
    | "WAIT_FOR_STUDENT";
  readonly message: string;
}

export function evaluateTutorToolLessonGate(
  tool: TutorToolName,
  lessonState: LearningLessonState | null,
): TutorLessonGateDecision {
  if (NON_ANSWERING_TOOLS.has(tool)) {
    return {
      allowed: true,
      code: "READ_ONLY",
      message: "此操作不会替学生完成课程答案。",
    };
  }
  if (LEARNING_SCAFFOLD_TOOLS.has(tool)) {
    return {
      allowed: true,
      code: "LEARNING_SCAFFOLD",
      message: "此操作只创建学习控件，具体数值仍由学生选择。",
    };
  }
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
