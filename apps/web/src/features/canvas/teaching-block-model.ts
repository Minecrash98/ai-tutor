import type { TeachingBlockType } from "@ai-tutor/teaching-model";

export const TEACHING_BLOCK_SHAPE_TYPE = "teaching-block" as const;
export const TEACHING_SHAPE_PREFIX = "shape:teaching-" as const;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface TeachingBlockDefinition {
  readonly label: string;
  readonly shortLabel: string;
  readonly summary: string;
  readonly stage: string;
  readonly width: number;
  readonly height: number;
}

export const TEACHING_BLOCK_TYPES: readonly TeachingBlockType[] = [
  "explanation",
  "runnable",
  "comparison",
  "css-controller",
  "annotation",
  "group",
];

export const TEACHING_BLOCK_DEFINITIONS: Readonly<
  Record<TeachingBlockType, TeachingBlockDefinition>
> = {
  explanation: {
    label: "知识卡",
    shortLabel: "讲解",
    summary: "用一句话讲清楚一个 CSS 现象。",
    stage: "learning",
    width: 360,
    height: 228,
  },
  runnable: {
    label: "实验页面",
    shortLabel: "实验",
    summary: "在页面里点选和观察元素。",
    stage: "learning",
    width: 540,
    height: 430,
  },
  comparison: {
    label: "看看哪里变了",
    shortLabel: "对比",
    summary: "把修改前后放在一起看。",
    stage: "learning",
    width: 480,
    height: 286,
  },
  "css-controller": {
    label: "拖动调一调",
    shortLabel: "调节",
    summary: "拖动滑块，马上看到页面变化。",
    stage: "learning",
    width: 360,
    height: 238,
  },
  annotation: {
    label: "记下重点",
    shortLabel: "重点",
    summary: "把一句重要结论留在画布上。",
    stage: "learning",
    width: 310,
    height: 190,
  },
  group: {
    label: "整理成一组",
    shortLabel: "分组",
    summary: "把相关内容整理到一起。",
    stage: "learning",
    width: 390,
    height: 220,
  },
};

export function createTeachingBlockId(
  kind: TeachingBlockType,
  seed = globalThis.crypto.randomUUID(),
): string {
  return `${kind}-${seed}`;
}

export function teachingBlockIdToShapeId(blockId: string): string {
  if (!blockId.trim()) {
    throw new Error("Teaching block id cannot be empty.");
  }

  return `${TEACHING_SHAPE_PREFIX}${blockId}`;
}

export function teachingShapeIdToBlockId(shapeId: string): string | null {
  return shapeId.startsWith(TEACHING_SHAPE_PREFIX)
    ? shapeId.slice(TEACHING_SHAPE_PREFIX.length)
    : null;
}
