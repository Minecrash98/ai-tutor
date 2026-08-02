"use client";

import type {
  ElementTarget,
  InspectionResult,
  RuntimeComparisonViewportState,
  RuntimeHandle,
} from "@ai-tutor/runtime-core";
import { staticHtmlCssAdapter } from "@ai-tutor/runtime-static-html";
import type {
  CodeRevision,
} from "@ai-tutor/teaching-model";
import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

import {
  projectForRevision,
  type PreparedSourceRun,
} from "../editor/source-editor-model";
import type { RuntimeInspectionSnapshot } from "../tutor/teaching-facts";
import {
  buildLineDiff,
  comparisonExperimentCode,
  comparisonSourceCode,
  currentRevision,
  ENUM_CONTROLS,
  NUMERIC_CONTROLS,
  revisionById,
  savedTarget,
  type ComparisonMode,
  type ComparisonRecord,
  type CssExperimentChange,
  type RuntimeProjectRecord,
  type SavedElementTarget,
} from "./p5-model";

const InspectionPanel = dynamic(
  () =>
    import("../inspector/InspectionPanel").then(
      (module) => module.InspectionPanel,
    ),
  {
    ssr: false,
    loading: () => <div role="status">正在打开样式调整…</div>,
  },
);

const SourceEditorPanel = dynamic(
  () =>
    import("../editor/SourceEditorPanel").then(
      (module) => module.SourceEditorPanel,
    ),
  {
    ssr: false,
    loading: () => <div role="status">正在打开源码编辑…</div>,
  },
);

export type { RuntimeProjectRecord } from "./p5-model";

interface RuntimeCanvasActions {
  saveExperiment(
    blockId: string,
    target: SavedElementTarget,
    changes: readonly CssExperimentChange[],
    context?: {
      readonly beforeValues?: Readonly<Record<string, string>>;
    },
  ): Promise<void>;
  saveSourceRevision(
    blockId: string,
    prepared: PreparedSourceRun,
    summary: string,
  ): Promise<void>;
  switchRevision(blockId: string, revisionId: string): void;
  forkProject(blockId: string): Promise<void>;
  createComparison(
    blockId: string,
    beforeRevisionId: string,
    afterRevisionId: string,
    target?: SavedElementTarget,
  ): void;
  updateComparison(
    blockId: string,
    update: Partial<Pick<ComparisonRecord, "mode" | "wipePosition">>,
  ): void;
}

interface RuntimePreviewRegistration {
  apply(
    target: SavedElementTarget,
    change: CssExperimentChange,
  ): Promise<void>;
  reset(): Promise<void>;
}

interface RuntimePreviewBridge {
  register(
    blockId: string,
    registration: RuntimePreviewRegistration,
  ): () => void;
  apply(
    blockId: string,
    target: SavedElementTarget,
    change: CssExperimentChange,
  ): Promise<void>;
  reset(blockId: string): Promise<void>;
}

interface RuntimeInspectionRegistration {
  inspect(domPath: string): Promise<RuntimeInspectionSnapshot>;
}

export interface RuntimeInspectionBridge {
  isReady(blockId: string): boolean;
  inspect(blockId: string, domPath: string): Promise<RuntimeInspectionSnapshot>;
}

interface RuntimeInspectionRegistry extends RuntimeInspectionBridge {
  register(
    blockId: string,
    registration: RuntimeInspectionRegistration,
  ): () => void;
}

export interface TransientExperimentPreview {
  readonly target: SavedElementTarget;
  readonly changes: Readonly<Record<string, string>>;
  readonly baseRevisionId: string;
  readonly updatedAt: string;
}

export interface RuntimePreviewStore {
  get(blockId: string | null): TransientExperimentPreview | undefined;
  update(
    blockId: string,
    target: SavedElementTarget,
    change: CssExperimentChange,
    baseRevisionId: string,
  ): void;
  clear(blockId: string): void;
  subscribe(blockId: string | null, listener: () => void): () => void;
}

export function createRuntimePreviewStore(): RuntimePreviewStore {
  const previews = new Map<string, TransientExperimentPreview>();
  const listeners = new Map<string, Set<() => void>>();
  const notify = (blockId: string) => {
    for (const listener of listeners.get(blockId) ?? []) listener();
  };
  return {
    get(blockId) {
      return blockId ? previews.get(blockId) : undefined;
    },
    update(blockId, target, change, baseRevisionId) {
      const existing = previews.get(blockId);
      previews.set(blockId, {
        target,
        changes: {
          ...(existing?.target.domPath === target.domPath &&
          existing.baseRevisionId === baseRevisionId
            ? existing.changes
            : {}),
          [change.property]: change.value,
        },
        baseRevisionId,
        updatedAt: new Date().toISOString(),
      });
      notify(blockId);
    },
    clear(blockId) {
      if (!previews.delete(blockId)) return;
      notify(blockId);
    },
    subscribe(blockId, listener) {
      if (!blockId) return () => undefined;
      const current = listeners.get(blockId) ?? new Set<() => void>();
      current.add(listener);
      listeners.set(blockId, current);
      return () => {
        current.delete(listener);
        if (current.size === 0) listeners.delete(blockId);
      };
    },
  };
}

export function useRuntimePreview(
  store: RuntimePreviewStore,
  blockId: string | null,
): TransientExperimentPreview | undefined {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribe(blockId, listener),
    [blockId, store],
  );
  const getSnapshot = useCallback(
    () => store.get(blockId),
    [blockId, store],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}

const EMPTY_ACTIONS: RuntimeCanvasActions = {
  async saveExperiment() {},
  async saveSourceRevision() {},
  switchRevision() {},
  async forkProject() {},
  createComparison() {},
  updateComparison() {},
};

const EMPTY_PREVIEW_BRIDGE: RuntimePreviewBridge = {
  register() {
    return () => undefined;
  },
  async apply() {},
  async reset() {},
};

const EMPTY_INSPECTION_BRIDGE: RuntimeInspectionRegistry = {
  register() {
    return () => undefined;
  },
  isReady() {
    return false;
  },
  async inspect() {
    throw new Error("页面运行区还在准备，请稍后再试。");
  },
};
const EMPTY_PREVIEW_STORE = createRuntimePreviewStore();

