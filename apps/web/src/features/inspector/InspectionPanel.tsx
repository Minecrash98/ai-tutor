"use client";

import type {
  BoxEdges,
  ElementTarget,
  InspectionDiagnostic,
  InspectionResult,
  MatchedCssRule,
} from "@ai-tutor/runtime-core";
import type { CodeRevision } from "@ai-tutor/teaching-model";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ENUM_CONTROLS,
  NUMERIC_CONTROLS,
  type CssExperimentChange,
} from "../canvas/p5-model";
import {
  studentElementBreadcrumbItems,
  studentElementLabel,
  studentElementLabelIsInferred,
  studentStyleValue,
} from "./element-language";

const ADVANCED_STYLES = [
  "display", "position", "width", "height", "box-sizing",
  "margin-top", "margin-right", "margin-bottom", "margin-left",
  "padding-top", "padding-right", "padding-bottom", "padding-left",
  "border-top-width", "gap", "flex-direction", "justify-content",
  "align-items", "top", "right", "bottom", "left", "color",
  "background-color", "font-size", "line-height",
] as const;

const DIAGNOSTIC_LABELS: Readonly<Record<string, string>> = {
  INSPECTION_NO_AUTHORED_RULE: "没有直接命中的作者规则；当前外观可能来自浏览器默认值或继承。",
  INSPECTION_INHERITED_STYLES: "检测到从祖先元素继承的样式，已在规则列表中标记。",
  INSPECTION_PSEUDO_ELEMENTS: "检测到 ::before / ::after；它们以伪元素规则单独列出。",
};

const PROPERTY_LABELS: Readonly<Record<string, string>> = {
  display: "排列方式",
  position: "位置方式",
  gap: "项目间距",
  width: "宽度",
  height: "高度",
  top: "离顶部",
  "box-sizing": "尺寸计算",
};

function edgeSummary(edges: BoxEdges): string {
  return [edges.top, edges.right, edges.bottom, edges.left]
    .map((value) => `${value}px`)
    .join(" · ");
}

function revisionLabel(
  revisions: readonly CodeRevision[],
  revision: CodeRevision,
  index: number,
): string {
  const parentIndex = revisions.findIndex(
    (candidate) => candidate.id === revision.parentRevisionId,
  );
  const branch =
    index > 0 && parentIndex >= 0 && parentIndex !== index - 1
      ? ` · 分支自 V${parentIndex + 1}`
      : "";
  return `V${index + 1}${branch} · ${revision.changeSummary}`;
}

function sourceLabel(rule: MatchedCssRule): string {
  const position =
    rule.source.line === null
      ? "内联"
      : `L${rule.source.line}:${rule.source.column ?? 1}`;
  return `${rule.source.filePath} · ${position}`;
}

function diagnosticText(diagnostic: InspectionDiagnostic): string {
  return DIAGNOSTIC_LABELS[diagnostic.code] ?? diagnostic.message;
}

function BoxModel({ result }: { result: InspectionResult }) {
  const { boxModel } = result;
  return (
    <div className="inspector-box-model" aria-label="元素占用空间">
      <div className="inspector-box-model__layer inspector-box-model__margin">
        <span>外侧空隙</span><small>{edgeSummary(boxModel.margin)}</small>
        <div className="inspector-box-model__layer inspector-box-model__border">
          <span>边框</span><small>{edgeSummary(boxModel.border)}</small>
          <div className="inspector-box-model__layer inspector-box-model__padding">
            <span>内侧空隙</span><small>{edgeSummary(boxModel.padding)}</small>
            <div className="inspector-box-model__content">
              <strong>{boxModel.content.width} × {boxModel.content.height}</strong>
              <small>内容区域</small>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function numberValue(value: string | undefined, min: number, max: number): number {
  const parsed = Number.parseFloat(value ?? "");
  return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : 0));
}

