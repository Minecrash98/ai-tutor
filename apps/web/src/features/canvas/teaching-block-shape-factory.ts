import type { TeachingBlockType } from "@ai-tutor/teaching-model";
import type { TLShapeId, TLShapePartial } from "tldraw";

import type { TeachingBlockShape } from "./TeachingBlockShape";
import {
  createTeachingBlockId,
  TEACHING_BLOCK_DEFINITIONS,
  TEACHING_BLOCK_SHAPE_TYPE,
  teachingBlockIdToShapeId,
  type Point,
} from "./teaching-block-model";

export function makeTeachingBlockShape(
  kind: TeachingBlockType,
  point: Point,
  seed?: string,
): TLShapePartial<TeachingBlockShape> {
  const definition = TEACHING_BLOCK_DEFINITIONS[kind];
  const blockId = createTeachingBlockId(kind, seed);

  return {
    id: teachingBlockIdToShapeId(blockId) as TLShapeId,
    type: TEACHING_BLOCK_SHAPE_TYPE,
    x: point.x,
    y: point.y,
    props: {
      w: definition.width,
      h: definition.height,
      blockId,
      kind,
      title: definition.label,
      summary: definition.summary,
      stage: definition.stage,
    },
  };
}