interface RuntimeCanvasState {
  readonly projects: ReadonlyMap<string, RuntimeProjectRecord>;
  readonly comparisons: ReadonlyMap<string, ComparisonRecord>;
  readonly nearViewportBlockIds: ReadonlySet<string>;
  readonly actions: RuntimeCanvasActions;
  readonly preview: RuntimePreviewBridge;
  readonly previewStore: RuntimePreviewStore;
  readonly inspectionBridge: RuntimeInspectionRegistry;
  readonly reportInspection: (
    blockId: string,
    snapshot: RuntimeInspectionSnapshot | null,
  ) => void;
}

const EMPTY_RUNTIME_CANVAS_STATE: RuntimeCanvasState = {
  projects: new Map(),
  comparisons: new Map(),
  nearViewportBlockIds: new Set(),
  actions: EMPTY_ACTIONS,
  preview: EMPTY_PREVIEW_BRIDGE,
  previewStore: EMPTY_PREVIEW_STORE,
  inspectionBridge: EMPTY_INSPECTION_BRIDGE,
  reportInspection() {},
};

const RuntimeCanvasContext = createContext<RuntimeCanvasState>(
  EMPTY_RUNTIME_CANVAS_STATE,
);

export function RuntimeCanvasProvider({
  children,
  projects,
  comparisons,
  nearViewportBlockIds,
  actions,
  previewStore,
  onInspectionChange,
  onInspectionBridgeReady,
}: {
  children: ReactNode;
  projects: ReadonlyMap<string, RuntimeProjectRecord>;
  comparisons: ReadonlyMap<string, ComparisonRecord>;
  nearViewportBlockIds: ReadonlySet<string>;
  actions: RuntimeCanvasActions;
  previewStore: RuntimePreviewStore;
  onInspectionChange?: (
    blockId: string,
    snapshot: RuntimeInspectionSnapshot | null,
  ) => void;
  onInspectionBridgeReady?: (
    bridge: RuntimeInspectionBridge | null,
  ) => void;
}) {
  const previewRuntimesRef = useRef(
    new Map<string, RuntimePreviewRegistration>(),
  );
  const inspectionRuntimesRef = useRef(
    new Map<string, RuntimeInspectionRegistration>(),
  );
  const preview = useMemo<RuntimePreviewBridge>(
    () => ({
      register(blockId, registration) {
        previewRuntimesRef.current.set(blockId, registration);
        return () => {
          if (previewRuntimesRef.current.get(blockId) === registration) {
            previewRuntimesRef.current.delete(blockId);
          }
        };
      },
      async apply(blockId, target, change) {
        const registration = previewRuntimesRef.current.get(blockId);
        if (!registration) {
          throw new Error("目标运行块当前不可预览。");
        }
        const baseRevisionId = projects.get(blockId)?.currentRevisionId;
        if (!baseRevisionId) {
          throw new Error("目标运行块没有可用的当前版本。");
        }
        previewStore.update(blockId, target, change, baseRevisionId);
        await registration.apply(target, change);
      },
      async reset(blockId) {
        previewStore.clear(blockId);
        await previewRuntimesRef.current.get(blockId)?.reset();
      },
    }),
    [previewStore, projects],
  );
  const inspectionBridge = useMemo<RuntimeInspectionRegistry>(
    () => ({
      register(blockId, registration) {
        inspectionRuntimesRef.current.set(blockId, registration);
        return () => {
          if (inspectionRuntimesRef.current.get(blockId) === registration) {
            inspectionRuntimesRef.current.delete(blockId);
          }
        };
      },
      isReady(blockId) {
        return inspectionRuntimesRef.current.has(blockId);
      },
      async inspect(blockId, domPath) {
        const registration = inspectionRuntimesRef.current.get(blockId);
        if (!registration) {
          throw new Error("这个页面还在准备，请稍后再生成小课。");
        }
        return registration.inspect(domPath);
      },
    }),
    [],
  );
  useEffect(() => {
    onInspectionBridgeReady?.(inspectionBridge);
    return () => onInspectionBridgeReady?.(null);
  }, [inspectionBridge, onInspectionBridgeReady]);
  const reportInspection = useMemo(
    () =>
      (blockId: string, snapshot: RuntimeInspectionSnapshot | null) =>
        onInspectionChange?.(blockId, snapshot),
    [onInspectionChange],
  );
  return (
    <RuntimeCanvasContext.Provider
      value={{
        projects,
        comparisons,
        nearViewportBlockIds,
        actions,
        preview,
        previewStore,
        inspectionBridge,
        reportInspection,
      }}
    >
      {children}
    </RuntimeCanvasContext.Provider>
  );
}


