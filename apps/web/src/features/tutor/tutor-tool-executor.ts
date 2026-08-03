import {
  parseTutorToolCall,
  type RealtimeToolResult,
  type TutorCssProperty,
  type TutorTopic,
} from "@ai-tutor/contracts";

export interface TutorCanvasOperations {
  readCanvasState(): string | Promise<string>;
  inspectSelectedElement(input: {
    readonly blockId: string;
  }): string | Promise<string>;
  readRelevantSource(input: {
    readonly blockId: string;
  }): string | Promise<string>;
  readLastStudentAction(): string | Promise<string>;
  readTeachingAssertionEvidence(input: {
    readonly blockId: string;
  }): string | Promise<string>;
  createMinimalVerification(input: {
    readonly blockId: string;
  }): string | Promise<string>;
  createExplanation(input: {
    readonly title: string;
    readonly summary: string;
  }): string | Promise<string>;
  createDemo(input: {
    readonly topic: TutorTopic;
    readonly title?: string;
  }): string | Promise<string>;
  applyCssChange(input: {
    readonly requestId?: string;
    readonly blockId: string;
    readonly selector: string;
    readonly property: TutorCssProperty;
    readonly value: string;
  }): string | Promise<string>;
  createController(input: {
    readonly blockId: string;
    readonly property: TutorCssProperty;
    readonly selector?: string;
  }): string | Promise<string>;
  createComparison(input: {
    readonly blockId: string;
  }): string | Promise<string>;
  focusBlock(input: { readonly blockId: string }): void | Promise<void>;
}

export interface TutorToolExecutor {
  execute(tool: string, argumentsValue: unknown): Promise<RealtimeToolResult>;
}

export function createTutorToolExecutor(
  operations: TutorCanvasOperations,
): TutorToolExecutor {
  const completed = new Map<
    string,
    { readonly digest: string; readonly result: RealtimeToolResult }
  >();
  const running = new Map<
    string,
    { readonly digest: string; readonly task: Promise<RealtimeToolResult> }
  >();

  const executeOnce = async (
    tool: string,
    argumentsValue: unknown,
  ): Promise<RealtimeToolResult> => {
    try {
      const call = parseTutorToolCall(tool, argumentsValue);
      switch (call.tool) {
        case "read_canvas_state":
          return {
            success: true,
            message: await operations.readCanvasState(),
          };
        case "inspect_selected_element":
          return {
            success: true,
            message: await operations.inspectSelectedElement({
              blockId: call.arguments.blockId,
            }),
          };
        case "read_relevant_source":
          return {
            success: true,
            message: await operations.readRelevantSource({
              blockId: call.arguments.blockId,
            }),
          };
        case "read_last_student_action":
          return {
            success: true,
            message: await operations.readLastStudentAction(),
          };
        case "read_teaching_assertion_evidence":
          return {
            success: true,
            message: await operations.readTeachingAssertionEvidence({
              blockId: call.arguments.blockId,
            }),
          };
        case "create_minimal_verification":
          return {
            success: true,
            message: await operations.createMinimalVerification({
              blockId: call.arguments.blockId,
            }),
          };
        case "create_explanation_block": {
          const blockId = await operations.createExplanation({
            title: call.arguments.title,
            summary: call.arguments.summary,
          });
          return { success: true, message: `已创建讲解块 ${blockId}。` };
        }
        case "create_demo_block": {
          const blockId = await operations.createDemo({
            topic: call.arguments.topic,
            ...(call.arguments.title ? { title: call.arguments.title } : {}),
          });
          return { success: true, message: `已创建独立演示块 ${blockId}。` };
        }
        case "apply_css_change": {
          const revisionId = await operations.applyCssChange({
            requestId: call.arguments.requestId,
            blockId: call.arguments.blockId,
            selector: call.arguments.selector,
            property: call.arguments.property,
            value: call.arguments.value,
          });
          return {
            success: true,
            message: `已保存 AI CSS 版本 ${revisionId}；原版本保持不变。`,
          };
        }
        case "create_css_controller": {
          const blockId = await operations.createController({
            blockId: call.arguments.blockId,
            property: call.arguments.property,
            ...(call.arguments.selector
              ? { selector: call.arguments.selector }
              : {}),
          });
          return { success: true, message: `已创建 CSS 控制器 ${blockId}。` };
        }
        case "create_comparison": {
          const comparisonId = await operations.createComparison({
            blockId: call.arguments.blockId,
          });
          return { success: true, message: `已创建版本对比 ${comparisonId}。` };
        }
        case "focus_block":
          await operations.focusBlock({ blockId: call.arguments.blockId });
          return {
            success: true,
            message: `已聚焦教学块 ${call.arguments.blockId}。`,
          };
      }
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "教学工具调用无效。",
      };
    }
  };

  return {
    async execute(tool, argumentsValue) {
      let requestId: string;
      let requestDigest: string;
      try {
        const parsed = parseTutorToolCall(tool, argumentsValue);
        requestId = parsed.arguments.requestId;
        requestDigest = JSON.stringify([parsed.tool, parsed.arguments]);
      } catch (error) {
        return {
          success: false,
          message:
            error instanceof Error ? error.message : "教学工具调用无效。",
        };
      }
      const previous = completed.get(requestId);
      if (previous) {
        return previous.digest === requestDigest
          ? previous.result
          : {
              success: false,
              message: "同一个操作编号不能对应两组不同参数。",
            };
      }
      const inFlight = running.get(requestId);
      if (inFlight) {
        return inFlight.digest === requestDigest
          ? inFlight.task
          : {
              success: false,
              message: "同一个操作编号不能对应两组不同参数。",
            };
      }
      const task = executeOnce(tool, argumentsValue).then((result) => {
        running.delete(requestId);
        completed.set(requestId, { digest: requestDigest, result });
        return result;
      });
      running.set(requestId, { digest: requestDigest, task });
      return task;
    },
  };
}
