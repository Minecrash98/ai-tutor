"use client";

import type { TeachingBlockType } from "@ai-tutor/teaching-model";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  T,
  type TLBaseShape,
} from "tldraw";

import {
  TEACHING_BLOCK_DEFINITIONS,
  TEACHING_BLOCK_SHAPE_TYPE,
  TEACHING_BLOCK_TYPES,
} from "./teaching-block-model";
import {
  ComparisonBlockRuntime,
  CssControllerBlockRuntime,
  RunnableBlockRuntime,
} from "./runtime-project-context";

export interface TeachingBlockShapeProps {
  w: number;
  h: number;
  blockId: string;
  kind: TeachingBlockType;
  title: string;
  summary: string;
  stage: string;
  sourceBlockId?: string;
  cssProperty?: string;
  cssSelector?: string;
}

export type TeachingBlockShape = TLBaseShape<
  typeof TEACHING_BLOCK_SHAPE_TYPE,
  TeachingBlockShapeProps
>;

declare module "@tldraw/tlschema" {
  export interface TLGlobalShapePropsMap {
    [TEACHING_BLOCK_SHAPE_TYPE]: TeachingBlockShapeProps;
  }
}

function BlockPreview({
  kind,
  blockId,
  sourceBlockId,
  cssProperty,
  cssSelector,
  title,
  summary,
}: {
  kind: TeachingBlockType;
  blockId: string;
  sourceBlockId: string | undefined;
  cssProperty: string | undefined;
  cssSelector: string | undefined;
  title: string;
  summary: string;
}) {
  if (kind === "runnable") {
    return <RunnableBlockRuntime blockId={blockId} />;
  }

  if (kind === "comparison") {
    return <ComparisonBlockRuntime blockId={blockId} />;
  }

  if (kind === "css-controller") {
    const legacySourceBlockId = summary.match(/^绑定 ([^；\s]+)/)?.[1];
    const legacyProperty = title.match(/^控制 · (.+)$/)?.[1];
    const linkedSourceBlockId = sourceBlockId ?? legacySourceBlockId;
    const linkedProperty = cssProperty ?? legacyProperty;
    if (linkedSourceBlockId && linkedProperty) {
      return (
        <CssControllerBlockRuntime
          sourceBlockId={linkedSourceBlockId}
          selector={cssSelector ?? "#demo"}
          property={linkedProperty}
        />
      );
    }

    return (
      <div className="teaching-block__control">
        <small>先创建一个实验页面，再选择想调整的内容。</small>
      </div>
    );
  }

  if (kind === "group") {
    return (
      <div className="teaching-block__tags">
        <span>概念</span>
        <span>实验</span>
        <span>验证</span>
      </div>
    );
  }

  if (kind === "annotation") {
    return (
      <blockquote>
        改变一个值，观察一个结果。
      </blockquote>
    );
  }

  return (
    <ul className="teaching-block__steps">
      <li>看见规则</li>
      <li>提出假设</li>
      <li>连接实验</li>
    </ul>
  );
}

function TeachingBlockContent({ shape }: { shape: TeachingBlockShape }) {
  const definition = TEACHING_BLOCK_DEFINITIONS[shape.props.kind];
  const showSummary = !["runnable", "comparison", "css-controller"].includes(
    shape.props.kind,
  );

  return (
    <article
      className={`teaching-block teaching-block--${shape.props.kind}`}
      data-block-kind={shape.props.kind}
      data-teaching-block-id={shape.props.blockId}
      data-source-block-id={shape.props.sourceBlockId}
    >
      <header className="teaching-block__header">
        <span>{definition.shortLabel}</span>
      </header>
      <div className="teaching-block__body">
        <h2>{shape.props.title}</h2>
        {showSummary ? <p>{shape.props.summary}</p> : null}
        <BlockPreview
          kind={shape.props.kind}
          blockId={shape.props.blockId}
          sourceBlockId={shape.props.sourceBlockId}
          cssProperty={shape.props.cssProperty}
          cssSelector={shape.props.cssSelector}
          title={shape.props.title}
          summary={shape.props.summary}
        />
      </div>
    </article>
  );
}

export class TeachingBlockShapeUtil extends BaseBoxShapeUtil<TeachingBlockShape> {
  static override type = TEACHING_BLOCK_SHAPE_TYPE;

  static override props = {
    w: T.number,
    h: T.number,
    blockId: T.string,
    kind: T.literalEnum(...TEACHING_BLOCK_TYPES),
    title: T.string,
    summary: T.string,
    sourceBlockId: T.optional(T.string),
    cssProperty: T.optional(T.string),
    cssSelector: T.optional(T.string),
    stage: T.string,
  };

  override getDefaultProps(): TeachingBlockShape["props"] {
    const definition = TEACHING_BLOCK_DEFINITIONS.explanation;

    return {
      w: definition.width,
      h: definition.height,
      blockId: "explanation-default",
      kind: "explanation",
      title: definition.label,
      summary: definition.summary,
      stage: definition.stage,
    };
  }

  override canResize() {
    return true;
  }

  override isAspectRatioLocked() {
    return false;
  }

  component(shape: TeachingBlockShape) {
    return (
      <HTMLContainer
        id={shape.id}
        className="teaching-block-container"
        style={{ width: shape.props.w, height: shape.props.h }}
      >
        <TeachingBlockContent shape={shape} />
      </HTMLContainer>
    );
  }

  indicator(shape: TeachingBlockShape) {
    return (
      <rect
        width={shape.props.w}
        height={shape.props.h}
        rx={18}
        ry={18}
      />
    );
  }

  getIndicatorPath(shape: TeachingBlockShape) {
    const path = new Path2D();
    path.roundRect(0, 0, shape.props.w, shape.props.h, 18);
    return path;
  }
}