export function InspectionPanel({
  result,
  errorMessage,
  revisions,
  currentRevisionId,
  pendingChanges,
  lastLatencyMs,
  boxModelOverlay,
  onClose,
  onReselect,
  onSelectTarget,
  onApplyChange,
  onReset,
  onSave,
  onSwitchRevision,
  onFork,
  onCreateComparison,
  onToggleBoxModel,
}: {
  result: InspectionResult | null;
  errorMessage: string;
  revisions: readonly CodeRevision[];
  currentRevisionId: string;
  pendingChanges: Readonly<Record<string, string>>;
  lastLatencyMs: number | null;
  boxModelOverlay: boolean;
  onClose: () => void;
  onReselect: () => void;
  onSelectTarget: (target: ElementTarget) => void;
  onApplyChange: (change: CssExperimentChange) => void;
  onReset: () => void;
  onSave: () => void;
  onSwitchRevision: (revisionId: string) => void;
  onFork: () => void;
  onCreateComparison: (beforeRevisionId: string, afterRevisionId: string) => void;
  onToggleBoxModel: () => void;
}) {
  const inspectorRef = useRef<HTMLElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [advanced, setAdvanced] = useState(false);
  const [beforeRevisionId, setBeforeRevisionId] = useState(
    revisions.at(-2)?.id ?? revisions[0]?.id ?? currentRevisionId,
  );
  const [afterRevisionId, setAfterRevisionId] = useState(currentRevisionId);
  const hasResult = result !== null;

  useEffect(() => {
    const inspector = inspectorRef.current;
    const scroller = scrollRef.current;
    if (!inspector || !scroller) return;

    const keepWheelInsideInspector = (event: WheelEvent) => {
      event.stopPropagation();
      if (
        event.target instanceof Node &&
        !scroller.contains(event.target) &&
        event.deltaY !== 0
      ) {
        event.preventDefault();
        scroller.scrollBy({ top: event.deltaY });
      }
    };
    inspector.addEventListener("wheel", keepWheelInsideInspector, {
      passive: false,
    });
    return () =>
      inspector.removeEventListener("wheel", keepWheelInsideInspector);
  }, [hasResult]);

  const recommendedNumeric = useMemo(() => {
    if (!result) return NUMERIC_CONTROLS.slice(0, 3);
    if ((result.computedStyles.display ?? "").includes("flex")) {
      return NUMERIC_CONTROLS.filter((control) =>
        ["padding", "gap", "width"].includes(control.property),
      );
    }
    if (result.computedStyles.position !== "static") {
      return NUMERIC_CONTROLS.filter((control) =>
        ["top", "left", "padding"].includes(control.property),
      );
    }
    return NUMERIC_CONTROLS.filter((control) =>
      ["padding", "margin", "width"].includes(control.property),
    );
  }, [result]);

  if (!result) {
    return (
      <aside className="element-inspector element-inspector--empty">
        <div>
          <span>样式调整</span>
          <strong>{errorMessage || "还没有选中内容"}</strong>
          <small>点击“选择页面内容”，再点一下想调整的地方。</small>
          <button type="button" onClick={onReselect}>
            重新选择页面内容
          </button>
        </div>
      </aside>
    );
  }

  const keyProperties = [
    "display",
    "position",
    (result.computedStyles.display ?? "").includes("flex") ? "gap" : "width",
    result.computedStyles.position !== "static" ? "top" : "height",
    "box-sizing",
  ];
  const numericControls = advanced ? NUMERIC_CONTROLS : recommendedNumeric;
  const enumControls = advanced
    ? ENUM_CONTROLS
    : ENUM_CONTROLS.filter((control) =>
        ["box-sizing", (result.computedStyles.display ?? "").includes("flex")
          ? "justify-content"
          : "position"].includes(control.property),
      );
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;
  const elementLabel = studentElementLabel(result);
  const breadcrumbItems = studentElementBreadcrumbItems(result);
  const labelIsInferred = studentElementLabelIsInferred(result);
  const parentCandidate = result.relations?.parent ?? null;
  const likelyInnerContent = [
    "span",
    "strong",
    "em",
    "small",
    "p",
    "h1",
    "h2",
    "h3",
    "a",
  ].includes(result.tagName.toLowerCase());

  return (
    <aside
      ref={inspectorRef}
      className="element-inspector"
      aria-label="样式调整面板"
    >
      <header className="element-inspector__header">
        <div>
          <span>{advanced ? "CSS 详情" : "正在调整"}</span>
          <strong>已选中 {elementLabel}</strong>
          {labelIsInferred ? <small>根据页面结构推测</small> : null}
        </div>
        <div className="element-inspector__header-actions">
          <button
            className="element-inspector__reselect"
            type="button"
            onClick={onReselect}
          >
            选错了，重新选择
          </button>
          <button type="button" onClick={() => setAdvanced((value) => !value)}>
            {advanced ? "回到简洁模式" : "查看 CSS 详情"}
          </button>
          <button type="button" onClick={onClose} aria-label="关闭样式调整">×</button>
        </div>
      </header>

      <div ref={scrollRef} className="element-inspector__scroll">
        <nav
          className="element-inspector__breadcrumb"
          aria-label="所选内容在页面中的位置"
        >
          <span>位置</span>
          <ol>
            {breadcrumbItems.map((item, index) => (
              <li key={`${item.domPath}-${index}`}>
                {item.current ? (
                  <span aria-current="location">{item.label}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      onSelectTarget({
                        runtimeInstanceId: result.target.runtimeInstanceId,
                        domPath: item.domPath,
                      })
                    }
                  >
                    {item.label}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
        {likelyInnerContent && parentCandidate ? (
          <section className="element-inspector__recovery" role="status">
            <strong>可能选得太里面了</strong>
            <span>
              如果你想调整整块内容，可以直接切换到
              {studentElementLabel(parentCandidate)}。
            </span>
            <button
              type="button"
              onClick={() => onSelectTarget(parentCandidate.target)}
            >
              切换到{studentElementLabel(parentCandidate)}
            </button>
            <small>这是根据页面层级给出的建议，你仍可保留当前选择。</small>
          </section>
        ) : null}
        {result.relations &&
        (result.relations.parent || result.relations.children.length > 0) ? (
          <section className="element-inspector__nearby">
            <h3>切换到附近内容</h3>
            <div>
              {result.relations.parent ? (
                <button
                  type="button"
                  onClick={() => onSelectTarget(result.relations!.parent!.target)}
                >
                  上一级：{studentElementLabel(result.relations.parent)}
                </button>
              ) : null}
              {result.relations.children.map((candidate, index) => (
                <button
                  type="button"
                  key={candidate.domPath}
                  onClick={() => onSelectTarget(candidate.target)}
                >
                  里面第 {index + 1} 项：{studentElementLabel(candidate)}
                </button>
              ))}
            </div>
          </section>
        ) : null}
        {advanced ? (
          <section className="element-inspector__target">
            <code title={result.domPath}>{result.domPath}</code>
            <small>{result.boundingRect.width} × {result.boundingRect.height}</small>
          </section>
        ) : null}

        <section>
          <div className="element-inspector__section-title">
            <h3>这个元素占了多大空间</h3>
            <button type="button" aria-pressed={boxModelOverlay} onClick={onToggleBoxModel}>
              {boxModelOverlay ? "收起页面标记" : "在页面上标出来"}
            </button>
          </div>
          <BoxModel result={result} />
        </section>

        <section>
          <h3>它现在怎么排</h3>
          <dl className="element-inspector__styles">
            {keyProperties.map((property) => (
              <div key={property}>
                <dt>{PROPERTY_LABELS[property] ?? property}</dt>
                <dd>
                  {studentStyleValue(
                    property,
                    result.computedStyles[property] ?? "",
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="css-teaching-controls">
          <div className="element-inspector__section-title">
            <h3>拖动看看变化</h3>
            {!advanced || lastLatencyMs === null ? null : (
              <span data-latency-pass={lastLatencyMs < 100 ? "true" : "false"}>
                {lastLatencyMs}ms
              </span>
            )}
          </div>
          <div className="css-teaching-controls__sliders">
            {numericControls.map((control) => {
              const value = numberValue(
                pendingChanges[control.property] ??
                  result.computedStyles[control.style],
                control.min,
                control.max,
              );
              return (
                <label key={control.property}>
                  <span><b>{control.label}</b><code>{value}px</code></span>
                  <input
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={value}
                    onChange={(event) =>
                      onApplyChange({
                        property: control.property,
                        value: `${event.currentTarget.value}px`,
                      })
                    }
                  />
                </label>
              );
            })}
          </div>
          <div className="css-teaching-controls__enums">
            {enumControls.map((control) => (
              <label key={control.property}>
                <span>{control.label}</span>
                <select
                  value={
                    pendingChanges[control.property] ??
                    result.computedStyles[control.property]
                  }
                  onChange={(event) =>
                    onApplyChange({
                      property: control.property,
                      value: event.currentTarget.value,
                    })
                  }
                >
                  {control.values.map((value) => <option key={value}>{value}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="css-teaching-controls__actions">
            <button type="button" disabled={!hasPendingChanges} onClick={onReset}>恢复原样</button>
            <button type="button" disabled={!hasPendingChanges} onClick={onSave}>保存这次变化</button>
          </div>
        </section>

        <section className="revision-controls">
          <h3>修改记录 · {revisions.length}</h3>
          <label>
            <span>正在查看</span>
            <select
              value={currentRevisionId}
              onChange={(event) => onSwitchRevision(event.currentTarget.value)}
            >
              {revisions.map((revision, index) => (
                <option key={revision.id} value={revision.id}>
                  {revisionLabel(revisions, revision, index)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onFork}>复制成新实验</button>
          {revisions.length > 1 ? (
            <div className="revision-controls__compare">
              <select
                aria-label="选择对比中的修改前版本"
                value={beforeRevisionId}
                onChange={(event) => setBeforeRevisionId(event.currentTarget.value)}
              >
                {revisions.map((revision, index) => (
                  <option key={revision.id} value={revision.id}>
                    V{index + 1} · 修改前
                  </option>
                ))}
              </select>
              <span>→</span>
              <select
                aria-label="选择对比中的修改后版本"
                value={afterRevisionId}
                onChange={(event) => setAfterRevisionId(event.currentTarget.value)}
              >
                {revisions.map((revision, index) => (
                  <option key={revision.id} value={revision.id}>
                    V{index + 1} · 修改后
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={beforeRevisionId === afterRevisionId}
                onClick={() => onCreateComparison(beforeRevisionId, afterRevisionId)}
              >
                对比这两次
              </button>
            </div>
          ) : null}
        </section>

        {advanced ? (
          <>
            <section>
              <h3>完整计算样式</h3>
              <dl className="element-inspector__styles">
                {ADVANCED_STYLES.map((property) => (
                  <div key={property}><dt>{property}</dt><dd>{result.computedStyles[property] || "—"}</dd></div>
                ))}
              </dl>
            </section>
            <section>
              <h3>命中规则 · {result.matchedRules.length}</h3>
              <div className="element-inspector__rules">
                {result.matchedRules.length === 0 ? <p>没有作者样式规则直接命中此元素。</p> : result.matchedRules.map((rule, index) => (
                  <article key={`${rule.sourceOrder}-${rule.selectorText}-${index}`} data-rule-inherited={rule.inheritedFrom ? "true" : "false"}>
                    <div><code>{rule.selectorText}</code>{rule.pseudoElement ? <b>{rule.pseudoElement}</b> : null}{rule.inheritedFrom ? <b>继承</b> : null}</div>
                    <small>{sourceLabel(rule)}</small>
                    <small>优先级 {rule.specificity.join("-")} · 顺序 {rule.sourceOrder + 1}</small>
                    <ul>{rule.declarations.map((declaration) => (
                      <li key={declaration.property}><code>{declaration.property}</code><span>{declaration.value}{declaration.important ? " !important" : ""}</span></li>
                    ))}</ul>
                  </article>
                ))}
              </div>
            </section>
            {result.diagnostics.length > 0 ? (
              <section>
                <h3>诊断</h3>
                <ul className="element-inspector__diagnostics">
                  {result.diagnostics.map((diagnostic) => <li key={diagnostic.code}>{diagnosticText(diagnostic)}</li>)}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </aside>
  );
}