function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function latestNumericCssValue(
  record: RuntimeProjectRecord,
  selector: string,
  property: string,
): number | null {
  let latest: number | null = null;
  const declarationPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegularExpression(property)}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)px(?:\\s*!important)?\\s*(?:;|$)`,
    "gi",
  );
  for (const file of Object.values(currentRevision(record).files)) {
    if (file.mimeType !== "text/css") continue;
    for (const block of file.content.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (block[1] ?? "")
        .split(",")
        .map((value) => value.trim());
      if (!selectors.includes(selector)) continue;
      const matches = [...(block[2] ?? "").matchAll(declarationPattern)];
      const value = Number(matches.at(-1)?.[1]);
      if (Number.isFinite(value)) latest = value;
    }
  }
  return latest;
}

function latestCssValue(
  record: RuntimeProjectRecord,
  selector: string,
  property: string,
): string | null {
  let latest: string | null = null;
  const declarationPattern = new RegExp(
    `(?:^|;)\\s*${escapeRegularExpression(property)}\\s*:\\s*([^;]+?)\\s*(?:;|$)`,
    "gi",
  );
  for (const file of Object.values(currentRevision(record).files)) {
    if (file.mimeType !== "text/css") continue;
    for (const block of file.content.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectors = (block[1] ?? "")
        .split(",")
        .map((value) => value.trim());
      if (!selectors.includes(selector)) continue;
      const matches = [...(block[2] ?? "").matchAll(declarationPattern)];
      const value = matches.at(-1)?.[1]?.trim();
      if (value) latest = value.replace(/\s*!important\s*$/i, "").trim();
    }
  }
  return latest;
}

function computedStyleValue(
  computedStyles: Readonly<Record<string, string>>,
  property: string,
): string | undefined {
  const expandedProperty = {
    padding: "padding-top",
    margin: "margin-top",
    "border-width": "border-top-width",
  }[property];
  return computedStyles[expandedProperty ?? property] ?? computedStyles[property];
}

export function CssControllerBlockRuntime({
  sourceBlockId,
  selector,
  property,
}: {
  sourceBlockId: string;
  selector: string;
  property: string;
}) {
  const { projects, actions, preview } = useContext(RuntimeCanvasContext);
  const record = projects.get(sourceBlockId);
  const control = NUMERIC_CONTROLS.find(
    (candidate) => candidate.property === property,
  );
  const enumControl = ENUM_CONTROLS.find(
    (candidate) => candidate.property === property,
  );
  const savedValue = record
    ? control
      ? latestNumericCssValue(record, selector, property)
      : latestCssValue(record, selector, property)
    : null;
  const initialValue =
    savedValue ?? control?.min ?? enumControl?.values[0] ?? "";
  const [draftValue, setDraftValue] = useState<number | string | null>(null);
  const value = draftValue ?? initialValue;
  const [status, setStatus] = useState("拖动时马上看到变化");
  const previewFrameRef = useRef<number | null>(null);
  const queuedPreviewValueRef = useRef<number | string | null>(null);
  const queuedPreviewStartedAtRef = useRef<number | null>(null);
  const commitInFlightRef = useRef(false);
  const lastCommittedValueRef = useRef<number | string | null>(null);

  useEffect(
    () => () => {
      if (previewFrameRef.current !== null) {
        window.cancelAnimationFrame(previewFrameRef.current);
      }
    },
    [],
  );

  if (!record || (!control && !enumControl)) {
    return (
      <div className="teaching-block__control">
        <small>这个调节项暂时找不到对应的页面内容。</small>
      </div>
    );
  }

  const cancelQueuedPreview = () => {
    if (previewFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    queuedPreviewValueRef.current = null;
  };

  const commitValue = async (nextValue = value) => {
    const cssValue =
      typeof nextValue === "number" ? `${nextValue}px` : nextValue;
    if (
      commitInFlightRef.current ||
      lastCommittedValueRef.current === nextValue
    ) {
      return;
    }
    cancelQueuedPreview();
    if (savedValue === nextValue) {
      await preview.reset(sourceBlockId);
      setDraftValue(null);
      setStatus("当前值已保存");
      return;
    }
    lastCommittedValueRef.current = nextValue;
    commitInFlightRef.current = true;
    setStatus("正在保存…");
    try {
      await preview
        .apply(
          sourceBlockId,
          { domPath: selector },
          { property, value: cssValue },
        )
        .catch(() => undefined);
      await actions.saveExperiment(
        sourceBlockId,
        { domPath: selector },
        [{ property, value: cssValue }],
        savedValue === null
          ? undefined
          : {
              beforeValues: {
                [property]:
                  typeof savedValue === "number"
                    ? `${savedValue}px`
                    : savedValue,
              },
            },
      );
      await preview.reset(sourceBlockId);
      setDraftValue(null);
      setStatus("已保存");
    } catch (error) {
      lastCommittedValueRef.current = null;
      await preview.reset(sourceBlockId).catch(() => undefined);
      setDraftValue(null);
      setStatus(error instanceof Error ? error.message : "保存失败");
    } finally {
      commitInFlightRef.current = false;
    }
  };

  const previewValue = (nextValue: number | string) => {
    setDraftValue(nextValue);
    setStatus("正在跟着变化…");
    queuedPreviewValueRef.current = nextValue;
    queuedPreviewStartedAtRef.current = performance.now();
    if (previewFrameRef.current !== null) return;
    previewFrameRef.current = window.requestAnimationFrame(() => {
      previewFrameRef.current = null;
      const queuedValue = queuedPreviewValueRef.current;
      const startedAt = queuedPreviewStartedAtRef.current;
      queuedPreviewValueRef.current = null;
      queuedPreviewStartedAtRef.current = null;
      if (queuedValue === null) return;
      void preview
        .apply(
          sourceBlockId,
          { domPath: selector },
          { property, value: `${queuedValue}px` },
        )
        .then(() => {
          if (startedAt === null) return;
          try {
            performance.measure("ai-tutor:controller-preview", {
              start: startedAt,
              end: performance.now(),
            });
          } catch {
            // Older performance implementations can omit measure options.
          }
        })
        .catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : "实时预览失败");
        });
    });
  };

  return (
    <div
      className="teaching-block__control"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div>
        <code>{property}</code>
        <strong>
          {typeof value === "number" ? `${value}px` : value}
        </strong>
      </div>
      {control ? (
        <input
          type="range"
          aria-label={`${property} 控制器`}
          min={control.min}
          max={control.max}
          step={control.step}
          value={Number(value)}
          onChange={(event) =>
            previewValue(Number(event.currentTarget.value))
          }
          onPointerUp={(event) =>
            void commitValue(Number(event.currentTarget.value))
          }
          onBlur={(event) => {
            void commitValue(Number(event.currentTarget.value));
          }}
          onKeyDown={(event) => event.stopPropagation()}
          onKeyUp={(event) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
              void commitValue(Number(event.currentTarget.value));
            }
          }}
        />
      ) : (
        <select
          aria-label={`${property} 控制器`}
          value={String(value)}
          onChange={(event) => {
            const nextValue = event.currentTarget.value;
            previewValue(nextValue);
            void commitValue(nextValue);
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {enumControl?.values.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      )}
      <small>{status}</small>
    </div>
  );
}
export function RunnableBlockRuntime({ blockId }: { blockId: string }) {
  const {
    projects,
    nearViewportBlockIds,
    actions,
    preview,
    inspectionBridge,
    reportInspection,
  } = useContext(RuntimeCanvasContext);
  const projectRecord = projects.get(blockId);
  const inspectedRevisionId = projectRecord?.currentRevisionId ?? "";
  const activeRevision = projectRecord ? currentRevision(projectRecord) : null;
  const project = useMemo(
    () =>
      projectRecord && activeRevision
        ? projectForRevision(projectRecord, activeRevision)
        : undefined,
    [activeRevision, projectRecord],
  );
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeHandle | null>(null);
  const renderedRevisionRef = useRef<string | null>(null);
  const experimentSaveInFlightRef = useRef(false);
  const inspectionPreviewFrameRef = useRef<number | null>(null);
  const inspectionPreviewInFlightRef = useRef<Promise<void> | null>(null);
  const queuedInspectionPreviewRef = useRef<{
    readonly change: CssExperimentChange;
    readonly requestId: number;
    readonly startedAt: number;
    readonly target: SavedElementTarget;
  } | null>(null);
  const latestInspectionPreviewRequestRef = useRef(0);
  const inspectedRevisionIdRef = useRef(inspectedRevisionId);
  const nearViewportRef = useRef(nearViewportBlockIds.has(blockId));
  const [status, setStatus] = useState<
    "empty" | "mounting" | "ready" | "paused" | "error"
  >(projectRecord ? "mounting" : "empty");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectionMode, setSelectionMode] = useState(false);
  const [inspection, setInspection] = useState<InspectionResult | null>(null);
  const [inspectionError, setInspectionError] = useState("");
  const [pendingChanges, setPendingChanges] = useState<
    Readonly<Record<string, string>>
  >({});
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [boxModelOverlay, setBoxModelOverlay] = useState(false);
  const [sourceEditorOpen, setSourceEditorOpen] = useState(false);

  useEffect(() => {
    inspectedRevisionIdRef.current = inspectedRevisionId;
  }, [inspectedRevisionId]);

  useEffect(() => {
    const nearViewport = nearViewportBlockIds.has(blockId);
    nearViewportRef.current = nearViewport;
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const runtimeStatus = runtime.getStatus();
    if (runtimeStatus !== "ready" && runtimeStatus !== "paused") return;

    void (nearViewport ? runtime.resume() : runtime.pause())
      .then(() => setStatus(nearViewport ? "ready" : "paused"))
      .catch((error: unknown) => {
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "运行时可见性切换失败",
        );
      });
  }, [blockId, nearViewportBlockIds]);

  useEffect(() => {
    const target = mountRef.current;
    if (!target || !project) {
      setStatus("empty");
      return;
    }

    let cancelled = false;
    let runtime: RuntimeHandle | null = null;
    let unregisterPreview: (() => void) | null = null;
    let unregisterInspection: (() => void) | null = null;
    const runtimeInstanceId = `runtime-${crypto.randomUUID()}`;
    setStatus("mounting");
    setErrorMessage("");
    setSelectionMode(false);
    setInspection(null);
    setInspectionError("");

    void staticHtmlCssAdapter
      .createRuntime(project, {
        runtimeInstanceId,
        onElementSelected: (result) => {
          if (cancelled) return;
          setInspection(result);
          setInspectionError("");
          setSelectionMode(false);
          reportInspection(blockId, {
            blockId,
            revisionId: inspectedRevisionIdRef.current,
            capturedAt: new Date().toISOString(),
            result,
          });
        },
        onInspectionError: (error) => {
          if (cancelled) return;
          setInspection(null);
          setSelectionMode(false);
          reportInspection(blockId, null);
          setInspectionError(
            error.message.includes("TARGET_")
              ? "原目标在重新渲染后无法定位，请重新选择元素。"
              : error.message,
          );
        },
      })
      .then(async (createdRuntime) => {
        runtime = createdRuntime;
        runtimeRef.current = createdRuntime;
        await createdRuntime.mount(target);
        unregisterPreview = preview.register(blockId, {
          async apply(savedElementTarget, change) {
            if (createdRuntime.getStatus() === "paused") {
              await createdRuntime.resume();
            }
            await createdRuntime.applyTransientStyle({
              target: {
                runtimeInstanceId,
                domPath: savedElementTarget.domPath,
                ...(savedElementTarget.fingerprint
                  ? { fingerprint: savedElementTarget.fingerprint }
                  : {}),
              },
              property: change.property,
              value: change.value,
            });
          },
          async reset() {
            if (createdRuntime.getStatus() === "disposed") return;
            await createdRuntime.resetTransientState();
          },
        });
        unregisterInspection = inspectionBridge.register(blockId, {
          async inspect(domPath) {
            const wasPaused = createdRuntime.getStatus() === "paused";
            if (wasPaused) await createdRuntime.resume();
            try {
              const result = await createdRuntime.inspect({
                runtimeInstanceId,
                domPath,
              });
              const snapshot = {
                blockId,
                revisionId: inspectedRevisionIdRef.current,
                capturedAt: new Date().toISOString(),
                result,
              };
              setInspection(result);
              setSelectionMode(false);
              setInspectionError("");
              reportInspection(blockId, snapshot);
              return snapshot;
            } finally {
              if (wasPaused && createdRuntime.getStatus() === "ready") {
                await createdRuntime.pause();
              }
            }
          },
        });
        if (!nearViewportRef.current) {
          await createdRuntime.pause();
        }
        if (cancelled) {
          await createdRuntime.dispose();
          return;
        }
        setStatus(nearViewportRef.current ? "ready" : "paused");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMessage(
          error instanceof Error ? error.message : "隔离运行时启动失败",
        );
      });

    return () => {
      cancelled = true;
      latestInspectionPreviewRequestRef.current += 1;
      queuedInspectionPreviewRef.current = null;
      if (inspectionPreviewFrameRef.current !== null) {
        window.cancelAnimationFrame(inspectionPreviewFrameRef.current);
        inspectionPreviewFrameRef.current = null;
      }
      reportInspection(blockId, null);
      unregisterPreview?.();
      unregisterInspection?.();
      runtimeRef.current = null;
      if (runtime) void runtime.dispose();
    };
  }, [blockId, inspectionBridge, preview, project, reportInspection]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (
      !runtime ||
      !activeRevision ||
      (status !== "ready" && status !== "paused") ||
      renderedRevisionRef.current === activeRevision.id
    ) {
      return;
    }
    renderedRevisionRef.current = activeRevision.id;
    void runtime.render(activeRevision).catch((error: unknown) => {
      renderedRevisionRef.current = null;
      setStatus("error");
      setErrorMessage(
        error instanceof Error ? error.message : "代码版本渲染失败",
      );
    });
  }, [activeRevision, status]);

  const toggleSelectionMode = async () => {
    const runtime = runtimeRef.current;
    if (!runtime || status !== "ready") return;
    const nextEnabled = !selectionMode;
    setInspectionError("");
    try {
      await runtime.setSelectionMode(nextEnabled);
      setSelectionMode(nextEnabled);
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : "无法切换元素选择模式",
      );
    }
  };

  const clearInspection = async () => {
    const runtime = runtimeRef.current;
    setInspection(null);
    setSelectionMode(false);
    setInspectionError("");
    setBoxModelOverlay(false);
    reportInspection(blockId, null);
    if (!runtime || runtime.getStatus() === "disposed") return;
    try {
      await runtime.setBoxModelOverlay(false);
      await runtime.clearSelection();
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : "无法清除元素选择",
      );
    }
  };

  const reselectInspection = async () => {
    const runtime = runtimeRef.current;
    setInspection(null);
    setInspectionError("");
    setBoxModelOverlay(false);
    reportInspection(blockId, null);
    if (!runtime || runtime.getStatus() !== "ready") return;
    try {
      await runtime.setBoxModelOverlay(false);
      await runtime.clearSelection();
      await runtime.setSelectionMode(true);
      setSelectionMode(true);
    } catch (error) {
      setSelectionMode(false);
      setInspectionError(
        error instanceof Error ? error.message : "无法重新选择页面内容",
      );
    }
  };

  const selectInspectionTarget = async (target: ElementTarget) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.getStatus() !== "ready") return;
    setInspectionError("");
    try {
      await preview.reset(blockId);
      setPendingChanges({});
      setLastLatencyMs(null);
      setBoxModelOverlay(false);
      await runtime.setBoxModelOverlay(false);
      const result = await runtime.inspect(target);
      setInspection(result);
      setSelectionMode(false);
      reportInspection(blockId, {
        blockId,
        revisionId: inspectedRevisionIdRef.current,
        capturedAt: new Date().toISOString(),
        result,
      });
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : "无法切换到附近内容",
      );
    }
  };

  const scheduleInspectionPreview = () => {
    if (inspectionPreviewFrameRef.current !== null) return;
    inspectionPreviewFrameRef.current = window.requestAnimationFrame(() => {
      inspectionPreviewFrameRef.current = null;
      if (inspectionPreviewInFlightRef.current) return;
      const queued = queuedInspectionPreviewRef.current;
      if (!queued) return;
      queuedInspectionPreviewRef.current = null;
      const run = preview
        .apply(blockId, queued.target, queued.change)
        .then(() => {
          const finishedAt = performance.now();
          try {
            performance.measure("ai-tutor:inspection-preview", {
              start: queued.startedAt,
              end: finishedAt,
            });
          } catch {
            // Older performance implementations can omit measure options.
          }
          if (
            queued.requestId === latestInspectionPreviewRequestRef.current
          ) {
            setLastLatencyMs(
              Math.round((finishedAt - queued.startedAt) * 10) / 10,
            );
          }
        })
        .catch((error: unknown) => {
          if (
            queued.requestId === latestInspectionPreviewRequestRef.current
          ) {
            setInspectionError(
              error instanceof Error
                ? error.message
                : "无法应用临时 CSS",
            );
          }
        })
        .finally(() => {
          if (inspectionPreviewInFlightRef.current === run) {
            inspectionPreviewInFlightRef.current = null;
          }
          if (queuedInspectionPreviewRef.current) {
            scheduleInspectionPreview();
          }
        });
      inspectionPreviewInFlightRef.current = run;
    });
  };

  const cancelQueuedInspectionPreview = () => {
    latestInspectionPreviewRequestRef.current += 1;
    queuedInspectionPreviewRef.current = null;
    if (inspectionPreviewFrameRef.current !== null) {
      window.cancelAnimationFrame(inspectionPreviewFrameRef.current);
      inspectionPreviewFrameRef.current = null;
    }
  };

  const applyControl = (change: CssExperimentChange) => {
    if (!inspection || status !== "ready") return;
    setInspectionError("");
    setPendingChanges((current) => ({
      ...current,
      [change.property]: change.value,
    }));
    const requestId = latestInspectionPreviewRequestRef.current + 1;
    latestInspectionPreviewRequestRef.current = requestId;
    queuedInspectionPreviewRef.current = {
      change,
      requestId,
      startedAt: performance.now(),
      target: savedTarget(inspection.target),
    };
    scheduleInspectionPreview();
  };

  const resetExperiment = async () => {
    try {
      cancelQueuedInspectionPreview();
      await inspectionPreviewInFlightRef.current;
      await preview.reset(blockId);
      setPendingChanges({});
      setLastLatencyMs(null);
    } catch (error) {
      setInspectionError(
        error instanceof Error ? error.message : "无法重置临时 CSS",
      );
    }
  };

  const saveExperiment = async () => {
    if (
      !inspection ||
      Object.keys(pendingChanges).length === 0 ||
      experimentSaveInFlightRef.current
    ) {
      return;
    }
    experimentSaveInFlightRef.current = true;
    try {
      cancelQueuedInspectionPreview();
      await inspectionPreviewInFlightRef.current;
      await preview.reset(blockId);
      await actions.saveExperiment(
        blockId,
        savedTarget(inspection.target),
        Object.entries(pendingChanges).map(([property, value]) => ({
          property,
          value,
        })),
        {
          beforeValues: Object.fromEntries(
            Object.keys(pendingChanges).flatMap((property) => {
              const value = computedStyleValue(
                inspection.computedStyles,
                property,
              );
              return value === undefined ? [] : [[property, value]];
            }),
          ),
        },
      );
      setPendingChanges({});
      setLastLatencyMs(null);
      setInspectionError("");
    } catch (error) {
      setInspectionError(
        error instanceof Error
          ? error.message
          : "这次变化没有保存，请再试一次",
      );
    } finally {
      experimentSaveInFlightRef.current = false;
    }
  };

  const switchRevision = async (revisionId: string) => {
    await resetExperiment();
    renderedRevisionRef.current = null;
    actions.switchRevision(blockId, revisionId);
  };

  const toggleBoxModelOverlay = async () => {
    const runtime = runtimeRef.current;
    if (!runtime) return;
    const enabled = !boxModelOverlay;
    await runtime.setBoxModelOverlay(enabled);
    setBoxModelOverlay(enabled);
  };

  if (!projectRecord) {
    return (
      <div className="teaching-block__runtime teaching-block__runtime--empty">
        <strong>还没有页面</strong>
        <small>从左侧载入 HTML 和 CSS</small>
      </div>
    );
  }

  return (
    <div
      className="teaching-block__runtime teaching-block__runtime--live"
      data-runtime-status={status}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="teaching-block__runtime-bar">
        <span>{projectRecord.snapshot.entryFile}</span>
        <div>
          <button
            type="button"
            disabled={status !== "ready"}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              void clearInspection();
              setSourceEditorOpen(true);
            }}
          >
            编辑 HTML/CSS
          </button>
          <button
            type="button"
            disabled={status !== "ready"}
            aria-pressed={selectionMode}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => void toggleSelectionMode()}
          >
            {selectionMode ? "取消选择" : inspection ? "换一个" : "选择页面内容"}
          </button>
          <b>{status === "ready" ? "可互动" : "准备中"}</b>
        </div>
      </div>
      <div className="teaching-block__runtime-workspace">
        <div className="teaching-block__runtime-preview">
          <div ref={mountRef} className="teaching-block__runtime-mount" />
          {selectionMode ? (
            <div className="teaching-block__selection-hint">
              把鼠标移到页面上，再点一下想调整的地方
            </div>
          ) : null}
        </div>
      </div>
      {(inspection || inspectionError) && typeof document !== "undefined"
        ? createPortal(
            <div
              className="style-workbench-layer"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <InspectionPanel
                key={projectRecord.currentRevisionId}
                result={inspection}
                errorMessage={inspectionError}
                onClose={() => void clearInspection()}
                onReselect={() => void reselectInspection()}
                onSelectTarget={(target) => void selectInspectionTarget(target)}
                revisions={projectRecord.revisions}
                currentRevisionId={projectRecord.currentRevisionId}
                pendingChanges={pendingChanges}
                lastLatencyMs={lastLatencyMs}
                boxModelOverlay={boxModelOverlay}
                onApplyChange={(change) => void applyControl(change)}
                onReset={() => void resetExperiment()}
                onSave={() => void saveExperiment()}
                onSwitchRevision={(revisionId) => void switchRevision(revisionId)}
                onFork={() => void actions.forkProject(blockId)}
                onCreateComparison={(beforeRevisionId, afterRevisionId) =>
                  actions.createComparison(
                    blockId,
                    beforeRevisionId,
                    afterRevisionId,
                    inspection ? savedTarget(inspection.target) : undefined,
                  )
                }
                onToggleBoxModel={() => void toggleBoxModelOverlay()}
              />
            </div>,
            document.body,
          )
        : null}
      {sourceEditorOpen && projectRecord && typeof document !== "undefined"
        ? createPortal(
            <SourceEditorPanel
              key={blockId}
              record={projectRecord}
              onClose={() => setSourceEditorOpen(false)}
              onSave={(prepared, summary) =>
                actions.saveSourceRevision(blockId, prepared, summary)
              }
            />,
            document.body,
          )
        : null}
      {status === "error" ? (
        <div className="teaching-block__runtime-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
    </div>
  );
}

type ComparisonViewMode = "focus" | "page";

async function syncComparisonPaneViewport(
  runtime: RuntimeHandle,
  runtimeInstanceId: string,
  mode: ComparisonViewMode,
  target: SavedElementTarget | undefined,
  scrollRatio: number,
): Promise<{
  readonly viewport: RuntimeComparisonViewportState;
  readonly measurement: { readonly width: number; readonly height: number } | null;
}> {
  if (mode === "focus" && target) {
    const runtimeTarget = {
      runtimeInstanceId,
      domPath: target.domPath,
      ...(target.fingerprint ? { fingerprint: target.fingerprint } : {}),
    };
    const viewport = await runtime.setComparisonViewport({
      mode: "focus",
      target: runtimeTarget,
    });
    const inspected = await runtime.inspect(runtimeTarget);
    return {
      viewport,
      measurement: {
        width: inspected.boundingRect.width,
        height: inspected.boundingRect.height,
      },
    };
  }
  return {
    viewport: await runtime.setComparisonViewport({ mode: "page", scrollRatio }),
    measurement: null,
  };
}

function ComparisonPane({
  projectRecord,
  revision,
  target,
  label,
  previewStore,
  previewSourceBlockId,
  previewCurrentRevisionId,
  viewMode,
  scrollRatio,
  onViewportState,
}: {
  projectRecord: RuntimeProjectRecord;
  revision: CodeRevision;
  target: SavedElementTarget | undefined;
  label: string;
  previewStore?: RuntimePreviewStore | undefined;
  previewSourceBlockId?: string | undefined;
  previewCurrentRevisionId?: string | undefined;
  viewMode: ComparisonViewMode;
  scrollRatio: number;
  onViewportState: (state: RuntimeComparisonViewportState) => void;
}) {
  const mountRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<RuntimeHandle | null>(null);
  const runtimeInstanceIdRef = useRef<string | null>(null);
  const transientPreviewRef = useRef<
    TransientExperimentPreview | undefined
  >(undefined);
  const transientRequestVersionRef = useRef(0);
  const transientAppliedKeyRef = useRef<string | null>(null);
  const transientFrameRef = useRef<number | null>(null);
  const transientInFlightRef = useRef<Promise<void> | null>(null);
  const [status, setStatus] = useState<"mounting" | "ready" | "error">("mounting");
  const [previewActive, setPreviewActive] = useState(false);
  const [measurement, setMeasurement] = useState<{
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let cancelled = false;
    let runtime: RuntimeHandle | null = null;
    setStatus("mounting");
    setMeasurement(null);
    const runtimeInstanceId = `comparison-runtime-${crypto.randomUUID()}`;
    runtimeInstanceIdRef.current = runtimeInstanceId;
    void staticHtmlCssAdapter
        .createRuntime(projectForRevision(projectRecord, revision), {
        runtimeInstanceId,
      })
      .then(async (created) => {
        runtime = created;
        runtimeRef.current = created;
        await created.mount(mount);
        await created.render(revision);
        if (!cancelled) {
          const frame = mount.querySelector("iframe");
          if (frame) frame.tabIndex = -1;
        }
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      runtimeRef.current = null;
      runtimeInstanceIdRef.current = null;
      if (runtime) void runtime.dispose();
    };
  }, [projectRecord, revision, target, onViewportState]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    const runtimeInstanceId = runtimeInstanceIdRef.current;
    if (!runtime || !runtimeInstanceId || status !== "ready") return;
    let cancelled = false;
    void syncComparisonPaneViewport(
      runtime,
      runtimeInstanceId,
      viewMode,
      target,
      scrollRatio,
    )
      .then((synced) => {
        if (cancelled) return;
        setMeasurement(synced.measurement);
        onViewportState(synced.viewport);
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [status, target, viewMode, scrollRatio, onViewportState]);

  const scheduleTransientPreview = useCallback(
    function schedule() {
      if (
        status !== "ready" ||
        transientFrameRef.current !== null ||
        transientInFlightRef.current
      ) {
        return;
      }
      transientFrameRef.current = window.requestAnimationFrame(() => {
        transientFrameRef.current = null;
        const runtime = runtimeRef.current;
        const runtimeInstanceId = runtimeInstanceIdRef.current;
        if (!runtime || !runtimeInstanceId || status !== "ready") return;
        const requestVersion = transientRequestVersionRef.current;
        const preview = transientPreviewRef.current;
        const run = (async () => {
          const nextKey = preview
            ? [
                preview.baseRevisionId,
                preview.target.domPath,
                preview.target.fingerprint ?? "",
              ].join(":")
            : null;
          if (nextKey !== transientAppliedKeyRef.current) {
            await runtime.resetTransientState();
            transientAppliedKeyRef.current = nextKey;
          }
          if (preview) {
            for (const [property, value] of Object.entries(preview.changes)) {
              await runtime.applyTransientStyle({
                target: {
                  runtimeInstanceId,
                  domPath: preview.target.domPath,
                  ...(preview.target.fingerprint
                    ? { fingerprint: preview.target.fingerprint }
                    : {}),
                },
                property,
                value,
              });
            }
          }
        })();
        transientInFlightRef.current = run;
        void run
          .catch(() => {
            if (
              requestVersion === transientRequestVersionRef.current &&
              runtimeRef.current
            ) {
              setStatus("error");
            }
          })
          .finally(() => {
            if (transientInFlightRef.current === run) {
              transientInFlightRef.current = null;
            }
            if (requestVersion !== transientRequestVersionRef.current) {
              window.queueMicrotask(schedule);
            }
          });
      });
    },
    [status],
  );

  useEffect(() => {
    if (
      !previewStore ||
      !previewSourceBlockId ||
      !previewCurrentRevisionId
    ) {
      transientPreviewRef.current = undefined;
      transientRequestVersionRef.current += 1;
      const timer = window.setTimeout(() => {
        setPreviewActive(false);
        scheduleTransientPreview();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    const update = () => {
      const candidate = previewStore.get(previewSourceBlockId);
      const targetMatches = Boolean(
        target &&
          candidate &&
          target.domPath === candidate.target.domPath &&
          (!target.fingerprint ||
            !candidate.target.fingerprint ||
            target.fingerprint === candidate.target.fingerprint),
      );
      const applicable =
        candidate &&
        previewCurrentRevisionId === revision.id &&
        candidate.baseRevisionId === revision.id &&
        targetMatches
          ? candidate
          : undefined;
      transientPreviewRef.current = applicable;
      transientRequestVersionRef.current += 1;
      setPreviewActive((current) =>
        current === Boolean(applicable) ? current : Boolean(applicable),
      );
      scheduleTransientPreview();
    };
    const timer = window.setTimeout(update, 0);
    const unsubscribe = previewStore.subscribe(previewSourceBlockId, update);
    return () => {
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [
    previewCurrentRevisionId,
    previewSourceBlockId,
    previewStore,
    revision.id,
    scheduleTransientPreview,
    target,
  ]);

  useEffect(
    () => () => {
      if (transientFrameRef.current !== null) {
        window.cancelAnimationFrame(transientFrameRef.current);
      }
      transientFrameRef.current = null;
      transientPreviewRef.current = undefined;
      transientRequestVersionRef.current += 1;
    },
    [],
  );

  return (
    <div className="comparison-runtime__pane" data-runtime-status={status}>
      <span className="comparison-runtime__pane-label">
        {previewActive ? `${label} · 未保存预览` : label}
      </span>
      <div ref={mountRef} className="comparison-runtime__frame" />
      {measurement ? (
        <output
          className="comparison-runtime__measurement"
          aria-label={`${label}目标尺寸`}
        >
          {Math.round(measurement.width)} × {Math.round(measurement.height)} px
        </output>
      ) : null}
      {status === "error" ? <small>目标无法在此版本中同步</small> : null}
    </div>
  );
}

const COMPARISON_MODES: readonly {
  value: ComparisonMode;
  label: string;
}[] = [
  { value: "side-by-side", label: "并排" },
  { value: "wipe", label: "揭示" },
  { value: "source-diff", label: "完整源码" },
  { value: "experiment-diff", label: "实验改动" },
];

export function ComparisonBlockRuntime({ blockId }: { blockId: string }) {
  const { projects, comparisons, actions, previewStore } =
    useContext(RuntimeCanvasContext);
  const comparison = comparisons.get(blockId);
  const [wipeDraft, setWipeDraft] = useState<number | null>(null);
  const [contextMode, setContextMode] = useState<ComparisonViewMode>("focus");
  const [pageScrollRatio, setPageScrollRatio] = useState(0);
  const [beforeViewport, setBeforeViewport] =
    useState<RuntimeComparisonViewportState | null>(null);
  const [afterViewport, setAfterViewport] =
    useState<RuntimeComparisonViewportState | null>(null);
  const reportBeforeViewport = useCallback(
    (state: RuntimeComparisonViewportState) => setBeforeViewport(state),
    [],
  );
  const reportAfterViewport = useCallback(
    (state: RuntimeComparisonViewportState) => setAfterViewport(state),
    [],
  );
  const wipeDirtyRef = useRef(false);
  const commitWipePosition = (value: number) => {
    if (!comparison || !wipeDirtyRef.current) return;
    wipeDirtyRef.current = false;
    setWipeDraft(null);
    if (value !== comparison.wipePosition) {
      actions.updateComparison(blockId, { wipePosition: value });
    }
  };
  const projectRecord = comparison
    ? projects.get(comparison.sourceBlockId)
    : undefined;
  if (!comparison || !projectRecord) {
    return (
      <div className="teaching-block__comparison teaching-block__comparison--empty">
        <span>保存两次变化后，就可以在这里一起看。</span>
      </div>
    );
  }
  const before = revisionById(projectRecord, comparison.beforeRevisionId);
  const after = revisionById(projectRecord, comparison.afterRevisionId);
  if (!before || !after) {
    return (
      <div className="teaching-block__comparison teaching-block__comparison--empty">
        <span>这组修改记录已经找不到了。</span>
      </div>
    );
  }
  const showingSourceDiff = comparison.mode === "source-diff";
  const showingExperimentDiff = comparison.mode === "experiment-diff";
  const effectiveContextMode: ComparisonViewMode =
    comparison.focusTarget && contextMode === "focus" ? "focus" : "page";
  const pageHeightsDiffer = Boolean(
    effectiveContextMode === "page" &&
      beforeViewport &&
      afterViewport &&
      Math.abs(beforeViewport.documentHeight - afterViewport.documentHeight) > 1,
  );
  const diff = buildLineDiff(
    showingSourceDiff
      ? comparisonSourceCode(projectRecord, before.id)
      : comparisonExperimentCode(projectRecord, before.id),
    showingSourceDiff
      ? comparisonSourceCode(projectRecord, after.id)
      : comparisonExperimentCode(projectRecord, after.id),
  );
  return (
    <div className="comparison-runtime" onPointerDown={(event) => event.stopPropagation()}>
      <nav>
        {COMPARISON_MODES.map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={comparison.mode === mode.value}
            onClick={() => {
              wipeDirtyRef.current = false;
              setWipeDraft(null);
              actions.updateComparison(blockId, { mode: mode.value });
            }}
          >
            {mode.label}
          </button>
        ))}
      </nav>
      {showingSourceDiff || showingExperimentDiff ? (
        <div className="comparison-runtime__diff-view">
          <p>
            {showingSourceDiff
              ? "这里按文件比较完整 HTML/CSS 源码。"
              : "这里只比较这次实验追加的样式，不是完整源码。"}
          </p>
          <pre
            className="comparison-runtime__diff"
            aria-label={
              showingSourceDiff
                ? "完整 HTML 和 CSS 源码差异"
                : "实验样式差异（不是完整源码）"
            }
          >
            {diff.map((line, index) => (
              <code key={`${line.kind}-${index}`} data-diff-kind={line.kind}>
                {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}
                {line.text || " "}
              </code>
            ))}
          </pre>
        </div>
      ) : (
        <div className="comparison-runtime__visual-shell">
          <div className="comparison-runtime__context-controls">
            {comparison.focusTarget ? (
              <>
                <button
                  type="button"
                  aria-pressed={effectiveContextMode === "focus"}
                  onClick={() => setContextMode("focus")}
                >
                  看变化位置
                </button>
                <button
                  type="button"
                  aria-pressed={effectiveContextMode === "page"}
                  onClick={() => setContextMode("page")}
                >
                  看整页
                </button>
              </>
            ) : (
              <span>这次没有可靠的变化位置，正在展示整页。</span>
            )}
            {effectiveContextMode === "page" ? (
              <label>
                整页同步位置
                <input
                  aria-label="整页同步位置"
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(pageScrollRatio * 100)}
                  onChange={(event) =>
                    setPageScrollRatio(Number(event.currentTarget.value) / 100)
                  }
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </label>
            ) : null}
            {pageHeightsDiffer ? (
              <small role="status">前后页面高度不同，底部位置会各自到达边界。</small>
            ) : null}
          </div>
          <div
            className={`comparison-runtime__visual comparison-runtime__visual--${comparison.mode}`}
            data-context-mode={effectiveContextMode}
            data-before-scroll={beforeViewport?.scrollTop ?? undefined}
            data-after-scroll={afterViewport?.scrollTop ?? undefined}
          >
          <ComparisonPane
            projectRecord={projectRecord}
            revision={before}
            target={effectiveContextMode === "focus" ? comparison.focusTarget : undefined}
            label="修改前"
            viewMode={effectiveContextMode}
            scrollRatio={pageScrollRatio}
            onViewportState={reportBeforeViewport}
          />
          <div
            className="comparison-runtime__after"
            style={
              comparison.mode === "wipe"
                ? {
                    clipPath:
                      "inset(0 " +
                      (100 - (wipeDraft ?? comparison.wipePosition)) +
                      "% 0 0)",
                  }
                : undefined
            }
          >
            <ComparisonPane
              previewStore={previewStore}
              previewSourceBlockId={comparison.sourceBlockId}
              previewCurrentRevisionId={projectRecord.currentRevisionId}
              projectRecord={projectRecord}
              revision={after}
              target={effectiveContextMode === "focus" ? comparison.focusTarget : undefined}
              label="修改后"
              viewMode={effectiveContextMode}
              scrollRatio={pageScrollRatio}
              onViewportState={reportAfterViewport}
            />
          </div>
          {comparison.mode === "wipe" ? (
            <input
              aria-label="前后查看比例"
              type="range"
              min="0"
              max="100"
              value={wipeDraft ?? comparison.wipePosition}
              onChange={(event) => {
                wipeDirtyRef.current = true;
                setWipeDraft(Number(event.currentTarget.value));
              }}
              onPointerUp={(event) =>
                commitWipePosition(Number(event.currentTarget.value))
              }
              onBlur={(event) =>
                commitWipePosition(Number(event.currentTarget.value))
              }
              onKeyDown={(event) => event.stopPropagation()}
              onKeyUp={(event) => {
                if (
                  ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                ) {
                  commitWipePosition(Number(event.currentTarget.value));
                }
              }}
            />
          ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
