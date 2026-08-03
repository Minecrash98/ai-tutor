"use client";

import type {
  LearningAuditEventInput,
  LearningSupportAction,
  PersonalizedLessonOrigin,
  TutorCssProperty,
  TutorTopic,
} from "@ai-tutor/contracts";
import {
  BOX_MODEL_COURSE,
  diagnoseMisconception,
} from "@ai-tutor/curriculum";
import type { ImportedFile, NormalizedProject } from "@ai-tutor/runtime-core";
import {
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_COUNT,
  MAX_IMPORT_TOTAL_BYTES,
  StaticHtmlImportError,
  staticHtmlCssAdapter,
} from "@ai-tutor/runtime-static-html";
import type {
  CodeRevision,
  ImportSnapshot,
  TeachingBlockType,
} from "@ai-tutor/teaching-model";
import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  type Editor,
  type TLEditorSnapshot,
} from "tldraw";

import type { RealtimeTutorAdaptiveCue } from "../tutor/RealtimeTutorPanel";
import {
  BoxModelLessonPanel,
  BoxModelWidthFormula,
} from "../lesson/BoxModelLessonPanel";
import { ScenarioLessonPanel } from "../lesson/ScenarioLessonPanel";
import { PersonalizedCoursePanel } from "../lesson/PersonalizedCoursePanel";
import {
  boxModelWidthBreakdown,
  evaluateTransferDeclaration,
  type BoxModelExplanation,
  type BoxModelPrediction,
} from "../lesson/box-model-lesson";
import {
  scenarioObservationProgress,
  scenarioTransferChanges,
  type ScenarioExplanation,
  type ScenarioLessonKind,
  type ScenarioPrediction,
} from "../lesson/scenario-lesson";
import {
  attachPersonalizedCourseVerification,
  buildPersonalizedCoursePlan,
  extractPersonalizedCourseCandidates,
  personalizedCourseSourceUnchanged,
  recordPersonalizedCourseAnswer,
  revisionDescendsFrom,
  verifyPersonalizedCourseExperiment,
  type PersonalizedCoursePlan,
} from "../lesson/personalized-course";
import { useLearningProof } from "../learning/use-learning-proof";
import { LearningProofHistory } from "../learning/LearningProofHistory";
import { LearningEvidencePanel } from "../learning/LearningEvidencePanel";
import { TransferAssessmentPanel } from "../assessment/TransferAssessmentPanel";
import {
  createSourceRevision,
  type PreparedSourceRun,
} from "../editor/source-editor-model";
import {
  createTutorToolExecutor,
  type TutorCanvasOperations,
  type TutorToolExecutor,
} from "../tutor/tutor-tool-executor";
import {
  newestStudentAction,
  relevantSourceFact,
  selectedElementFact,
  studentActionFromLearningEvent,
  studentActionFromRevision,
  teachingAssertionEvidence,
  type RuntimeInspectionSnapshot,
  type StudentActionFact,
} from "../tutor/teaching-facts";
import {
  type TeachingBlockShape,
} from "./TeachingBlockShape";
import { makeTeachingBlockShape } from "./teaching-block-shape-factory";
import {
  reconcileComparisonsWithTombstones,
  reconcileMapKeysWithTombstones,
  retainMapKeys,
} from "./canvas-state-reconciliation";
import {
  clearWorkspaceState,
  loadWorkspaceState,
  saveWorkspaceState,
} from "./canvas-workspace-persistence";
import {
  inferDefaultSelector,
  requireVerifiedProjectSelector,
} from "./verified-selector";
import {
  TEACHING_BLOCK_DEFINITIONS,
  TEACHING_BLOCK_SHAPE_TYPE,
  TEACHING_BLOCK_TYPES,
} from "./teaching-block-model";
import {
  createRuntimePreviewStore,
  RuntimeCanvasProvider,
  type RuntimeInspectionBridge,
  type RuntimePreviewStore,
} from "./runtime-project-context";
import {
  appendRevision,
  createExperimentRevision,
  currentRevision,
  parseP5State,
  serializeP5State,
  type ComparisonRecord,
  type CssExperimentChange,
  type RuntimeProjectRecord,
  type SavedElementTarget,
} from "./p5-model";
import { isRectNearViewport } from "./visibility";
import { EnglishDemoPresentation } from "./EnglishDemoPresentation";

const RealtimeTutorPanel = dynamic(
  () =>
    import("../tutor/RealtimeTutorPanel").then(
      (module) => module.RealtimeTutorPanel,
    ),
  {
    ssr: false,
    loading: () => (
      <section
        className="realtime-tutor"
        role="region"
        aria-label="AI 学习搭档"
        aria-busy="true"
      >
        <p>正在准备学习搭档…</p>
      </section>
    ),
  },
);

const TldrawCanvasSurface = dynamic(
  () =>
    import("./TldrawCanvasSurface").then(
      (module) => module.TldrawCanvasSurface,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="canvas-loading" aria-busy="true" aria-live="polite">
        正在准备可拖动的学习画布…
      </div>
    ),
  },
);

type LiveBoxModelLessonPanelProps = Omit<
  ComponentProps<typeof BoxModelLessonPanel>,
  "widthFormula"
> & {
  readonly previewStore: RuntimePreviewStore;
};

function LiveBoxModelWidthFormula({
  previewStore,
  lessonBlockId,
  observedPaddingPx,
  idle,
}: {
  readonly previewStore: RuntimePreviewStore;
  readonly lessonBlockId: string | null;
  readonly observedPaddingPx: number | null;
  readonly idle: boolean;
}) {
  const outputRef = useRef<HTMLOutputElement>(null);
  const basePaddingPx = observedPaddingPx ?? (idle ? null : 16);
  useEffect(() => {
    const update = () => {
      const transientPadding = previewStore.get(lessonBlockId)?.changes.padding;
      const parsedTransientPadding = transientPadding?.match(
        /^(-?[0-9]+(?:[.][0-9]+)?)px$/i,
      )?.[1];
      const paddingPx =
        parsedTransientPadding === undefined
          ? basePaddingPx
          : Number(parsedTransientPadding);
      const output = outputRef.current;
      if (!output || paddingPx === null) return;
      const width = boxModelWidthBreakdown(paddingPx);
      output.dataset.paddingPx = String(paddingPx);
      output.dataset.totalWidthPx = String(width.totalPx);
      const total = output.querySelector("strong");
      const parts = output.querySelector("span");
      if (total) total.textContent = `总宽 ${width.totalPx}px`;
      if (parts) {
        parts.textContent =
          `内容 ${width.contentPx}px + 左右留白 ${width.horizontalPaddingPx}px + 边框 ${width.borderPx}px`;
      }
    };
    update();
    return previewStore.subscribe(lessonBlockId, update);
  }, [basePaddingPx, lessonBlockId, previewStore]);
  return (
    <BoxModelWidthFormula
      paddingPx={basePaddingPx}
      outputRef={outputRef}
    />
  );
}

function LiveBoxModelLessonPanel({
  previewStore,
  ...props
}: LiveBoxModelLessonPanelProps) {
  return (
    <BoxModelLessonPanel
      {...props}
      widthFormula={
        <LiveBoxModelWidthFormula
          previewStore={previewStore}
          lessonBlockId={props.state.lessonBlockId}
          observedPaddingPx={props.state.observedPaddingPx}
          idle={props.state.phase === "idle"}
        />
      }
    />
  );
}

const CANVAS_PERSISTENCE_KEY = "ai-tutor-p6-teaching-canvas-v1";
const DURABLE_CANVAS_SNAPSHOT_KEY = "ai-tutor-p8-canvas-snapshot-v1";
const SEMANTIC_PERSISTENCE_KEY = "ai-tutor-p6-semantic-state-v1";
const WORKSPACE_UPDATE_SIGNAL_KEY = "ai-tutor-p8-workspace-update-v2";
const LEGACY_MIRROR_MAX_CHARACTERS = 256 * 1_024;

interface CanvasMetrics {
  readonly blockCount: number;
  readonly nearViewportCount: number;
  readonly nearViewportBlockIds: ReadonlySet<string>;
}

const EMPTY_METRICS: CanvasMetrics = {
  blockCount: 0,
  nearViewportCount: 0,
  nearViewportBlockIds: new Set(),
};

interface LessonDemo {
  readonly title: string;
  readonly html: string;
  readonly css: string;
}

const LESSON_DEMOS: Readonly<Record<TutorTopic, LessonDemo>> = {
  "box-model": {
    title: "卡片里的空间",
    html: `<!doctype html><html><body>
      <main id="demo" class="demo-card">
        <span>里面的空隙</span>
        <h1>拖一拖，让卡片更宽松</h1>
        <p>文字和边框之间的距离，就是卡片里面留出的空间。</p>
      </main>
    </body></html>`,
    css: `body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f0e7;font-family:Arial,sans-serif}
      #demo{box-sizing:content-box;width:280px;padding:16px;border:4px solid #162219;margin:16px;background:#d7ff43;border-radius:22px;box-shadow:12px 12px 0 #162219}
      #demo span{font-size:11px;font-weight:800;letter-spacing:.16em}#demo h1{font-size:24px;margin:18px 0 8px}#demo p{margin:0;line-height:1.55}`,
  },
  flex: {
    title: "三个方块怎么排",
    html: `<!doctype html><html><body>
      <main id="demo" class="demo-row">
        <article>A</article><article>B</article><article>C</article>
      </main>
    </body></html>`,
    css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2ff;font-family:Arial,sans-serif}
      #demo{display:flex;align-items:center;justify-content:flex-start;gap:14px;width:420px;padding:24px;border:3px solid #162219;background:white;border-radius:20px}
      #demo article{display:grid;place-items:center;width:82px;height:82px;border:2px solid #162219;background:#d7ff43;border-radius:14px;font-size:24px;font-weight:800}`,
  },
  positioning: {
    title: "标签放在哪里",
    html: `<!doctype html><html><body>
      <main id="demo" class="position-stage">
        <p>这块区域是标签的活动范围</p>
        <span class="position-badge">移动我</span>
      </main>
    </body></html>`,
    css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3e8;font-family:Arial,sans-serif}
      #demo{position:relative;width:420px;height:220px;padding:24px;border:3px dashed #87939d;background:#eaf1ff;border-radius:20px;color:#31517a}
      #demo p{margin:0}.position-badge{position:absolute;top:24px;right:24px;padding:10px 14px;background:#c9d6ff;border-radius:12px;color:#162219;font-weight:800}`,
  },
};

const STUDENT_TASK_STAGES = [
  { id: "learn", label: "学一个概念", detail: "先判断，再看变化" },
  { id: "fix", label: "修一个页面", detail: "亲手调整并保存" },
  { id: "continue", label: "继续上次学习", detail: "换个页面自己完成" },
] as const;
type StudentTaskStage = (typeof STUDENT_TASK_STAGES)[number]["id"];

const DEMO_MODE_STEPS: Readonly<
  Record<
    TutorTopic,
    {
      readonly property: TutorCssProperty;
      readonly value: string;
      readonly explanationTitle: string;
      readonly explanation: string;
    }
  >
> = {
  "box-model": {
    property: "padding",
    value: "36px",
    explanationTitle: "里面留白会加到总尺寸",
    explanation:
      "这个例子使用 content-box。内容宽度不变时，左右 padding 会继续加到卡片总宽上。",
  },
  flex: {
    property: "gap",
    value: "32px",
    explanationTitle: "gap 只改变项目之间的距离",
    explanation:
      "三个方块仍在同一条主轴上；gap 从 14px 变为 32px，只拉开相邻项目。",
  },
  positioning: {
    property: "top",
    value: "56px",
    explanationTitle: "相对定位保留原来的位置",
    explanation:
      "舞台仍占据原来的文档流位置，top 只让它从自己的原位置向下偏移。",
  },
};

const TUTOR_FACT_JSON_CHARACTER_LIMIT = 15_500;

function serializeTutorFact(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized.length > TUTOR_FACT_JSON_CHARACTER_LIMIT) {
    throw new Error(
      "当前事实包超过安全大小上限；请缩小到一个目标元素后重新读取。",
    );
  }
  return serialized;
}

function inspectionStyleValue(
  snapshot: RuntimeInspectionSnapshot | undefined,
  property: string,
): string | null {
  if (!snapshot) return null;
  const expandedProperty = {
    padding: "padding-top",
    margin: "margin-top",
    "border-width": "border-top-width",
  }[property];
  return (
    snapshot.result.computedStyles[expandedProperty ?? property] ??
    snapshot.result.computedStyles[property] ??
    null
  );
}

function waitForCanvasCommit(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

async function waitForCanvasMotion(): Promise<void> {
  await new Promise<void>((resolve) => {
    window.setTimeout(resolve, 240);
  });
  await waitForCanvasCommit();
}

interface LegacyDurableCanvasEnvelope {
  readonly version: 1;
  readonly savedAt: string;
  readonly writerId?: string;
  readonly snapshot: TLEditorSnapshot;
}

interface DocumentHistoryEpochs {
  readonly asset: number;
  readonly binding: number;
  readonly document: number;
  readonly page: number;
  readonly shape: number;
}

function readDocumentHistoryEpochs(editor: Editor): DocumentHistoryEpochs {
  return {
    asset: editor.store.query.filterHistory("asset").get(),
    binding: editor.store.query.filterHistory("binding").get(),
    document: editor.store.query.filterHistory("document").get(),
    page: editor.store.query.filterHistory("page").get(),
    shape: editor.store.query.filterHistory("shape").get(),
  };
}

function documentHistoryMatches(
  left: DocumentHistoryEpochs,
  right: DocumentHistoryEpochs,
): boolean {
  return (
    left.asset === right.asset &&
    left.binding === right.binding &&
    left.document === right.document &&
    left.page === right.page &&
    left.shape === right.shape
  );
}

function writeLegacyWorkspaceMirrors(
  canvasSnapshot: TLEditorSnapshot,
  semanticState: string,
  writerId: string,
) {
  const savedAt = new Date().toISOString();
  if (semanticState.length <= LEGACY_MIRROR_MAX_CHARACTERS) {
    const envelope: LegacyDurableCanvasEnvelope = {
      version: 1,
      savedAt,
      writerId,
      snapshot: canvasSnapshot,
    };
    try {
      window.localStorage.setItem(
        DURABLE_CANVAS_SNAPSHOT_KEY,
        JSON.stringify(envelope),
      );
    } catch {
      // IndexedDB is authoritative; this mirror is only for legacy migration.
    }
    try {
      window.localStorage.setItem(SEMANTIC_PERSISTENCE_KEY, semanticState);
    } catch {
      // IndexedDB remains authoritative when the compatibility mirror is full.
    }
  } else {
    try {
      window.localStorage.removeItem(DURABLE_CANVAS_SNAPSHOT_KEY);
      window.localStorage.removeItem(SEMANTIC_PERSISTENCE_KEY);
    } catch {
      // Removing a stale compatibility mirror is best-effort.
    }
  }
  try {
    window.localStorage.setItem(
      WORKSPACE_UPDATE_SIGNAL_KEY,
      JSON.stringify({
        writerId,
        savedAt,
      }),
    );
  } catch {
    // Cross-tab notification is best-effort and never replaces durable state.
  }
}

function restoreLegacyCanvasState(editor: Editor): boolean {
  const raw = window.localStorage.getItem(DURABLE_CANVAS_SNAPSHOT_KEY);
  if (!raw) return false;
  let parsed: Partial<LegacyDurableCanvasEnvelope>;
  try {
    parsed = JSON.parse(raw) as Partial<LegacyDurableCanvasEnvelope>;
  } catch {
    throw new Error("设备上的画布救援记录已损坏；已打开空白画布。");
  }
  if (parsed.version !== 1 || !parsed.snapshot) {
    throw new Error("设备上的画布救援记录版本无法识别；已打开空白画布。");
  }
  editor.loadSnapshot(parsed.snapshot);
  return true;
}

const BOX_MODEL_TRANSFER_DEMO: LessonDemo = {
  title: "新页面 · 活动提示",
  html: `<!doctype html><html><body>
    <section class="event-card">
      <header><span>周末活动</span><time>10:30</time></header>
      <div class="notice">
        <strong>带上你的作品</strong>
        <p>这次结构不同，但里面留白仍由同一条 CSS 规则控制。</p>
      </div>
    </section>
  </body></html>`,
  css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eaf1ff;font-family:Arial,sans-serif;color:#162219}
    .event-card{width:340px;border:3px solid #162219;border-radius:22px;background:#fff;overflow:hidden;box-shadow:10px 10px 0 #9fb4ff}
    .event-card header{display:flex;justify-content:space-between;padding:14px 18px;background:#cdd9ff;font-weight:800}
    .notice{padding:8px;border-top:2px solid #162219;background:#fff7cf}.notice strong{font-size:21px}.notice p{margin:8px 0 0;line-height:1.5}`,
};

const FLEX_NORMAL_FLOW_DEMO: LessonDemo = {
  title: "普通文档流 · 原页面",
  html: `<!doctype html><html><body>
    <main id="demo" class="toolbar">
      <article>A</article><article>B</article><article>C</article>
    </main>
  </body></html>`,
  css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2ff;font-family:Arial,sans-serif}
    #demo{display:block;width:420px;min-height:260px;padding:24px;border:3px solid #162219;background:white;border-radius:20px}
    #demo article{display:grid;place-items:center;width:82px;height:64px;margin:0 0 12px;border:2px solid #162219;background:#d7ff43;border-radius:14px;font-size:24px;font-weight:800}
    #demo article:nth-child(2){height:92px}`,
};

const FLEX_TRANSFER_DEMO: LessonDemo = {
  title: "新页面 · 工具栏",
  html: `<!doctype html><html><body>
    <nav class="toolbar">
      <button>返回</button><strong>我的作品</strong><button>发布</button>
    </nav>
  </body></html>`,
  css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3e8;font-family:Arial,sans-serif;color:#162219}
    .toolbar{width:430px;padding:18px;border:3px solid #162219;border-radius:20px;background:#fff}
    .toolbar button{padding:10px 14px;border:2px solid #162219;border-radius:12px;background:#d7ff43;font-weight:800}.toolbar strong{font-size:20px}`,
};

function positioningDemo(
  mode: "static" | "relative" | "absolute",
): LessonDemo {
  const label =
    mode === "static" ? "static · 跟着队伍" : mode === "relative" ? "relative · 留着原位" : "absolute · 离开队伍";
  return {
    title: label,
    html: `<!doctype html><html><body>
      <section class="stage">
        <span class="before">前一个</span>
        <strong id="demo">${label}</strong>
        <span class="after">后一个</span>
      </section>
    </body></html>`,
    css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f3e8;font-family:Arial,sans-serif;color:#162219}
      .stage{position:relative;width:430px;min-height:210px;padding:28px;border:3px dashed #87939d;border-radius:20px;background:#eaf1ff}
      .stage::before{content:"包含块";position:absolute;right:12px;bottom:10px;font-size:12px;color:#526982}
      .stage span,#demo{display:block;width:max-content;margin:8px 0;padding:10px 14px;border:2px solid #162219;border-radius:12px;background:#fff}
      #demo{position:${mode};top:0;background:#c9d6ff}`,
  };
}

const POSITION_TRANSFER_DEMO: LessonDemo = {
  title: "新页面 · 海报角标",
  html: `<!doctype html><html><body>
    <article class="poster">
      <h1>CSS 作品展</h1>
      <p>把角标放到海报右上角。</p>
      <span class="badge">新活动</span>
    </article>
  </body></html>`,
  css: `*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eef2ff;font-family:Arial,sans-serif;color:#162219}
    .poster{position:relative;width:380px;min-height:230px;padding:36px;border:3px solid #162219;border-radius:24px;background:#fff;box-shadow:10px 10px 0 #9fb4ff}
    .poster h1{margin:0 0 12px}.badge{display:inline-block;padding:8px 12px;border:2px solid #162219;border-radius:999px;background:#d7ff43;font-weight:800}`,
};

async function createDemoProject(demo: LessonDemo): Promise<NormalizedProject> {
  const encoder = new TextEncoder();
  return staticHtmlCssAdapter.normalize([
    {
      path: "index.html",
      mimeType: "text/html",
      bytes: encoder.encode(demo.html),
    },
    {
      path: "styles.css",
      mimeType: "text/css",
      bytes: encoder.encode(demo.css),
    },
  ]);
}

function getTeachingShapes(editor: Editor): TeachingBlockShape[] {
  return editor
    .getCurrentPageShapes()
    .filter(
      (shape): shape is TeachingBlockShape =>
        shape.type === TEACHING_BLOCK_SHAPE_TYPE,
    );
}

function readCanvasMetrics(editor: Editor): CanvasMetrics {
  const viewport = editor.getViewportPageBounds();
  const viewportRect = {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width,
    height: viewport.height,
  };
  const teachingShapes = getTeachingShapes(editor);
  const nearViewportBlockIds = new Set<string>();
  teachingShapes.forEach((shape) => {
    const bounds = editor.getShapePageBounds(shape);
    if (
      bounds !== undefined &&
      isRectNearViewport(
        {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
        viewportRect,
      )
    ) {
      nearViewportBlockIds.add(shape.props.blockId);
    }
  });

  return {
    blockCount: teachingShapes.length,
    nearViewportCount: nearViewportBlockIds.size,
    nearViewportBlockIds,
  };
}

async function hashNormalizedProject(
  project: NormalizedProject,
): Promise<string> {
  const canonicalFiles = Object.keys(project.files)
    .sort()
    .map((path) => {
      const file = project.files[path];
      return file
        ? [path, file.mimeType, file.encoding ?? "utf8", file.content]
        : [path];
    });
  const bytes = new TextEncoder().encode(JSON.stringify(canonicalFiles));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function hashTutorCssMutation(input: {
  readonly blockId: string;
  readonly selector: string;
  readonly property: string;
  readonly value: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        "apply_css_change",
        input.blockId,
        input.selector,
        input.property,
        input.value,
      ]),
    ),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function browserFilesToImportedFiles(
  files: readonly File[],
): Promise<ImportedFile[]> {
  if (files.length > MAX_IMPORT_FILE_COUNT) {
    throw new Error(`一次最多载入 ${MAX_IMPORT_FILE_COUNT} 个文件。`);
  }

  let totalBytes = 0;
  for (const file of files) {
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      throw new Error(`“${file.name}”超过 2 MB，请缩小后再试。`);
    }
    totalBytes += file.size;
    if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
      throw new Error("这些文件合计超过 10 MB，请分成较小的页面再载入。");
    }
  }

  const importedFiles: ImportedFile[] = [];
  for (const file of files) {
    importedFiles.push({
      path: file.webkitRelativePath || file.name,
      mimeType: file.type,
      bytes: new Uint8Array(await file.arrayBuffer()),
    });
  }
  return importedFiles;
}

function createRuntimeProjectRecord(
  project: NormalizedProject,
  blockId: string,
  contentHash: string,
  options: {
    authorType?: CodeRevision["authorType"];
    changeSummary?: string;
    sourceKind?: RuntimeProjectRecord["sourceKind"];
  } = {},
): RuntimeProjectRecord {
  const createdAt = new Date().toISOString();
  const snapshot: ImportSnapshot = Object.freeze({
    id: `snapshot-${crypto.randomUUID()}`,
    canvasId: "local-teaching-canvas",
    runtimeType: project.runtimeType,
    entryFile: project.entryFile,
    files: project.files,
    contentHash,
    createdAt,
  });
  const revision: CodeRevision = Object.freeze({
    id: `revision-${crypto.randomUUID()}`,
    blockId,
    parentRevisionId: null,
    authorType: options.authorType ?? "user",
    files: project.files,
    contentHash,
    changeSummary: options.changeSummary ?? "Imported immutable HTML/CSS snapshot",
    createdAt,
  });
  return Object.freeze({
    snapshot,
    project,
    revisions: Object.freeze([revision]),
    currentRevisionId: revision.id,
    sourceKind: options.sourceKind ?? "user-import",
  });
}

function personalizedOriginFromPlan(
  plan: PersonalizedCoursePlan,
): PersonalizedLessonOrigin | null {
  const verification = plan.progress.verification;
  const prediction = plan.progress.predictionAnswer;
  const explanation = plan.progress.explanationAnswer;
  if (
    !verification ||
    !prediction ||
    !explanation ||
    plan.progress.explanationCorrect !== true
  ) {
    return null;
  }
  return Object.freeze({
    version: 1,
    planId: plan.id,
    courseId: plan.courseId,
    sourceBlockId: plan.blockId,
    baseRevisionId: plan.baseRevisionId,
    baseContentHash: plan.baseContentHash,
    verifiedRevisionId: verification.revisionId,
    analyzerVersion: plan.analyzerVersion,
    domPath: plan.selector,
    source: Object.freeze({ ...plan.source }),
    experiment: Object.freeze({
      property: plan.experiment.property,
      beforeValue: plan.before.computedValue,
      trialValue: plan.experiment.trialValue,
      verifiedValue: verification.computedValue,
      verifiedAt: verification.capturedAt,
      beforeRect: Object.freeze({
        width: plan.before.boundingWidth,
        height: plan.before.boundingHeight,
        x: plan.before.boundingX,
        y: plan.before.boundingY,
      }),
      afterRect: Object.freeze({
        width: verification.boundingWidth,
        height: verification.boundingHeight,
        x: verification.boundingX,
        y: verification.boundingY,
      }),
    }),
    formativeAnswers: Object.freeze({
      prediction,
      explanation,
      explanationAttempts: plan.progress.explanationAttempts,
    }),
    hiddenTransfer: Object.freeze({
      itemId: plan.hiddenTransferItemId,
      sha256: plan.hiddenTransferItemHash,
    }),
  });
}

export function CanvasWorkspace() {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [metrics, setMetrics] = useState<CanvasMetrics>(EMPTY_METRICS);
  const [runtimeProjects, setRuntimeProjectsState] = useState<
    ReadonlyMap<string, RuntimeProjectRecord>
  >(new Map());
  const runtimeProjectsRef = useRef<ReadonlyMap<string, RuntimeProjectRecord>>(
    new Map(),
  );
  const workspaceRevisionRef = useRef(0);
  const workspacePersistedRevisionRef = useRef(0);
  const deletedRuntimeProjectsRef = useRef(
    new Map<string, RuntimeProjectRecord>(),
  );
  const experimentCommitTailsRef = useRef<Map<string, Promise<void>>>(
    new Map(),
  );
  const setRuntimeProjects = useCallback(
    (
      update:
        | ReadonlyMap<string, RuntimeProjectRecord>
        | ((
            current: ReadonlyMap<string, RuntimeProjectRecord>,
          ) => ReadonlyMap<string, RuntimeProjectRecord>),
    ) => {
      const next =
        typeof update === "function"
          ? update(runtimeProjectsRef.current)
          : update;
      if (Object.is(next, runtimeProjectsRef.current)) return;
      runtimeProjectsRef.current = next;
      workspaceRevisionRef.current += 1;
      setRuntimeProjectsState(next);
    },
    [],
  );
  const [comparisons, setComparisonsState] = useState<
    ReadonlyMap<string, ComparisonRecord>
  >(new Map());
  const comparisonsRef = useRef<ReadonlyMap<string, ComparisonRecord>>(
    new Map(),
  );
  const deletedComparisonsRef = useRef(new Map<string, ComparisonRecord>());
  const setComparisons = useCallback(
    (
      update:
        | ReadonlyMap<string, ComparisonRecord>
        | ((
            current: ReadonlyMap<string, ComparisonRecord>,
          ) => ReadonlyMap<string, ComparisonRecord>),
    ) => {
      const next =
        typeof update === "function"
          ? update(comparisonsRef.current)
          : update;
      if (Object.is(next, comparisonsRef.current)) return;
      comparisonsRef.current = next;
      workspaceRevisionRef.current += 1;
      setComparisonsState(next);
    },
    [],
  );
  const [isImporting, setIsImporting] = useState(false);
  const [isClearCanvasArmed, setIsClearCanvasArmed] = useState(false);
  const [activity, setActivity] = useState("正在加载本地画布…");
  const [lessonPanelsVisible, setLessonPanelsVisible] = useState(true);
  const [taskRouteExpanded, setTaskRouteExpanded] = useState(true);
  const [hiddenTransferOutcome, setHiddenTransferOutcome] = useState<
    "passed" | "failed" | null
  >(null);
  const handleHiddenTransferOutcome = useCallback(
    (outcome: "passed" | "failed" | null) => setHiddenTransferOutcome(outcome),
    [],
  );
  const runtimePreviewStore = useMemo(
    () => createRuntimePreviewStore(),
    [],
  );
  const inspectionBridgeRef = useRef<RuntimeInspectionBridge | null>(null);
  const inspectionSnapshotsRef = useRef(
    new Map<string, RuntimeInspectionSnapshot>(),
  );
  const personalizedCourseInFlightRef = useRef(false);
  const [personalizedCourseBusyBlockId, setPersonalizedCourseBusyBlockId] =
    useState<string | null>(null);
  const [personalizedCourseError, setPersonalizedCourseError] = useState<
    string | null
  >(null);
  const persistenceWriterIdRef = useRef(crypto.randomUUID());
  const externalCanvasUpdateRef = useRef(false);
  const workspaceRestoreStartedRef = useRef(false);
  const workspaceSaveTailRef = useRef<Promise<void>>(Promise.resolve());
  const workspaceSaveTimerRef = useRef<number | null>(null);
  const persistenceWriteBlockedRef = useRef(false);
  const [workspaceRescue, setWorkspaceRescue] = useState<{
    readonly reason: "corrupted" | "unsupported";
    readonly raw: string;
  } | null>(null);
  const [semanticStateReady, setSemanticStateReady] = useState(false);
  const semanticStateReadyRef = useRef(false);
  const captureLearningSnapshot = useCallback(() => {
    if (!editor || !semanticStateReady) return null;
    const shapes = getTeachingShapes(editor).map(
      (shape) =>
        JSON.parse(JSON.stringify(shape)) as Readonly<Record<string, unknown>>,
    );
    return {
      canvasSnapshot: { version: 1 as const, shapes },
      semanticSnapshot: {
        version: 1 as const,
        serializedState: serializeP5State(runtimeProjects, comparisons),
      },
    };
  }, [
    comparisons,
    editor,
    runtimeProjects,
    semanticStateReady,
  ]);
  const {
    lessonState: boxLesson,
    lessonStateRef: boxLessonRef,
    events: boxLessonEvents,
    scenarioLessonState,
    scenarioLessonStateRef,
    scenarioEvents,
    timelineEvents: learningTimelineEvents,
    syncStatus: learningProofSyncStatus,
    sessionHistory: learningProofSessionHistory,
    activeSessionId: activeLearningProofSessionId,
    authoritativeSnapshot: learningProofAuthoritativeSnapshot,
    ready: learningProofReady,
    start: startLearningProof,
    predict: recordLearningPrediction,
    experimentSaved: recordLearningExperiment,
    explain: recordLearningExplanation,
    support: recordLearningSupport,
    attachTransfer: recordLearningTransferBlock,
    submitTransfer: recordLearningTransfer,
    startScenario: startScenarioLearningProof,
    predictScenario: recordScenarioPrediction,
    scenarioExperimentSaved: recordScenarioLearningExperiment,
    explainScenario: recordScenarioExplanation,
    supportScenario: recordScenarioSupport,
    attachScenarioTransfer: recordScenarioTransferBlock,
    submitScenarioTransfer: recordScenarioTransfer,
    recordAuditEvent: recordLearningAuditEvent,
    retrySync: retryLearningProofSync,
    openLocalSession: openLearningProofSession,
    deleteLocalSession: deleteLearningProofSession,
    downloadLocal: downloadLearningProof,
  } = useLearningProof({
    captureSnapshot: captureLearningSnapshot,
    onNotice: setActivity,
  });
  const recordTutorLearningAudit = useCallback(
    (learningSessionId: string, event: LearningAuditEventInput) => {
      recordLearningAuditEvent(event, learningSessionId);
    },
    [recordLearningAuditEvent],
  );
  const collectTutorStudentActions = useCallback(
    (visibleBlockIds: ReadonlySet<string>): StudentActionFact[] => {
      const candidates: StudentActionFact[] = [];
      const seenEventIds = new Set<string>();
      for (const event of [...boxLessonEvents, ...scenarioEvents]) {
        if (seenEventIds.has(event.eventId)) continue;
        seenEventIds.add(event.eventId);
        const action = studentActionFromLearningEvent(event);
        if (
          action &&
          (action.blockId === null || visibleBlockIds.has(action.blockId))
        ) {
          candidates.push(action);
        }
      }
      for (const [blockId, record] of runtimeProjectsRef.current) {
        if (!visibleBlockIds.has(blockId)) continue;
        for (const revision of record.revisions) {
          const action = studentActionFromRevision(revision);
          if (action) candidates.push(action);
        }
        const preview = runtimePreviewStore.get(blockId);
        if (!preview) continue;
        const snapshot = inspectionSnapshotsRef.current.get(blockId);
        const task =
          boxLessonRef.current.lessonBlockId === blockId
            ? boxLessonRef.current.phase
            : scenarioLessonStateRef.current.blocks.some(
                  (block) => block.blockId === blockId,
                )
              ? scenarioLessonStateRef.current.phase
              : null;
        for (const [property, value] of Object.entries(preview.changes)) {
          candidates.push({
            at: preview.updatedAt,
            source: "browser-transient",
            action: "preview-css-change",
            blockId,
            target: preview.target.domPath,
            property,
            beforeValue: inspectionStyleValue(snapshot, property),
            afterValue: value,
            transient: true,
            saved: false,
            revisionId: null,
            task,
            detail: `学生正在预览 ${property}: ${value}，尚未保存。`,
          });
        }
      }
      return candidates;
    },
    [
      boxLessonEvents,
      boxLessonRef,
      runtimePreviewStore,
      scenarioEvents,
      scenarioLessonStateRef,
    ],
  );
  const tutorOperationsRef = useRef<TutorCanvasOperations | null>(null);
  const tutorExecutorRef = useRef<TutorToolExecutor | null>(null);

  const persistCurrentCanvasState = useCallback(async () => {
    if (!editor) throw new Error("教学画布尚未就绪。");
    if (persistenceWriteBlockedRef.current) {
      throw new Error("请先下载并处理设备上的救援记录，再开始新的本地记录。");
    }
    if (externalCanvasUpdateRef.current) {
      throw new Error("另一个标签页已保存更新；请刷新后再继续，当前页面不会覆盖它。");
    }
    const save = workspaceSaveTailRef.current
      .catch(() => undefined)
      .then(async () => {
        const revisionAtStart = workspaceRevisionRef.current;
        const documentHistoryAtStart = readDocumentHistoryEpochs(editor);
        const semanticState = serializeP5State(
          runtimeProjectsRef.current,
          comparisonsRef.current,
        );
        const canvasSnapshot = editor.getSnapshot();
        await saveWorkspaceState({
          canvasSnapshot,
          semanticState,
          writerId: persistenceWriterIdRef.current,
        });
        writeLegacyWorkspaceMirrors(
          canvasSnapshot,
          semanticState,
          persistenceWriterIdRef.current,
        );
        const documentUnchanged = documentHistoryMatches(
          documentHistoryAtStart,
          readDocumentHistoryEpochs(editor),
        );
        workspacePersistedRevisionRef.current = Math.max(
          workspacePersistedRevisionRef.current,
          documentUnchanged
            ? workspaceRevisionRef.current
            : revisionAtStart,
        );
      });
    workspaceSaveTailRef.current = save;
    await save;
  }, [editor]);

  const scheduleWorkspacePersistence = useCallback(() => {
    if (
      !semanticStateReadyRef.current ||
      persistenceWriteBlockedRef.current ||
      externalCanvasUpdateRef.current ||
      workspaceRevisionRef.current <= workspacePersistedRevisionRef.current
    ) {
      return;
    }
    if (workspaceSaveTimerRef.current !== null) {
      window.clearTimeout(workspaceSaveTimerRef.current);
    }
    workspaceSaveTimerRef.current = window.setTimeout(() => {
      workspaceSaveTimerRef.current = null;
      if (
        workspaceRevisionRef.current <= workspacePersistedRevisionRef.current
      ) {
        return;
      }
      void persistCurrentCanvasState().catch((error: unknown) => {
        setActivity(
          error instanceof Error && error.message.includes("另一个标签页")
            ? error.message
            : "设备保存空间不足；当前内容仍可继续使用，请尽快导出或释放空间",
        );
      });
    }, 400);
  }, [persistCurrentCanvasState]);

  useEffect(() => {
    if (!editor || workspaceRestoreStartedRef.current) return;
    workspaceRestoreStartedRef.current = true;
    let cancelled = false;
    const activateRescue = (
      reason: "corrupted" | "unsupported",
      raw: string,
    ) => {
      persistenceWriteBlockedRef.current = true;
      setWorkspaceRescue({ reason, raw });
      setActivity(
        reason === "unsupported"
          ? "设备记录来自更新版本；原文没有被覆盖，请先下载救援包"
          : "设备记录校验失败；原文没有被覆盖，请先下载救援包",
      );
    };
    const finish = async () => {
      let restoredBlockCount = getTeachingShapes(editor).length;
      try {
        const durable = await loadWorkspaceState();
        if (cancelled) return;
        if (durable.status === "ready") {
          const semantic = parseP5State(durable.state.semanticState);
          if (!semantic) {
            activateRescue("corrupted", JSON.stringify(durable.state));
          } else {
            editor.loadSnapshot(
              durable.state.canvasSnapshot as TLEditorSnapshot,
            );
            setRuntimeProjects(semantic.projects);
            setComparisons(semantic.comparisons);
            restoredBlockCount = getTeachingShapes(editor).length;
            setActivity(
              restoredBlockCount > 0
                ? "已从设备恢复上次工作区"
                : "空白画布已就绪",
            );
          }
        } else if (durable.status === "rescue") {
          activateRescue(durable.reason, durable.raw);
        } else {
          const legacySemanticRaw = window.localStorage.getItem(
            SEMANTIC_PERSISTENCE_KEY,
          );
          if (getTeachingShapes(editor).length === 0) {
            try {
              restoreLegacyCanvasState(editor);
            } catch (error) {
              activateRescue(
                "corrupted",
                JSON.stringify({
                  canvas: window.localStorage.getItem(
                    DURABLE_CANVAS_SNAPSHOT_KEY,
                  ),
                  semantic: legacySemanticRaw,
                  message:
                    error instanceof Error ? error.message : "旧画布记录损坏",
                }),
              );
            }
          }
          if (!persistenceWriteBlockedRef.current && legacySemanticRaw) {
            const semantic = parseP5State(legacySemanticRaw);
            if (!semantic) {
              activateRescue(
                "corrupted",
                JSON.stringify({
                  canvas: window.localStorage.getItem(
                    DURABLE_CANVAS_SNAPSHOT_KEY,
                  ),
                  semantic: legacySemanticRaw,
                }),
              );
            } else {
              setRuntimeProjects(semantic.projects);
              setComparisons(semantic.comparisons);
            }
          }
          restoredBlockCount = getTeachingShapes(editor).length;
          if (!persistenceWriteBlockedRef.current) {
            setActivity(
              restoredBlockCount > 0
                ? "已从设备恢复上次画布"
                : "空白画布已就绪",
            );
          }
        }
      } catch (error) {
        if (cancelled) return;
        setActivity(
          error instanceof Error
            ? `设备工作区暂时无法读取：${error.message}`
            : "设备工作区暂时无法读取；当前可继续使用空白画布",
        );
      } finally {
        if (cancelled) return;
        semanticStateReadyRef.current = true;
        setSemanticStateReady(true);
        if (restoredBlockCount > 0) {
          window.requestAnimationFrame(() =>
            editor.zoomToFit({ animation: { duration: 220 } }),
          );
        }
      }
    };
    void finish();
    return () => {
      cancelled = true;
    };
  }, [editor, setComparisons, setRuntimeProjects]);

  useEffect(() => {
    if (!semanticStateReady) return;
    scheduleWorkspacePersistence();
  }, [
    comparisons,
    runtimeProjects,
    scheduleWorkspacePersistence,
    semanticStateReady,
  ]);

  useEffect(() => {
    if (!editor || !semanticStateReady) return;

    const reconcileSemanticState = () => {
      const shapes = getTeachingShapes(editor);
      const runnableBlockIds = new Set(
        shapes
          .filter((shape) => shape.props.kind === "runnable")
          .map((shape) => shape.props.blockId),
      );
      const comparisonBlockIds = new Set(
        shapes
          .filter((shape) => shape.props.kind === "comparison")
          .map((shape) => shape.props.blockId),
      );

      setRuntimeProjects((current) =>
        reconcileMapKeysWithTombstones(
          current,
          runnableBlockIds,
          deletedRuntimeProjectsRef.current,
        ),
      );
      setComparisons((current) =>
        reconcileComparisonsWithTombstones(
          current,
          comparisonBlockIds,
          runnableBlockIds,
          deletedComparisonsRef.current,
        ),
      );
    };

    reconcileSemanticState();
    return editor.store.listen(reconcileSemanticState, {
      scope: "document",
    });
  }, [editor, semanticStateReady, setComparisons, setRuntimeProjects]);

  useEffect(() => {
    if (!editor || !semanticStateReady) return;
    return editor.store.listen(
      () => {
        workspaceRevisionRef.current += 1;
        scheduleWorkspacePersistence();
      },
      { scope: "document" },
    );
  }, [editor, scheduleWorkspacePersistence, semanticStateReady]);

  useEffect(
    () => () => {
      if (workspaceSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSaveTimerRef.current);
      }
    },
    [],
  );

  const handleMount = useCallback((mountedEditor: Editor) => {
    setEditor(mountedEditor);
    mountedEditor.setCameraOptions({
      ...mountedEditor.getCameraOptions(),
      wheelBehavior: "zoom",
    });
    const restoredBlockCount = getTeachingShapes(mountedEditor).length;
    setActivity(
      restoredBlockCount > 0
        ? "正在核对设备上的工作区…"
        : "正在检查设备上的工作区…",
    );

    let animationFrame = 0;
    const updateMetrics = () => {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const nextMetrics = readCanvasMetrics(mountedEditor);
        setMetrics(nextMetrics);
      });
    };

    updateMetrics();
    const stopListening = mountedEditor.store.listen(updateMetrics);

    return () => {
      stopListening();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  useEffect(() => {
    const handleExternalCanvasUpdate = (event: StorageEvent) => {
      if (
        event.storageArea !== window.localStorage ||
        event.key !== WORKSPACE_UPDATE_SIGNAL_KEY ||
        !event.newValue
      ) {
        return;
      }
      try {
        const envelope = JSON.parse(
          event.newValue,
        ) as { writerId?: unknown };
        if (
          envelope.writerId &&
          envelope.writerId !== persistenceWriterIdRef.current
        ) {
          externalCanvasUpdateRef.current = true;
          setActivity(
            "另一个标签页刚更新了画布；当前页面不会在离开时覆盖它。刷新可载入最新内容",
          );
        }
      } catch {
        // A damaged external value is handled by the normal recovery path.
      }
    };
    window.addEventListener("storage", handleExternalCanvasUpdate);
    return () => {
      window.removeEventListener("storage", handleExternalCanvasUpdate);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;
    const persistBeforeLeaving = () => {
      if (
        !semanticStateReadyRef.current ||
        externalCanvasUpdateRef.current
      ) {
        return;
      }
      if (workspaceSaveTimerRef.current !== null) {
        window.clearTimeout(workspaceSaveTimerRef.current);
        workspaceSaveTimerRef.current = null;
      }
      void persistCurrentCanvasState().catch(() => undefined);
    };
    window.addEventListener("pagehide", persistBeforeLeaving);
    return () => {
      window.removeEventListener("pagehide", persistBeforeLeaving);
    };
  }, [editor, persistCurrentCanvasState]);

  const importStaticFiles = useCallback(
    async (files: readonly File[]) => {
      if (!editor || files.length === 0) return;
      setIsImporting(true);
      setActivity(`正在整理 ${files.length} 个文件…`);

      try {
        const importedFiles = await browserFilesToImportedFiles(files);
        const project = await staticHtmlCssAdapter.normalize(importedFiles);
        const contentHash = await hashNormalizedProject(project);
        const definition = TEACHING_BLOCK_DEFINITIONS.runnable;
        const center = editor.getViewportPageBounds().center;
        const importOffset = getTeachingShapes(editor).length % 5;
        const shape = makeTeachingBlockShape(
          "runnable",
          {
            x: center.x - definition.width / 2 + importOffset * 34,
            y: center.y - definition.height / 2 + importOffset * 28,
          },
          `import-${crypto.randomUUID()}`,
        );
        if (!shape.id || !shape.props?.blockId) {
          throw new Error("无法为导入项目创建运行块。");
        }

        const blockId: string = shape.props.blockId;
        const entryName =
          project.entryFile.split("/").at(-1) ?? project.entryFile;
        const runnableShape = {
          ...shape,
          props: {
            ...shape.props,
            title: `导入 · ${entryName}`,
            summary: `已载入 ${Object.keys(project.files).length} 个文件，可以开始点选和调整页面。`,
          },
        };
        const record = createRuntimeProjectRecord(
          project,
          blockId,
          contentHash,
        );

        editor.createShape(runnableShape);
        setRuntimeProjects((current) => {
          const next = new Map(current);
          next.set(blockId, record);
          return next;
        });
        editor.select(shape.id);
        editor.zoomToSelection({ animation: { duration: 220 } });

        const warningCount = project.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "warning",
        ).length;
        setActivity(
          warningCount > 0
            ? `页面已载入；有 ${warningCount} 个内容未能显示`
            : "页面已载入，可以开始调整",
        );
      } catch (error) {
        const message =
          error instanceof StaticHtmlImportError
            ? error.diagnostics
                .filter((diagnostic) => diagnostic.severity === "error")
                .map((diagnostic) => diagnostic.message)
                .join(" ")
            : error instanceof Error
              ? error.message
              : "静态 HTML/CSS 导入失败";
        setActivity(`导入失败：${message}`);
      } finally {
        setIsImporting(false);
      }
    },
    [editor, setRuntimeProjects],
  );

  const createComparison = useCallback(
    (
      sourceBlockId: string,
      beforeRevisionId: string,
      afterRevisionId: string,
      target?: SavedElementTarget,
      options: { readonly focus?: boolean } = {},
    ) => {
      if (!editor || beforeRevisionId === afterRevisionId) return null;
      const sourceShape = getTeachingShapes(editor).find(
        (shape) => shape.props.blockId === sourceBlockId,
      );
      if (!sourceShape) return null;
      const blockId = `comparison-${crypto.randomUUID()}`;
      const definition = TEACHING_BLOCK_DEFINITIONS.comparison;
      const shape = makeTeachingBlockShape(
        "comparison",
        {
          x: sourceShape.x + sourceShape.props.w + 80,
          y: sourceShape.y,
        },
        blockId,
      );
      if (!shape.props) return null;
      const comparisonShape = {
        ...shape,
        props: {
          ...shape.props,
          title: "看看修改前后",
          summary: "拖动滑块时，修改后的页面会马上跟着变化。",
          w: Math.max(definition.width, 720),
          h: Math.max(definition.height, 520),
        },
      };
      const comparisonBlockId = shape.props.blockId;
      if (typeof comparisonBlockId !== "string") return null;
      editor.createShape(comparisonShape);
      setComparisons((current) => {
        const next = new Map(current);
        next.set(comparisonBlockId, {
          blockId: comparisonBlockId,
          sourceBlockId,
          beforeRevisionId,
          afterRevisionId,
          mode: "side-by-side",
          wipePosition: 50,
          ...(target ? { focusTarget: target } : {}),
        });
        return next;
      });
      if (shape.id && options.focus !== false) {
        editor.select(shape.id);
        editor.zoomToSelection({ animation: { duration: 220 } });
      }
      setActivity("修改前后已放到一起");
      return comparisonBlockId;
    },
    [editor, setComparisons],
  );

  const saveExperiment = useCallback(
    async (
      blockId: string,
      target: SavedElementTarget,
      changes: readonly CssExperimentChange[],
      context?: {
        readonly beforeValues?: Readonly<Record<string, string>>;
      },
    ) => {
      if (changes.length === 0) return;
      const previous =
        experimentCommitTailsRef.current.get(blockId) ?? Promise.resolve();
      const commit = previous.catch(() => undefined).then(async () => {
        const record = runtimeProjectsRef.current.get(blockId);
        if (!record) {
          throw new Error("这个页面已经不在画布上，本次修改没有保存");
        }
        const parent = currentRevision(record);
        const revision = await createExperimentRevision(record, target, changes);
        let committed = false;
        let duplicate = false;
        let branched = false;
        let savedRevisionId = revision.id;
        let competingRevisionId = parent.id;
        setRuntimeProjects((current) => {
          const latest = current.get(blockId);
          if (
            !latest ||
            !latest.revisions.some((candidate) => candidate.id === parent.id)
          ) {
            return current;
          }
          const appended = appendRevision(latest, revision);
          duplicate = appended.duplicate;
          branched = appended.branched;
          savedRevisionId = appended.revisionId;
          competingRevisionId = appended.competingRevisionId;
          committed = true;
          if (appended.duplicate) return current;
          const next = new Map(current);
          next.set(blockId, appended.record);
          return next;
        });
        if (!committed) {
          throw new Error("页面或父版本已经不在画布上，本次修改没有保存");
        }
        if (duplicate) {
          setActivity("这次变化已经保存过，没有重复建立版本");
          return;
        }
        const comparisonBeforeRevisionId = branched
          ? competingRevisionId
          : parent.id;
        const linkedComparison = [...comparisonsRef.current.values()]
          .reverse()
          .find((comparison) => comparison.sourceBlockId === blockId);
        let createdComparisonBlockId: string | null = null;
        if (linkedComparison) {
          setComparisons((current) => {
            const latest = current.get(linkedComparison.blockId);
            if (!latest) return current;
            const next = new Map(current);
            next.set(linkedComparison.blockId, {
              ...latest,
              beforeRevisionId: comparisonBeforeRevisionId,
              afterRevisionId: savedRevisionId,
              focusTarget: target,
            });
            return next;
          });
        } else {
          createdComparisonBlockId = createComparison(
            blockId,
            comparisonBeforeRevisionId,
            savedRevisionId,
            target,
            { focus: false },
          );
        }
        if (workspaceSaveTimerRef.current !== null) {
          window.clearTimeout(workspaceSaveTimerRef.current);
          workspaceSaveTimerRef.current = null;
        }
        try {
          await persistCurrentCanvasState();
        } catch {
          setRuntimeProjects((current) => {
            const latest = current.get(blockId);
            if (
              !latest ||
              !latest.revisions.some(
                (candidate) => candidate.id === savedRevisionId,
              )
            ) {
              return current;
            }
            const next = new Map(current);
            next.set(blockId, record);
            return next;
          });
          if (createdComparisonBlockId) {
            const failedComparisonBlockId = createdComparisonBlockId;
            setComparisons((current) => {
              if (!current.has(failedComparisonBlockId)) return current;
              const next = new Map(current);
              next.delete(failedComparisonBlockId);
              return next;
            });
            deletedComparisonsRef.current.delete(failedComparisonBlockId);
            const comparisonShape = editor
              ? getTeachingShapes(editor).find(
                  (shape) =>
                    shape.props.blockId === failedComparisonBlockId,
                )
              : undefined;
            if (comparisonShape && editor) {
              editor.deleteShapes([comparisonShape.id]);
            }
            deletedComparisonsRef.current.delete(failedComparisonBlockId);
          } else if (linkedComparison) {
            setComparisons((current) => {
              const latest = current.get(linkedComparison.blockId);
              if (
                !latest ||
                latest.afterRevisionId !== savedRevisionId
              ) {
                return current;
              }
              const next = new Map(current);
              next.set(linkedComparison.blockId, linkedComparison);
              return next;
            });
          }
          const message =
            "这次变化没能写进设备，页面已恢复到上次保存的样子；请释放空间后再试一次";
          setActivity(message);
          throw new Error(message);
        }
        const savedAt = new Date().toISOString();
        for (const change of changes) {
          recordLearningExperiment(
            blockId,
            savedRevisionId,
            change.property,
            change.value,
            savedAt,
            {
              target: target.domPath,
              beforeValue: context?.beforeValues?.[change.property] ?? null,
            },
          );
          recordScenarioLearningExperiment(
            blockId,
            savedRevisionId,
            change.property,
            change.value,
            savedAt,
            {
              target: target.domPath,
              beforeValue: context?.beforeValues?.[change.property] ?? null,
            },
          );
        }
        setActivity(
          branched
            ? "同时发生的两次修改都已保留为分支；现在打开的是你的版本"
            : "这次变化已保存，之前的样子也还在",
        );
      });
      experimentCommitTailsRef.current.set(blockId, commit);
      try {
        await commit;
      } finally {
        if (experimentCommitTailsRef.current.get(blockId) === commit) {
          experimentCommitTailsRef.current.delete(blockId);
        }
      }
    },
    [
      createComparison,
      editor,
      persistCurrentCanvasState,
      recordLearningExperiment,
      recordScenarioLearningExperiment,
      setComparisons,
      setRuntimeProjects,
    ],
  );

  const switchRevision = useCallback(
    (blockId: string, revisionId: string) => {
      setRuntimeProjects((current) => {
        const record = current.get(blockId);
        if (!record || !record.revisions.some((revision) => revision.id === revisionId)) {
          return current;
        }
        const next = new Map(current);
        next.set(blockId, Object.freeze({ ...record, currentRevisionId: revisionId }));
        return next;
      });
      setActivity("已回到这次修改");
    },
    [setRuntimeProjects],
  );

  const forkProject = useCallback(
    async (sourceBlockId: string) => {
      if (!editor) return;
      const sourceRecord = runtimeProjects.get(sourceBlockId);
      const sourceShape = getTeachingShapes(editor).find(
        (shape) => shape.props.blockId === sourceBlockId,
      );
      if (!sourceRecord || !sourceShape) return;
      const parent = currentRevision(sourceRecord);
      const shape = makeTeachingBlockShape(
        "runnable",
        { x: sourceShape.x + 70, y: sourceShape.y + sourceShape.props.h + 70 },
        `fork-${crypto.randomUUID()}`,
      );
      if (!shape.props) return;
      const blockId = shape.props.blockId;
      if (typeof blockId !== "string") return;
      const createdAt = new Date().toISOString();
      const revision = Object.freeze({
        ...parent,
        id: `revision-${crypto.randomUUID()}`,
        blockId,
        parentRevisionId: null,
        changeSummary: `Copied from ${parent.id.slice(0, 18)}`,
        createdAt,
      });
      const record: RuntimeProjectRecord = Object.freeze({
        snapshot: sourceRecord.snapshot,
        project: sourceRecord.project,
        revisions: Object.freeze([revision]),
        currentRevisionId: revision.id,
        sourceKind: "fork",
        forkedFrom: {
          blockId: sourceBlockId,
          revisionId: parent.id,
        },
      });
      editor.createShape({
        ...shape,
        props: {
          ...shape.props,
          title: "实验分支",
          summary: "从父版本复制；后续修改不会覆盖来源块。",
        },
      });
      setRuntimeProjects((current) => new Map(current).set(blockId, record));
      if (shape.id) {
        editor.select(shape.id);
        editor.zoomToSelection({ animation: { duration: 220 } });
      }
      setActivity("已复制成新实验");
    },
    [editor, runtimeProjects, setRuntimeProjects],
  );

  const updateComparison = useCallback(
    (
      blockId: string,
      update: Partial<Pick<ComparisonRecord, "mode" | "wipePosition">>,
    ) => {
      setComparisons((current) => {
        const comparison = current.get(blockId);
        if (!comparison) return current;
        const next = new Map(current);
        next.set(blockId, { ...comparison, ...update });
        return next;
      });
    },
    [setComparisons],
  );

  const saveSourceRevision = useCallback(
    async (
      blockId: string,
      prepared: PreparedSourceRun,
      summary: string,
    ) => {
      const record = runtimeProjectsRef.current.get(blockId);
      if (!record) throw new Error("这个页面已经不在画布上了。");
      const revision = await createSourceRevision(record, prepared, summary);
      let committed = false;
      let duplicate = false;
      let branched = false;
      let savedRevisionId = revision.id;
      let competingRevisionId = prepared.baseRevisionId;
      setRuntimeProjects((current) => {
        const latest = current.get(blockId);
        if (
          !latest ||
          !latest.revisions.some(
            (candidate) => candidate.id === prepared.baseRevisionId,
          )
        ) {
          return current;
        }
        const appended = appendRevision(latest, revision, prepared.project);
        duplicate = appended.duplicate;
        branched = appended.branched;
        savedRevisionId = appended.revisionId;
        competingRevisionId = appended.competingRevisionId;
        committed = true;
        if (appended.duplicate) return current;
        const next = new Map(current);
        next.set(blockId, appended.record);
        return next;
      });
      if (!committed) {
        throw new Error("页面或父版本已经不在画布上；草稿仍在，请另存后重试。");
      }
      if (duplicate) {
        setActivity("这个 HTML/CSS 版本已经保存过，没有重复建立版本");
        return;
      }
      const comparisonBeforeRevisionId = branched
        ? competingRevisionId
        : prepared.baseRevisionId;
      const linkedComparison = [...comparisonsRef.current.values()]
        .reverse()
        .find((comparison) => comparison.sourceBlockId === blockId);
      if (linkedComparison) {
        setComparisons((current) => {
          const latest = current.get(linkedComparison.blockId);
          if (!latest) return current;
          const next = new Map(current);
          next.set(linkedComparison.blockId, {
            ...latest,
            beforeRevisionId: comparisonBeforeRevisionId,
            afterRevisionId: savedRevisionId,
          });
          return next;
        });
      } else {
        createComparison(
          blockId,
          comparisonBeforeRevisionId,
          savedRevisionId,
          undefined,
          { focus: false },
        );
      }
      setActivity(
        branched
          ? "同时发生的两次修改都已保留为分支；现在打开的是你的 HTML/CSS 版本"
          : "HTML/CSS 新版本已保存，之前的版本仍可切回",
      );
      recordLearningAuditEvent({
        type: "audit-canvas-action",
        actorType: "user",
        at: new Date().toISOString(),
        source: "student",
        action: "保存新的 HTML/CSS 版本",
        blockId,
        revisionId: savedRevisionId,
        detail: summary.trim().slice(0, 500) || null,
      });
    },
    [
      createComparison,
      recordLearningAuditEvent,
      setComparisons,
      setRuntimeProjects,
    ],
  );

  const createRunnableDemo = useCallback(
    async (
      demo: LessonDemo,
      options: {
        readonly authorType: CodeRevision["authorType"];
        readonly changeSummary: string;
        readonly summary: string;
        readonly activity: string;
        readonly seedPrefix: string;
        readonly point?: { readonly x: number; readonly y: number };
        readonly focus?: boolean;
      },
    ) => {
      if (!editor) throw new Error("教学画布尚未就绪。");
      const project = await createDemoProject(demo);
      const contentHash = await hashNormalizedProject(project);
      const definition = TEACHING_BLOCK_DEFINITIONS.runnable;
      const center = editor.getViewportPageBounds().center;
      const shape = makeTeachingBlockShape(
        "runnable",
        options.point ?? {
          x: center.x - definition.width / 2 + 170,
          y: center.y - definition.height / 2,
        },
        `${options.seedPrefix}-${crypto.randomUUID()}`,
      );
      const blockId = shape.props?.blockId;
      if (typeof blockId !== "string") {
        throw new Error("演示块没有生成有效 ID。");
      }
      const record = createRuntimeProjectRecord(
        project,
        blockId,
        contentHash,
        {
          authorType: options.authorType,
          changeSummary: options.changeSummary,
          sourceKind: options.authorType === "ai" ? "ai-demo" : "lesson-demo",
        },
      );
      editor.createShape({
        ...shape,
        props: {
          ...shape.props,
          title: demo.title,
          summary: options.summary,
        },
      });
      setRuntimeProjects((current) => new Map(current).set(blockId, record));
      if (shape.id && options.focus !== false) {
        editor.select(shape.id);
        editor.zoomToSelection({ animation: { duration: 220 } });
      }
      setActivity(options.activity);
      return blockId;
    },
    [editor, setRuntimeProjects],
  );

  const createCssControllerBlock = useCallback(
    (
      sourceBlockId: string,
      property: TutorCssProperty,
      options: {
        readonly seedPrefix?: string;
        readonly offsetIndex?: number;
        readonly selector?: string;
        readonly title?: string;
      } = {},
    ) => {
      if (!editor) throw new Error("教学画布尚未就绪。");
      if (!runtimeProjectsRef.current.has(sourceBlockId)) {
        throw new Error(`运行块不存在：${sourceBlockId}`);
      }
      const sourceShape = getTeachingShapes(editor).find(
        (shape) => shape.props.blockId === sourceBlockId,
      );
      if (!sourceShape) throw new Error(`画布实体不存在：${sourceBlockId}`);
      const blockId = `${options.seedPrefix ?? "ai-controller"}-${crypto.randomUUID()}`;
      const shape = makeTeachingBlockShape(
        "css-controller",
        {
          x:
            sourceShape.x +
            (options.offsetIndex ?? 0) *
              (TEACHING_BLOCK_DEFINITIONS["css-controller"].width + 30),
          y: sourceShape.y + sourceShape.props.h + 54,
        },
        blockId,
      );
      editor.createShape({
        ...shape,
        props: {
          ...shape.props,
          title:
            options.title ??
            (property === "padding"
              ? "让里面更宽松"
              : property === "gap"
                ? "调一调项目间距"
                : property === "top"
                  ? "上下移动看看"
                  : `调节 ${property}`),
          summary: "拖动滑块，页面和前后对比会马上跟着变化。",
          sourceBlockId,
          cssProperty: property,
          cssSelector:
            options.selector ??
            inferDefaultSelector(
              runtimeProjectsRef.current.get(sourceBlockId)!.project,
            ),
        },
      });
      return shape.props?.blockId ?? blockId;
    },
    [editor],
  );


  const tutorOperations = useMemo<TutorCanvasOperations>(
    () => ({
      readCanvasState() {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shapes = getTeachingShapes(editor);
        const runnableBlockIds = new Set(
          shapes
            .filter((shape) => shape.props.kind === "runnable")
            .map((shape) => shape.props.blockId),
        );
        const visibleRuntimeProjects = retainMapKeys(
          runtimeProjectsRef.current,
          runnableBlockIds,
        );
        const visibleProjectIds = new Set(visibleRuntimeProjects.keys());
        return JSON.stringify({
          blockCount: shapes.length,
          selectedBlockIds: shapes
            .filter((shape) => editor.getSelectedShapeIds().includes(shape.id))
            .map((shape) => shape.props.blockId),
          runnableBlocks: [...visibleRuntimeProjects].map(([blockId, record]) => {
            const revision = currentRevision(record);
            return {
              blockId,
              defaultSelector: inferDefaultSelector(record.project),
              currentRevisionId: revision.id,
              revisionCount: record.revisions.length,
              currentRevision: {
                parentRevisionId: revision.parentRevisionId,
                authorType: revision.authorType,
                changeSummary: revision.changeSummary,
                createdAt: revision.createdAt,
              },
            };
          }),
          cssControllers: shapes
            .filter(
              (shape) =>
                shape.props.kind === "css-controller" &&
                typeof shape.props.sourceBlockId === "string" &&
                visibleProjectIds.has(shape.props.sourceBlockId),
            )
            .map((shape) => ({
              blockId: shape.props.blockId,
              sourceBlockId: shape.props.sourceBlockId,
              property: shape.props.cssProperty,
              selector: shape.props.cssSelector,
            })),
          comparisons: [...comparisons.values()]
            .filter((comparison) =>
              visibleProjectIds.has(comparison.sourceBlockId),
            )
            .map((comparison) => ({
              blockId: comparison.blockId,
              sourceBlockId: comparison.sourceBlockId,
              beforeRevisionId: comparison.beforeRevisionId,
              afterRevisionId: comparison.afterRevisionId,
              mode: comparison.mode,
            })),
          inspectionAvailableBlockIds: [...visibleProjectIds].filter(
            (blockId) => inspectionSnapshotsRef.current.has(blockId),
          ),
          supportedTopics: ["box-model", "flex", "positioning"],
        });
      },
      inspectSelectedElement(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shape = getTeachingShapes(editor).find(
          (candidate) =>
            candidate.props.kind === "runnable" &&
            candidate.props.blockId === input.blockId,
        );
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!shape || !record) {
          throw new Error(`运行块不存在：${input.blockId}`);
        }
        const snapshot = inspectionSnapshotsRef.current.get(input.blockId);
        if (!snapshot) {
          throw new Error(
            "请先在这个页面中选择一个元素，再读取它的浏览器事实。",
          );
        }
        const revision = currentRevision(record);
        if (snapshot.revisionId !== revision.id) {
          throw new Error("元素事实属于旧版本，请重新选择后再读取。");
        }
        return serializeTutorFact(selectedElementFact(snapshot));
      },
      readRelevantSource(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shape = getTeachingShapes(editor).find(
          (candidate) =>
            candidate.props.kind === "runnable" &&
            candidate.props.blockId === input.blockId,
        );
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!shape || !record) {
          throw new Error(`运行块不存在：${input.blockId}`);
        }
        const snapshot = inspectionSnapshotsRef.current.get(input.blockId);
        if (!snapshot) {
          throw new Error(
            "请先在这个页面中选择一个元素，再读取相关源码。",
          );
        }
        const revision = currentRevision(record);
        if (snapshot.revisionId !== revision.id) {
          throw new Error("相关源码定位属于旧版本，请重新选择后再读取。");
        }
        return serializeTutorFact(
          relevantSourceFact(snapshot, revision, record.snapshot.entryFile),
        );
      },
      readLastStudentAction() {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const visibleBlockIds = new Set(
          getTeachingShapes(editor)
            .filter((shape) => shape.props.kind === "runnable")
            .map((shape) => shape.props.blockId),
        );
        const action = newestStudentAction(
          collectTutorStudentActions(visibleBlockIds),
        );
        return serializeTutorFact({
          factVersion: 1,
          factType: "last-student-action",
          action,
          evidenceStatus: action ? "grounded" : "insufficient",
          uncertainty: action
            ? null
            : "当前画布没有可验证的学生预览、学习事件或用户版本。",
        });
      },
      readTeachingAssertionEvidence(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shape = getTeachingShapes(editor).find(
          (candidate) =>
            candidate.props.kind === "runnable" &&
            candidate.props.blockId === input.blockId,
        );
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!shape || !record) {
          throw new Error(`运行块不存在：${input.blockId}`);
        }
        const snapshot = inspectionSnapshotsRef.current.get(input.blockId);
        if (!snapshot) {
          throw new Error(
            "请先在这个页面中选择一个元素，再建立教学断言证据。",
          );
        }
        const revision = currentRevision(record);
        if (snapshot.revisionId !== revision.id) {
          throw new Error("教学断言事实属于旧版本，请重新选择后再读取。");
        }
        const action = newestStudentAction(
          collectTutorStudentActions(new Set([input.blockId])).filter(
            (candidate) => candidate.blockId === input.blockId,
          ),
        );
        return serializeTutorFact(
          teachingAssertionEvidence(snapshot, action),
        );
      },
      async createMinimalVerification(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shape = getTeachingShapes(editor).find(
          (candidate) =>
            candidate.props.kind === "runnable" &&
            candidate.props.blockId === input.blockId,
        );
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!shape || !record) {
          throw new Error(`运行块不存在：${input.blockId}`);
        }
        const snapshot = inspectionSnapshotsRef.current.get(input.blockId);
        if (!snapshot) {
          throw new Error("请先在这个页面中选择一个元素，再建立最小验证实验。");
        }
        const revision = currentRevision(record);
        if (snapshot.revisionId !== revision.id) {
          throw new Error("元素事实属于旧版本，请重新选择后再建立验证实验。");
        }
        const action = newestStudentAction(
          collectTutorStudentActions(new Set([input.blockId])).filter(
            (candidate) => candidate.blockId === input.blockId,
          ),
        );
        const evidence = teachingAssertionEvidence(snapshot, action);
        if (evidence.assertionAllowed) {
          throw new Error("当前因果证据已经完整，无需建立额外验证实验。");
        }
        const property = action?.property;
        const topic: TutorTopic =
          property && ["display", "gap", "flex-direction", "justify-content", "align-items"].includes(property)
            ? "flex"
            : property && ["position", "top", "right", "bottom", "left"].includes(property)
              ? "positioning"
              : "box-model";
        const experimentBlockId = await createRunnableDemo(
          {
            ...LESSON_DEMOS[topic],
            title: `最小验证 · ${LESSON_DEMOS[topic].title}`,
          },
          {
            authorType: "ai",
            changeSummary: `AI isolated ${topic} verification`,
            summary: "这个独立小实验只核对一个 CSS 概念，不替原页面猜测原因。",
            activity: "AI 已创建一个独立的最小验证实验",
            seedPrefix: "ai-verification",
          },
        );
        return serializeTutorFact({
          factVersion: 1,
          factType: "minimal-verification-experiment",
          sourceBlockId: input.blockId,
          sourceRevisionId: revision.id,
          experimentBlockId,
          topic,
          observedProperty: property ?? null,
          selectorSource: "derived-inside-validated-demo",
          modelSuppliedSelector: false,
          scope: "isolated-concept-check-not-source-causality",
          originalEvidenceStatus: evidence.evidenceStatus,
          originalUncertainty: evidence.uncertainty,
        });
      },
      createExplanation(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const definition = TEACHING_BLOCK_DEFINITIONS.explanation;
        const center = editor.getViewportPageBounds().center;
        const latestRunnable = getTeachingShapes(editor)
          .filter((shape) => shape.props.kind === "runnable")
          .at(-1);
        const blockId = `ai-explanation-${crypto.randomUUID()}`;
        const shape = makeTeachingBlockShape(
          "explanation",
          latestRunnable
            ? {
                x: latestRunnable.x - definition.width + 60,
                y:
                  latestRunnable.y +
                  (latestRunnable.props.h - definition.height) / 2,
              }
            : {
                x: center.x - definition.width / 2 - 220,
                y: center.y - definition.height / 2,
              },
          blockId,
        );
        editor.createShape({
          ...shape,
          props: { ...shape.props, title: input.title, summary: input.summary },
        });
        setActivity(`AI 已创建讲解块：${input.title}`);
        return blockId;
      },
      async createDemo(input) {
        const demo = {
          ...LESSON_DEMOS[input.topic],
          ...(input.title ? { title: input.title } : {}),
        };
        return createRunnableDemo(demo, {
          authorType: "ai",
          changeSummary: `AI ${input.topic} minimal lesson`,
          summary: "可以直接点选、调节并保存修改前后的版本。",
          activity: `AI 已创建 ${demo.title}`,
          seedPrefix: "ai-demo",
        });
      },
      async applyCssChange(input) {
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!record) throw new Error(`运行块不存在：${input.blockId}`);
        const selector = requireVerifiedProjectSelector(
          record.project,
          input.selector,
        );
        const parent = currentRevision(record);
        const mutationDigest = input.requestId
          ? await hashTutorCssMutation(input)
          : null;
        const generated = await createExperimentRevision(
          record,
          { domPath: selector },
          [{ property: input.property, value: input.value }],
        );
        const revision: CodeRevision = Object.freeze({
          ...generated,
          authorType: "ai",
          changeSummary: `AI · ${generated.changeSummary}`,
          ...(input.requestId && mutationDigest
            ? {
                mutationId: input.requestId,
                mutationDigest,
              }
            : {}),
        });
        let committed = false;
        let duplicate = false;
        let branched = false;
        let savedRevisionId = revision.id;
        let competingRevisionId = parent.id;
        setRuntimeProjects((current) => {
          const latest = current.get(input.blockId);
          if (
            !latest ||
            !latest.revisions.some((candidate) => candidate.id === parent.id)
          ) {
            return current;
          }
          const appended = appendRevision(latest, revision);
          duplicate = appended.duplicate;
          branched = appended.branched;
          savedRevisionId = appended.revisionId;
          competingRevisionId = appended.competingRevisionId;
          committed = true;
          if (appended.duplicate) return current;
          const next = new Map(current);
          next.set(input.blockId, appended.record);
          return next;
        });
        if (!committed) {
          throw new Error("页面或父版本已经不在画布上，本次 AI 修改没有保存");
        }
        if (duplicate) {
          setActivity("AI 的这次变化已经保存过，没有重复建立版本");
          return savedRevisionId;
        }
        if (branched) {
          createComparison(
            input.blockId,
            competingRevisionId,
            savedRevisionId,
            { domPath: selector },
            { focus: false },
          );
        }
        setActivity(
          branched
            ? `AI 和你的同时修改都已保留为分支；现在打开 AI 的 ${input.property}: ${input.value}`
            : `AI 已保存 ${input.property}: ${input.value}`,
        );
        return savedRevisionId;
      },
      createController(input) {
        const blockId = createCssControllerBlock(
          input.blockId,
          input.property,
        );
        setActivity(`AI 已添加 ${input.property} 控制器`);
        return blockId;
      },
      createComparison(input) {
        const record = runtimeProjectsRef.current.get(input.blockId);
        if (!record) throw new Error(`运行块不存在：${input.blockId}`);
        const before = record.revisions.at(-2);
        const after = record.revisions.at(-1);
        if (!before || !after) {
          throw new Error("至少需要两个不可变代码版本才能创建对比。");
        }
        const comparisonId = createComparison(
          input.blockId,
          before.id,
          after.id,
          { domPath: inferDefaultSelector(record.project) },
        );
        if (!comparisonId) throw new Error("版本对比创建失败。");
        return comparisonId;
      },
      focusBlock(input) {
        if (!editor) throw new Error("教学画布尚未就绪。");
        const shape = getTeachingShapes(editor).find(
          (candidate) => candidate.props.blockId === input.blockId,
        );
        if (!shape) throw new Error(`画布实体不存在：${input.blockId}`);
        editor.select(shape.id);
        editor.zoomToSelection({ animation: { duration: 220 } });
        setActivity(`AI 已聚焦 ${input.blockId}`);
      },
    }),
    [
      comparisons,
      collectTutorStudentActions,
      createComparison,
      createCssControllerBlock,
      createRunnableDemo,
      editor,
      setRuntimeProjects,
    ],
  );

  useEffect(() => {
    tutorOperationsRef.current = tutorOperations;
  }, [tutorOperations]);

  useEffect(() => {
    if (tutorExecutorRef.current) return;
    const currentOperations = () => {
      if (!tutorOperationsRef.current) {
        throw new Error("教学画布操作器尚未就绪。");
      }
      return tutorOperationsRef.current;
    };
    tutorExecutorRef.current = createTutorToolExecutor({
      readCanvasState: () => currentOperations().readCanvasState(),
      inspectSelectedElement: (input) =>
        currentOperations().inspectSelectedElement(input),
      readRelevantSource: (input) =>
        currentOperations().readRelevantSource(input),
      readLastStudentAction: () =>
        currentOperations().readLastStudentAction(),
      readTeachingAssertionEvidence: (input) =>
        currentOperations().readTeachingAssertionEvidence(input),
      createMinimalVerification: (input) =>
        currentOperations().createMinimalVerification(input),
      createExplanation: (input) => currentOperations().createExplanation(input),
      createDemo: (input) => currentOperations().createDemo(input),
      applyCssChange: (input) => currentOperations().applyCssChange(input),
      createController: (input) => currentOperations().createController(input),
      createComparison: (input) => currentOperations().createComparison(input),
      focusBlock: (input) => currentOperations().focusBlock(input),
    });
  }, []);

  const handleTutorToolCall = useCallback(
    (tool: string, argumentsValue: unknown) => {
      const executor = tutorExecutorRef.current;
      return executor
        ? executor.execute(tool, argumentsValue)
        : Promise.resolve({
            success: false,
            message: "教学画布操作器尚未就绪。",
          });
    },
    [],
  );

  const startDemoMode = useCallback(
    async (topic: TutorTopic) => {
      const step = DEMO_MODE_STEPS[topic];
      const demoTitle = `演示模式 · ${LESSON_DEMOS[topic].title}`;
      const blockId = await tutorOperations.createDemo({
        topic,
        title: demoTitle,
      });
      await waitForCanvasCommit();
      await tutorOperations.applyCssChange({
        blockId,
        selector: "#demo",
        property: step.property,
        value: step.value,
      });
      await waitForCanvasCommit();
      await tutorOperations.createController({
        blockId,
        property: step.property,
      });
      await tutorOperations.createComparison({ blockId });
      await tutorOperations.createExplanation({
        title: step.explanationTitle,
        summary: step.explanation,
      });
      await tutorOperations.focusBlock({ blockId });
      await waitForCanvasMotion();
      try {
        await persistCurrentCanvasState();
        setActivity(`${demoTitle}已准备好；无需 AI 连接`);
      } catch {
        setActivity(
          `${demoTitle}已准备好；设备空间不足，刷新前请先保留这个页面`,
        );
      }
    },
    [persistCurrentCanvasState, tutorOperations],
  );

  const adaptiveTutorCue = useMemo<RealtimeTutorAdaptiveCue | null>(() => {
    if (
      !boxLesson.sessionId ||
      boxLesson.predictionCorrect !== false ||
      boxLesson.phase !== "observe"
    ) {
      return null;
    }
    const predictionEvidence = boxLesson.evidence.find(
      (item) => item.kind === "prediction",
    );
    if (!predictionEvidence) return null;
    const diagnosis = diagnoseMisconception(
      "box-model-v1",
      "box.width-includes-padding",
      [
        boxLesson.prediction === "same"
          ? "prediction.same"
          : "prediction.unsure",
      ],
    );
    return {
      id: predictionEvidence.id + ":" + diagnosis.ruleId,
      cue: "box-model-width-follow-up",
      question:
        BOX_MODEL_COURSE.misconceptions[0]?.correctionQuestion ??
        diagnosis.correctionQuestion,
    };
  }, [
    boxLesson.evidence,
    boxLesson.phase,
    boxLesson.prediction,
    boxLesson.predictionCorrect,
    boxLesson.sessionId,
  ]);

  const focusBoxLesson = useCallback(() => {
    if (!editor || !boxLesson.lessonBlockId) return;
    const lessonIds = new Set(
      [boxLesson.lessonBlockId, boxLesson.transferBlockId].filter(
        (value): value is string => Boolean(value),
      ),
    );
    const shapes = getTeachingShapes(editor).filter(
      (shape) =>
        lessonIds.has(shape.props.blockId) ||
        (typeof shape.props.sourceBlockId === "string" &&
          lessonIds.has(shape.props.sourceBlockId)),
    );
    if (shapes.length === 0) return;
    editor.select(...shapes.map((shape) => shape.id));
    editor.zoomToSelection({ animation: { duration: 220 } });
  }, [boxLesson.lessonBlockId, boxLesson.transferBlockId, editor]);

  const startBoxModelLesson = useCallback(async (
    personalizedOrigin?: PersonalizedLessonOrigin,
  ) => {
    if (!editor) return;
    editor.markHistoryStoppingPoint("开始盒模型小课");
    const demo = {
      ...LESSON_DEMOS["box-model"],
      title: "第一课 · 卡片为什么会变大？",
    };
    const lessonBlockId = await createRunnableDemo(demo, {
      authorType: "system",
      changeSummary: "盒模型第一课的起始页面",
      summary: "先预测，再把里面留白从 16px 调到 32px。",
      activity: "第一课已准备好，先做一个预测",
      seedPrefix: "box-lesson-demo",
      focus: false,
    });
    createCssControllerBlock(lessonBlockId, "padding", {
      seedPrefix: "box-lesson-controller",
    });
    startLearningProof(lessonBlockId, personalizedOrigin);
    const lessonShapes = getTeachingShapes(editor).filter(
      (shape) =>
        shape.props.blockId === lessonBlockId ||
        shape.props.sourceBlockId === lessonBlockId,
    );
    editor.select(...lessonShapes.map((shape) => shape.id));
    editor.zoomToSelection();
  }, [
    createCssControllerBlock,
    createRunnableDemo,
    editor,
    startLearningProof,
  ]);

  const predictBoxModel = useCallback(
    (answer: BoxModelPrediction) => {
      recordLearningPrediction(answer);
      setActivity("预测已记下；现在亲手把里面留白调到 32px");
      window.requestAnimationFrame(focusBoxLesson);
    },
    [focusBoxLesson, recordLearningPrediction],
  );

  const ensureBoxModelTransfer = useCallback(
    async (activity: string) => {
      const next = boxLessonRef.current;
      if (next.phase !== "transfer" || next.transferBlockId || !editor) return;
      const lessonShape = getTeachingShapes(editor).find(
        (shape) => shape.props.blockId === next.lessonBlockId,
      );
      const transferBlockId = await createRunnableDemo(
        BOX_MODEL_TRANSFER_DEMO,
        {
          authorType: "system",
          changeSummary: "盒模型非同构迁移题起始页面",
          summary: "结构不同的新页面；需要学生亲手写一条 CSS。",
          activity,
          seedPrefix: "box-lesson-transfer",
          ...(lessonShape
            ? { point: {
                x: lessonShape.x + lessonShape.props.w + 110,
                y: lessonShape.y,
              } }
            : {}),
        },
      );
      recordLearningTransferBlock(transferBlockId);
    },
    [
      boxLessonRef,
      createRunnableDemo,
      editor,
      recordLearningTransferBlock,
    ],
  );

  const explainBoxModel = useCallback(
    async (answer: BoxModelExplanation) => {
      const next = recordLearningExplanation(answer);
      if (next.phase === "transfer") {
        await ensureBoxModelTransfer("解释成立；请在新页面亲手写一条 CSS");
      }
    },
    [ensureBoxModelTransfer, recordLearningExplanation],
  );

  const supportBoxModelLesson = useCallback(
    async (
      action: LearningSupportAction,
      hintLevel: 1 | 2 | 3 | null = null,
    ) => {
      const previous = boxLessonRef.current;
      const next = recordLearningSupport(action, hintLevel);
      if (next === previous) return;
      if (next.phase === "transfer" && !next.transferBlockId) {
        await ensureBoxModelTransfer(
          "已按你的选择继续；请在新页面完成一次运行",
        );
      }
      setActivity(
        action === "hint"
          ? `第 ${hintLevel} 层提示已展开`
          : action === "timeout"
            ? "课程还停在当前步骤；可继续操作或选择帮助"
            : action === "teacher-takeover"
              ? "已标记需要老师接手；当前步骤没有自动推进"
              : action === "demonstration"
                ? "示范已展开；本轮将记为有支架完成"
                : "已跳过当前步骤；本轮将记为有支架完成",
      );
    },
    [
      boxLessonRef,
      ensureBoxModelTransfer,
      recordLearningSupport,
    ],
  );

  const submitBoxModelTransfer = useCallback(
    async (code: string) => {
      const state = boxLessonRef.current;
      if (!state.transferBlockId) return false;
      const evaluation = evaluateTransferDeclaration(code);
      if (evaluation.passed) {
        await saveExperiment(
          state.transferBlockId,
          { domPath: ".notice" },
          [{ property: "padding", value: evaluation.normalizedValue! }],
        );
      }
      recordLearningTransfer(code);
      setActivity(
        evaluation.passed
          ? state.independentCreditEligible
            ? "盒模型第一课已完成；你已经在新页面独立写出 CSS"
            : "盒模型路线已完成；这轮使用过帮助，不计独立达成"
          : evaluation.message,
      );
      return evaluation.passed;
    },
    [boxLessonRef, recordLearningTransfer, saveExperiment],
  );

  const focusScenarioLesson = useCallback(() => {
    if (!editor) return;
    const lessonIds = new Set(
      [
        ...scenarioLessonState.blocks.map((block) => block.blockId),
        scenarioLessonState.transferBlockId,
      ].filter((value): value is string => Boolean(value)),
    );
    const shapes = getTeachingShapes(editor).filter(
      (shape) =>
        lessonIds.has(shape.props.blockId) ||
        (typeof shape.props.sourceBlockId === "string" &&
          lessonIds.has(shape.props.sourceBlockId)),
    );
    if (shapes.length === 0) return;
    editor.select(...shapes.map((shape) => shape.id));
    editor.zoomToSelection({ animation: { duration: 220 } });
  }, [
    editor,
    scenarioLessonState.blocks,
    scenarioLessonState.transferBlockId,
  ]);

  const startScenarioLesson = useCallback(
    async (
      kind: ScenarioLessonKind,
      personalizedOrigin?: PersonalizedLessonOrigin,
    ) => {
      if (!editor) return;
      const center = editor.getViewportPageBounds().center;
      if (kind === "flex-v1") {
        const sourceBlockId = await createRunnableDemo(
          FLEX_NORMAL_FLOW_DEMO,
          {
            authorType: "system",
            changeSummary: "Flex 课的普通文档流原页面",
            summary: "这张原页面仍按普通文档流从上往下排列。",
            activity: "普通页面已载入，正在复制 Flex 实验分支",
            seedPrefix: "flex-lesson-source",
            point: { x: center.x - 900, y: center.y - 260 },
            focus: false,
          },
        );
        const experimentBlockId = await createRunnableDemo(
          { ...FLEX_NORMAL_FLOW_DEMO, title: "Flex 分支 · 同一页面" },
          {
            authorType: "system",
            changeSummary: "从普通页面复制出的 Flex 实验分支",
            summary: "只改分支，原页面和之前的版本都不会被覆盖。",
            activity: "Flex 分支已复制，正在建立前后对比",
            seedPrefix: "flex-lesson-experiment",
            point: { x: center.x - 350, y: center.y - 260 },
            focus: false,
          },
        );
        await tutorOperations.applyCssChange({
          blockId: experimentBlockId,
          selector: "#demo",
          property: "display",
          value: "flex",
        });
        createCssControllerBlock(experimentBlockId, "gap", {
          seedPrefix: "flex-lesson-gap",
          offsetIndex: 0,
          title: "项目之间留多大空隙",
        });
        createCssControllerBlock(experimentBlockId, "justify-content", {
          seedPrefix: "flex-lesson-main-axis",
          offsetIndex: 1,
          title: "主轴怎么排列",
        });
        createCssControllerBlock(experimentBlockId, "align-items", {
          seedPrefix: "flex-lesson-cross-axis",
          offsetIndex: 2,
          title: "交叉轴怎么对齐",
        });
        tutorOperations.createComparison({ blockId: experimentBlockId });
        startScenarioLearningProof(
          "flex-v1",
          [
            { role: "source", blockId: sourceBlockId },
            { role: "experiment", blockId: experimentBlockId },
          ],
          personalizedOrigin,
        );
        setActivity("Flex 小课已准备好：先判断 gap 会不会改变方块大小");
      } else {
        const placements = [
          { role: "static" as const, mode: "static" as const, x: center.x - 820 },
          {
            role: "relative" as const,
            mode: "relative" as const,
            x: center.x - 260,
          },
          {
            role: "absolute" as const,
            mode: "absolute" as const,
            x: center.x + 300,
          },
        ];
        const blocks = [];
        for (const [index, placement] of placements.entries()) {
          const blockId = await createRunnableDemo(
            positioningDemo(placement.mode),
            {
              authorType: "system",
              changeSummary: `定位课 ${placement.mode} 起始页面`,
              summary:
                placement.mode === "static"
                  ? "top 写上去也不会移动，因为它仍按普通规则排队。"
                  : placement.mode === "relative"
                    ? "移动后，原来的位置仍然为它保留。"
                    : "它离开普通队伍，并从包含块开始计算偏移。",
              activity: `正在准备 ${placement.mode} 实验`,
              seedPrefix: `position-lesson-${placement.mode}`,
              point: { x: placement.x, y: center.y - 260 },
              focus: false,
            },
          );
          createCssControllerBlock(blockId, "top", {
            seedPrefix: `position-lesson-${placement.mode}-top`,
            offsetIndex: index === 0 ? 0 : 0,
            title:
              placement.mode === "static"
                ? "static：写 top 看看"
                : placement.mode === "relative"
                  ? "relative：向下移动"
                  : "absolute：从包含块向下",
          });
          blocks.push({ role: placement.role, blockId });
        }
        tutorOperations.createExplanation({
          title: "虚线框就是这次的包含块",
          summary:
            "absolute 会离开普通文档流，并从最近的已定位祖先开始计算 top；relative 移动后仍保留原位置。",
        });
        startScenarioLearningProof(
          "positioning-v1",
          blocks,
          personalizedOrigin,
        );
        setActivity("定位小课已准备好：先判断谁会离开普通队伍");
      }
      await waitForCanvasCommit();
      window.requestAnimationFrame(() => {
        const state = scenarioLessonStateRef.current;
        const blockIds = new Set(state.blocks.map((block) => block.blockId));
        const shapes = getTeachingShapes(editor).filter(
          (shape) =>
            blockIds.has(shape.props.blockId) ||
            (typeof shape.props.sourceBlockId === "string" &&
              blockIds.has(shape.props.sourceBlockId)),
        );
        if (shapes.length > 0) {
          editor.select(...shapes.map((shape) => shape.id));
          editor.zoomToSelection({ animation: { duration: 220 } });
        }
      });
    },
    [
      createCssControllerBlock,
      createRunnableDemo,
      editor,
      scenarioLessonStateRef,
      startScenarioLearningProof,
      tutorOperations,
    ],
  );

  const predictScenarioLesson = useCallback(
    (answer: ScenarioPrediction) => {
      const next = recordScenarioPrediction(answer);
      setActivity(
        next.lessonKind === "flex-v1"
          ? "预测已记下；请完成 gap、主轴和交叉轴三个保存"
          : "预测已记下；请依次保存 static、relative、absolute 的 top",
      );
      window.requestAnimationFrame(focusScenarioLesson);
    },
    [focusScenarioLesson, recordScenarioPrediction],
  );

  const ensureScenarioTransfer = useCallback(
    async (activity: string) => {
      const next = scenarioLessonStateRef.current;
      if (
        next.phase !== "transfer" ||
        next.transferBlockId ||
        !next.lessonKind ||
        !editor
      ) {
        return;
      }
      const lastLessonShape = getTeachingShapes(editor)
        .filter((shape) =>
          next.blocks.some((block) => block.blockId === shape.props.blockId),
        )
        .at(-1);
      const demo =
        next.lessonKind === "flex-v1"
          ? FLEX_TRANSFER_DEMO
          : POSITION_TRANSFER_DEMO;
      const transferBlockId = await createRunnableDemo(demo, {
        authorType: "system",
        changeSummary:
          next.lessonKind === "flex-v1"
            ? "Flex 非同构迁移题起始页面"
            : "定位非同构迁移题起始页面",
        summary: "结构不同的新页面，需要亲手写出完整 CSS。",
        activity,
        seedPrefix:
          next.lessonKind === "flex-v1"
            ? "flex-lesson-transfer"
            : "position-lesson-transfer",
        ...(lastLessonShape
          ? {
              point: {
                x: lastLessonShape.x + lastLessonShape.props.w + 110,
                y: lastLessonShape.y,
              },
            }
          : {}),
      });
      recordScenarioTransferBlock(transferBlockId);
    },
    [
      createRunnableDemo,
      editor,
      recordScenarioTransferBlock,
      scenarioLessonStateRef,
    ],
  );

  const explainScenarioLesson = useCallback(
    async (answer: ScenarioExplanation) => {
      const next = recordScenarioExplanation(answer);
      if (next.phase === "transfer") {
        await ensureScenarioTransfer("解释成立；请在新页面独立完成挑战");
      }
    },
    [ensureScenarioTransfer, recordScenarioExplanation],
  );

  const supportScenarioLesson = useCallback(
    async (
      action: LearningSupportAction,
      hintLevel: 1 | 2 | 3 | null = null,
    ) => {
      const previous = scenarioLessonStateRef.current;
      const next = recordScenarioSupport(action, hintLevel);
      if (next === previous) return;
      if (next.phase === "transfer" && !next.transferBlockId) {
        await ensureScenarioTransfer(
          "已按你的选择继续；请在新页面完成一次运行",
        );
      }
      setActivity(
        action === "hint"
          ? `第 ${hintLevel} 层提示已展开`
          : action === "timeout"
            ? "课程还停在当前步骤；可继续操作或选择帮助"
            : action === "teacher-takeover"
              ? "已标记需要老师接手；当前步骤没有自动推进"
              : action === "demonstration"
                ? "示范已展开；本轮将记为有支架完成"
                : "已跳过当前步骤；本轮将记为有支架完成",
      );
    },
    [
      ensureScenarioTransfer,
      recordScenarioSupport,
      scenarioLessonStateRef,
    ],
  );

  const submitScenarioLessonTransfer = useCallback(
    async (code: string) => {
      const state = scenarioLessonStateRef.current;
      if (!state.lessonKind || !state.transferBlockId) return false;
      const changes = scenarioTransferChanges(state.lessonKind, code);
      const passed = changes !== null;
      if (changes) {
        await saveExperiment(
          state.transferBlockId,
          {
            domPath: state.lessonKind === "flex-v1" ? ".toolbar" : ".badge",
          },
          changes,
        );
      }
      recordScenarioTransfer(code);
      setActivity(
        passed
          ? state.independentCreditEligible
            ? "这节课已完成；新页面的 CSS 和全部学习步骤都已保存"
            : "这节课已在帮助下完成；本轮不计独立达成"
          : "这组 CSS 还没有满足目标，请根据提示补全后再试",
      );
      return passed;
    },
    [recordScenarioTransfer, saveExperiment, scenarioLessonStateRef],
  );

  const handleInspectionBridgeReady = useCallback(
    (bridge: RuntimeInspectionBridge | null) => {
      inspectionBridgeRef.current = bridge;
    },
    [],
  );

  const handleInspectionChange = useCallback(
    (blockId: string, snapshot: RuntimeInspectionSnapshot | null) => {
      if (snapshot) {
        inspectionSnapshotsRef.current.set(blockId, snapshot);
      } else {
        inspectionSnapshotsRef.current.delete(blockId);
      }
    },
    [],
  );

  const generatePersonalizedCourse = useCallback(
    async (blockId: string) => {
      if (personalizedCourseInFlightRef.current || !editor) return;
      personalizedCourseInFlightRef.current = true;
      setPersonalizedCourseBusyBlockId(blockId);
      setPersonalizedCourseError(null);
      let createdControllerBlockId: string | null = null;
      try {
        const record = runtimeProjectsRef.current.get(blockId);
        if (!record) throw new Error("这个页面已经不在画布上了。");
        const baseRevision = currentRevision(record);
        const candidates = extractPersonalizedCourseCandidates(baseRevision);
        if (candidates.length === 0) {
          throw new Error(
            "这个页面还没有找到同时带有稳定选择器和相关声明的规则。可以先在 CSS 里为目标加一个 id 或 class。",
          );
        }
        const bridge = inspectionBridgeRef.current;
        if (!bridge?.isReady(blockId)) {
          throw new Error("页面运行区还在准备，请稍后再点一次。");
        }

        let plan: PersonalizedCoursePlan | null = null;
        for (const candidate of candidates) {
          try {
            const snapshot = await bridge.inspect(blockId, candidate.selector);
            if (snapshot.revisionId !== baseRevision.id) break;
            plan = buildPersonalizedCoursePlan({
              blockId,
              revisionId: baseRevision.id,
              contentHash: baseRevision.contentHash,
              candidate,
              result: snapshot.result,
            });
            if (plan) break;
          } catch {
            // A source selector can be absent or hidden at this viewport. Try
            // the next source candidate; no claim is created from a failure.
          }
        }
        if (!plan) {
          throw new Error(
            "浏览器没有找到足够的页面测量和源码行来支持一节小课，所以这次没有猜结论。",
          );
        }

        const existingController = getTeachingShapes(editor).find(
          (shape) =>
            shape.props.kind === "css-controller" &&
            shape.props.sourceBlockId === blockId &&
            shape.props.cssSelector === plan!.selector &&
            shape.props.cssProperty === plan!.experiment.property,
        );
        if (!existingController) {
          createdControllerBlockId = createCssControllerBlock(
            blockId,
            plan.experiment.property,
            {
              seedPrefix: "personal-course-controller",
              selector: plan.selector,
              title: `我的页面实验 · ${plan.experiment.property}`,
            },
          );
        }

        let committed = false;
        setRuntimeProjects((current) => {
          const latest = current.get(blockId);
          if (!latest || latest.currentRevisionId !== baseRevision.id) {
            return current;
          }
          committed = true;
          const next = new Map(current);
          next.set(blockId, Object.freeze({ ...latest, personalizedCourse: plan! }));
          return next;
        });
        if (!committed) {
          if (createdControllerBlockId) {
            const controllerShape = getTeachingShapes(editor).find(
              (shape) => shape.props.blockId === createdControllerBlockId,
            );
            if (controllerShape) editor.deleteShape(controllerShape.id);
          }
          throw new Error("页面刚刚产生了新版本，请重新生成这节小课。");
        }
        setActivity("已用页面里的源码行和浏览器测量生成一节小课");
      } catch (error) {
        setPersonalizedCourseError(
          error instanceof Error
            ? error.message
            : "这次没有找到足够事实来生成小课。",
        );
      } finally {
        personalizedCourseInFlightRef.current = false;
        setPersonalizedCourseBusyBlockId(null);
      }
    },
    [createCssControllerBlock, editor, setRuntimeProjects],
  );

  const answerPersonalizedCourse = useCallback(
    (
      blockId: string,
      planId: string,
      kind: "prediction" | "explanation",
      answer: string,
    ) => {
      setPersonalizedCourseError(null);
      setRuntimeProjects((current) => {
        const record = current.get(blockId);
        const plan = record?.personalizedCourse;
        if (!record || !plan || plan.id !== planId) return current;
        const updated = recordPersonalizedCourseAnswer(plan, kind, answer);
        if (updated === plan) return current;
        const next = new Map(current);
        next.set(blockId, Object.freeze({ ...record, personalizedCourse: updated }));
        return next;
      });
      setActivity(
        kind === "prediction"
          ? "预测已保留；现在去页面旁做一次最小实验"
          : "解释已记录，并与源码和测量证据核对",
      );
    },
    [setRuntimeProjects],
  );

  const verifyPersonalizedCourse = useCallback(
    async (blockId: string, planId: string) => {
      if (personalizedCourseInFlightRef.current) return;
      personalizedCourseInFlightRef.current = true;
      setPersonalizedCourseBusyBlockId(blockId);
      setPersonalizedCourseError(null);
      try {
        const record = runtimeProjectsRef.current.get(blockId);
        const plan = record?.personalizedCourse;
        if (!record || !plan || plan.id !== planId) {
          throw new Error("这节小课已经更新，请重新打开。");
        }
        if (
          !revisionDescendsFrom(
            record.revisions,
            record.currentRevisionId,
            plan.baseRevisionId,
          ) ||
          record.currentRevisionId === plan.baseRevisionId ||
          !personalizedCourseSourceUnchanged(
            plan,
            record.revisions,
            record.currentRevisionId,
          )
        ) {
          throw new Error(
            `先把 ${plan.experiment.property} 调到 ${plan.experiment.trialValue} 并松手保存，再来核对。`,
          );
        }
        const bridge = inspectionBridgeRef.current;
        if (!bridge?.isReady(blockId)) {
          throw new Error("页面运行区还在准备，请稍后再核对。");
        }
        const snapshot = await bridge.inspect(blockId, plan.selector);
        const verification = verifyPersonalizedCourseExperiment(plan, snapshot);
        if (!verification) {
          throw new Error(
            `浏览器还没有读到已保存的 ${plan.experiment.property}: ${plan.experiment.trialValue}，请检查调节卡后再试。`,
          );
        }
        let committed = false;
        setRuntimeProjects((current) => {
          const latest = current.get(blockId);
          const latestPlan = latest?.personalizedCourse;
          if (
            !latest ||
            !latestPlan ||
            latestPlan.id !== planId ||
            latest.currentRevisionId !== snapshot.revisionId
          ) {
            return current;
          }
          committed = true;
          const next = new Map(current);
          next.set(
            blockId,
            Object.freeze({
              ...latest,
              personalizedCourse: attachPersonalizedCourseVerification(
                latestPlan,
                verification,
              ),
            }),
          );
          return next;
        });
        if (!committed) {
          throw new Error("核对时页面又有了新版本，请再核对一次。");
        }
        setActivity("浏览器已重新测量这次保存；现在解释为什么");
      } catch (error) {
        setPersonalizedCourseError(
          error instanceof Error ? error.message : "暂时无法核对页面变化。",
        );
      } finally {
        personalizedCourseInFlightRef.current = false;
        setPersonalizedCourseBusyBlockId(null);
      }
    },
    [setRuntimeProjects],
  );

  const focusPersonalizedExperiment = useCallback(
    (blockId: string, plan: PersonalizedCoursePlan) => {
      if (!editor) return;
      const shapes = getTeachingShapes(editor).filter(
        (shape) =>
          shape.props.blockId === blockId ||
          (shape.props.kind === "css-controller" &&
            shape.props.sourceBlockId === blockId &&
            shape.props.cssSelector === plan.selector &&
            shape.props.cssProperty === plan.experiment.property),
      );
      if (shapes.length === 0) return;
      editor.select(...shapes.map((shape) => shape.id));
      editor.zoomToSelection({ animation: { duration: 220 } });
      setActivity("已找到你的页面和这次实验的调节卡");
    },
    [editor],
  );

  const continuePersonalizedCourse = useCallback(
    async (plan: PersonalizedCoursePlan) => {
      const record = runtimeProjectsRef.current.get(plan.blockId);
      const origin = personalizedOriginFromPlan(plan);
      if (
        !record ||
        !origin ||
        !personalizedCourseSourceUnchanged(
          plan,
          record.revisions,
          record.currentRevisionId,
        )
      ) {
        setPersonalizedCourseError(
          "页面或学习步骤已经变化，请重新核对这节小课后再继续。",
        );
        return;
      }
      setLessonPanelsVisible(true);
      if (plan.courseId === "box-model-v1") {
        await startBoxModelLesson(origin);
      } else {
        await startScenarioLesson(plan.courseId, origin);
      }
      setActivity("完整小课已开始；完成后会从冻结题库发出新页面挑战");
    },
    [startBoxModelLesson, startScenarioLesson],
  );

  const runtimeActions = useMemo(
    () => ({
      saveExperiment,
      saveSourceRevision,
      switchRevision,
      forkProject,
      createComparison,
      updateComparison,
    }),
    [
      createComparison,
      forkProject,
      saveExperiment,
      saveSourceRevision,
      switchRevision,
      updateComparison,
    ],
  );

  const addBlock = async (kind: TeachingBlockType) => {
    if (!editor) return;

    if (kind === "runnable") {
      editor.markHistoryStoppingPoint("添加可运行实验");
      await createRunnableDemo(
        {
          ...LESSON_DEMOS["box-model"],
          title: "练习页面 · 调一调留白",
        },
        {
          authorType: "user",
          changeSummary: "从自由画布创建可运行练习页面",
          summary: "这是可直接选择、调整和保存版本的练习页面。",
          activity: "练习页面已准备好；可以选择内容或添加调节卡",
          seedPrefix: "free-canvas-demo",
        },
      );
      return;
    }

    const selectedIds = new Set(editor.getSelectedShapeIds());
    const runnableShape = getTeachingShapes(editor)
      .filter(
        (shape) =>
          shape.props.kind === "runnable" &&
          runtimeProjectsRef.current.has(shape.props.blockId),
      )
      .sort((left, right) =>
        selectedIds.has(left.id) === selectedIds.has(right.id)
          ? 0
          : selectedIds.has(left.id)
            ? -1
            : 1,
      )
      .at(0);

    if (kind === "css-controller") {
      if (!runnableShape) {
        setActivity("先添加或载入一个实验页面，再给它添加调节卡");
        return;
      }
      editor.markHistoryStoppingPoint("添加页面调节卡");
      const blockId = createCssControllerBlock(
        runnableShape.props.blockId,
        "padding",
        { seedPrefix: "free-canvas-controller" },
      );
      const controller = getTeachingShapes(editor).find(
        (shape) => shape.props.blockId === blockId,
      );
      if (controller) {
        editor.select(controller.id);
        editor.zoomToSelection({ animation: { duration: 180 } });
      }
      setActivity("调节卡已连接到实验页面；拖动后松手即可保存");
      return;
    }

    if (kind === "comparison") {
      if (!runnableShape) {
        setActivity("先添加或载入一个实验页面，再保存一次变化后进行对比");
        return;
      }
      const existingComparison = [...comparisonsRef.current.values()]
        .reverse()
        .find(
          (comparison) =>
            comparison.sourceBlockId === runnableShape.props.blockId,
        );
      if (existingComparison) {
        const comparisonShape = getTeachingShapes(editor).find(
          (shape) => shape.props.blockId === existingComparison.blockId,
        );
        if (comparisonShape) {
          editor.select(comparisonShape.id);
          editor.zoomToSelection({ animation: { duration: 180 } });
        }
        setActivity("已找到这个实验的修改前后对比");
        return;
      }
      const record = runtimeProjectsRef.current.get(runnableShape.props.blockId);
      if (!record || record.revisions.length < 2) {
        editor.select(runnableShape.id);
        editor.zoomToSelection({ animation: { duration: 180 } });
        setActivity("先在这个实验里保存一次变化，再查看修改前后");
        return;
      }
      editor.markHistoryStoppingPoint("添加修改前后对比");
      createComparison(
        runnableShape.props.blockId,
        record.revisions[0]!.id,
        record.currentRevisionId,
      );
      return;
    }

    if (kind === "group") {
      const selection = editor.getSelectedShapeIds();
      if (selection.length < 2) {
        setActivity("请先按 Shift 多选至少两张卡片，再整理成组");
        return;
      }
      editor.markHistoryStoppingPoint("整理画布卡片");
      editor.groupShapes(selection);
      setActivity(`已把 ${selection.length} 张卡片整理成组`);
      return;
    }

    const definition = TEACHING_BLOCK_DEFINITIONS[kind];
    const center = editor.getViewportPageBounds().center;
    const offset = getTeachingShapes(editor).length % 5;
    const shape = makeTeachingBlockShape(kind, {
      x: center.x - definition.width / 2 + offset * 24,
      y: center.y - definition.height / 2 + offset * 20,
    });

    editor.markHistoryStoppingPoint(`添加${definition.label}`);
    editor.createShape(shape);
    if (shape.id) {
      editor.select(shape.id);
      editor.zoomToSelection({ animation: { duration: 180 } });
    }
    setActivity(`已添加：${definition.label}`);
  };

  const groupSelection = () => {
    if (!editor) return;
    const selectedIds = editor.getSelectedShapeIds();

    if (selectedIds.length < 2) {
      setActivity("请先按 Shift 多选至少两个块");
      return;
    }

    editor.markHistoryStoppingPoint("整理画布卡片");
    editor.groupShapes(selectedIds);
    setActivity(`已分组 ${selectedIds.length} 个对象`);
  };

  const startConnector = () => {
    if (!editor) return;
    editor.setCurrentTool("arrow");
    setActivity("连线工具已启用：从一个块拖向另一个块");
  };

  const focusSelection = () => {
    if (!editor) return;

    if (editor.getSelectedShapeIds().length > 0) {
      editor.zoomToSelection({ animation: { duration: 220 } });
      setActivity("已聚焦当前选择");
      return;
    }

    editor.zoomToFit({ animation: { duration: 220 } });
    setActivity("已显示全部画布内容");
  };

  const clearCanvas = () => {
    if (!editor) return;

    const shapeIds = editor.getCurrentPageShapes().map((shape) => shape.id);
    if (shapeIds.length === 0) {
      setActivity("画布已经是空白的");
      return;
    }

    if (!isClearCanvasArmed) {
      setIsClearCanvasArmed(true);
      setActivity("再点一次“确认清空”，画布内容就会被清除");
      return;
    }

    editor.markHistoryStoppingPoint("清空画布");
    editor.deleteShapes(shapeIds);
    setIsClearCanvasArmed(false);
    setActivity("画布已清空；需要时可点撤销恢复全部内容");
  };

  const downloadWorkspaceRescue = () => {
    if (!workspaceRescue) return;
    const blob = new Blob([workspaceRescue.raw], {
      type: "application/json;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ai-tutor-workspace-rescue-${new Date()
      .toISOString()
      .replace(/[:.]/g, "-")}.json`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setActivity("救援包已下载；确认文件保存后，可以开始新的本地记录");
  };

  const startNewWorkspaceAfterRescue = async () => {
    if (!editor || !workspaceRescue) return;
    try {
      await clearWorkspaceState();
      window.localStorage.removeItem(DURABLE_CANVAS_SNAPSHOT_KEY);
      window.localStorage.removeItem(SEMANTIC_PERSISTENCE_KEY);
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      setRuntimeProjects(new Map());
      setComparisons(new Map());
      deletedRuntimeProjectsRef.current.clear();
      deletedComparisonsRef.current.clear();
      persistenceWriteBlockedRef.current = false;
      externalCanvasUpdateRef.current = false;
      setWorkspaceRescue(null);
      setActivity("新的本地记录已开始；之前下载的救援包不会被修改");
      await persistCurrentCanvasState();
    } catch (error) {
      setActivity(
        error instanceof Error
          ? `无法开始新记录：${error.message}`
          : "无法开始新的本地记录",
      );
    }
  };

  const undoCanvas = () => {
    if (!editor || !editor.getCanUndo()) return;
    editor.undo();
    setActivity("已撤销上一步；可以继续尝试");
  };

  const redoCanvas = () => {
    if (!editor || !editor.getCanRedo()) return;
    editor.redo();
    setActivity("已恢复刚才撤销的内容");
  };

  const deleteSelection = () => {
    if (!editor) return;
    const selected = editor.getSelectedShapeIds();
    if (selected.length === 0) {
      setActivity("先选中一张卡片，再删除");
      return;
    }
    editor.markHistoryStoppingPoint("删除所选卡片");
    editor.deleteShapes(selected);
    setActivity(`已删除 ${selected.length} 张卡片；需要时可点撤销`);
  };

  const latestImportedEntry = [...runtimeProjects.entries()]
    .reverse()
    .find(([, record]) => record.sourceKind === "user-import");
  const latestImportedBlockId = latestImportedEntry?.[0] ?? null;
  const latestImportedRecord = latestImportedEntry?.[1] ?? null;
  const latestPersonalizedPlan = latestImportedRecord?.personalizedCourse;
  const personalizedCourseNeedsRefresh = Boolean(
    latestImportedRecord &&
      latestPersonalizedPlan &&
      (!revisionDescendsFrom(
        latestImportedRecord.revisions,
        latestImportedRecord.currentRevisionId,
        latestPersonalizedPlan.baseRevisionId,
      ) ||
        !personalizedCourseSourceUnchanged(
          latestPersonalizedPlan,
          latestImportedRecord.revisions,
          latestImportedRecord.currentRevisionId,
        )),
  );
  const currentTaskSummary =
    scenarioLessonState.phase !== "idle" &&
    scenarioLessonState.phase !== "complete"
      ? scenarioLessonState.phase === "predict"
        ? "现在先做预测；选一个判断后去画布验证"
        : scenarioLessonState.phase === "observe"
          ? `现在保存目标变化；完成 ${scenarioObservationProgress(scenarioLessonState).completed}/${scenarioObservationProgress(scenarioLessonState).total} 后解释原因`
          : scenarioLessonState.phase === "explain"
            ? "现在说清原因；解释成立后进入新页面挑战"
            : "现在完成新页面挑战；运行结果正确才算课内达成"
      : boxLesson.phase === "idle"
        ? "现在开始第一课；一次点击进入预测"
        : boxLesson.phase === "predict"
          ? "现在先做预测；提交后亲手调整页面"
          : boxLesson.phase === "observe"
            ? "现在把 padding 保存为 32px；完成后解释原因"
            : boxLesson.phase === "explain"
              ? "现在说清为什么变宽；解释成立后进入新页面"
              : boxLesson.phase === "transfer"
                ? "现在亲手写 CSS；运行正确后形成课内达成记录"
              : "第一课已完成；可继续 Flex、定位或回看记录";
  const currentLessonPhase =
    scenarioLessonState.phase !== "idle"
      ? scenarioLessonState.phase
      : boxLesson.phase;
  const studentTaskStage: StudentTaskStage =
    currentLessonPhase === "observe" || currentLessonPhase === "explain"
      ? "fix"
      : currentLessonPhase === "transfer" || currentLessonPhase === "complete"
        ? "continue"
        : "learn";
  const studentTaskStageIndex = STUDENT_TASK_STAGES.findIndex(
    (stage) => stage.id === studentTaskStage,
  );
  const openCurrentLesson = () => {
    setLessonPanelsVisible(true);
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => {
        const showScenario =
          scenarioLessonState.phase !== "idle" || boxLesson.phase === "complete";
        document
          .querySelector<HTMLElement>(
            showScenario
              ? '[aria-label="Flex 与定位小课"]'
              : '[aria-label="一分钟盒模型课"]',
          )
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }),
    );
  };

  return (
    <main className="canvas-app">
      <EnglishDemoPresentation />
      <header className="canvas-app__header">
        <div className="canvas-brand">
          <span aria-hidden="true">CSS</span>
          <div>
            <strong>CSS 学习画布</strong>
            <small>边看边试，马上理解</small>
          </div>
        </div>
        <div className="canvas-status" aria-live="polite">
          <span className="canvas-status__dot" />
          <div>
            <strong>当前任务</strong>
            <small>{currentTaskSummary}</small>
            <span className="canvas-status__activity">{activity}</span>
          </div>
        </div>
        <div className="canvas-metrics">
          <span>
            <strong>{metrics.blockCount}</strong>
            个内容
          </span>
          <span>
            <strong>{runtimeProjects.size}</strong>
            个实验
          </span>
        </div>
      </header>

      <div className="canvas-app__body">
        <aside className="block-library" aria-label="教学块库">
          <div className="block-library__intro">
            <span>今天的第一步</span>
            <h1>先完成一节小课</h1>
            <p>不用准备文件，也可以直接从盒模型开始。</p>
            <nav className="student-primary-entry" aria-label="开始学习">
              <button
                type="button"
                disabled={!editor || !learningProofReady}
                onClick={() => {
                  if (boxLesson.phase === "idle") void startBoxModelLesson();
                  else openCurrentLesson();
                }}
              >
                学一个概念
              </button>
              <button
                type="button"
                disabled={!editor || isImporting}
                onClick={() =>
                  document
                    .querySelector<HTMLInputElement>(
                      'input[aria-label="上传静态 HTML 和 CSS 文件"]',
                    )
                    ?.click()
                }
              >
                修一个页面
              </button>
              <button
                type="button"
                disabled={!activeLearningProofSessionId}
                onClick={openCurrentLesson}
              >
                继续上次学习
              </button>
            </nav>
          </div>

          {lessonPanelsVisible ? (
            <>
              <LearningProofHistory
                sessions={learningProofSessionHistory}
                activeSessionId={activeLearningProofSessionId}
                onOpen={openLearningProofSession}
                onDelete={deleteLearningProofSession}
              />

              <LiveBoxModelLessonPanel
            key={boxLesson.sessionId ?? "box-lesson-idle"}
            state={boxLesson}
            previewStore={runtimePreviewStore}
            ready={Boolean(editor) && learningProofReady}
            onStart={startBoxModelLesson}
            onRestart={startBoxModelLesson}
            onPredict={predictBoxModel}
            onExplain={explainBoxModel}
            onSupport={supportBoxModelLesson}
            onSubmitTransfer={submitBoxModelTransfer}
            onFocusLesson={focusBoxLesson}
            events={boxLessonEvents}
            timelineEvents={learningTimelineEvents}
            authoritativeSnapshot={
              learningProofAuthoritativeSnapshot &&
              !("lessonKind" in learningProofAuthoritativeSnapshot.lessonState)
                ? {
                    throughSequence:
                      learningProofAuthoritativeSnapshot.throughSequence,
                    lessonState: learningProofAuthoritativeSnapshot.lessonState,
                  }
                : null
            }
            syncStatus={learningProofSyncStatus}
            onRetrySync={retryLearningProofSync}
            onDownload={downloadLearningProof}
            hiddenTransferOutcome={hiddenTransferOutcome}
              />

              <ScenarioLessonPanel
            key={scenarioLessonState.sessionId ?? "scenario-lesson-idle"}
            state={scenarioLessonState}
            ready={Boolean(editor) && learningProofReady}
            onStart={startScenarioLesson}
            onPredict={predictScenarioLesson}
            onExplain={explainScenarioLesson}
            onSupport={supportScenarioLesson}
            onSubmitTransfer={submitScenarioLessonTransfer}
            onFocusLesson={focusScenarioLesson}
            events={scenarioEvents}
            timelineEvents={learningTimelineEvents}
            authoritativeSnapshot={
              learningProofAuthoritativeSnapshot &&
              "lessonKind" in learningProofAuthoritativeSnapshot.lessonState
                ? {
                    throughSequence:
                      learningProofAuthoritativeSnapshot.throughSequence,
                    lessonState: learningProofAuthoritativeSnapshot.lessonState,
                  }
                : null
            }
            syncStatus={learningProofSyncStatus}
            onRetrySync={retryLearningProofSync}
            onDownload={downloadLearningProof}
            hiddenTransferOutcome={hiddenTransferOutcome}
              />
              <TransferAssessmentPanel
                sessionId={activeLearningProofSessionId}
                lessonComplete={Boolean(
                  activeLearningProofSessionId &&
                    ((boxLesson.sessionId === activeLearningProofSessionId &&
                      boxLesson.phase === "complete") ||
                      (scenarioLessonState.sessionId ===
                        activeLearningProofSessionId &&
                        scenarioLessonState.phase === "complete")),
                )}
                onlineReady={learningProofSyncStatus === "synced"}
                onHiddenOutcome={handleHiddenTransferOutcome}
              />
              <LearningEvidencePanel
                key={`learning-evidence:${activeLearningProofSessionId ?? "none"}`}
                sessionId={activeLearningProofSessionId}
                onlineReady={learningProofSyncStatus === "synced"}
              />
            </>
          ) : (
            <div className="lesson-resume-card">
              <strong>小课已暂时收起</strong>
              <p>学习记录和画布都还在，可以随时继续。</p>
              <button type="button" onClick={() => setLessonPanelsVisible(true)}>
                继续小课
              </button>
            </div>
          )}

          {workspaceRescue ? (
            <section
              className="workspace-rescue"
              role="alert"
              aria-label="设备记录需要抢救"
            >
              <strong>设备上的记录需要先抢救</strong>
              <p>
                原始内容没有被空白记录覆盖。先下载救援包，再决定是否开始新的本地记录。
              </p>
              <div>
                <button type="button" onClick={downloadWorkspaceRescue}>
                  下载原始救援包
                </button>
                <button
                  type="button"
                  onClick={() => void startNewWorkspaceAfterRescue()}
                >
                  我已保存救援包，开始新记录
                </button>
              </div>
            </section>
          ) : null}

          <label
            className={
              isImporting
                ? "static-import static-import--busy"
                : "static-import"
            }
          >
            <span>我的页面</span>
            <strong>{isImporting ? "正在载入…" : "载入我的页面"}</strong>
            <small>选择 HTML 和 CSS 文件</small>
            <input
              aria-label="上传静态 HTML 和 CSS 文件"
              type="file"
              multiple
              disabled={!editor || isImporting}
              accept=".html,.htm,.css,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp,.ico,.svg,.woff,.woff2,.ttf,.otf"
              onChange={(event) => {
                const selectedFiles = Array.from(
                  event.currentTarget.files ?? [],
                );
                event.currentTarget.value = "";
                void importStaticFiles(selectedFiles);
              }}
            />
          </label>

          <PersonalizedCoursePanel
            blockId={latestImportedBlockId}
            record={latestImportedRecord}
            busy={personalizedCourseBusyBlockId === latestImportedBlockId}
            error={personalizedCourseError}
            needsRefresh={personalizedCourseNeedsRefresh}
            onGenerate={generatePersonalizedCourse}
            onAnswer={answerPersonalizedCourse}
            onVerify={verifyPersonalizedCourse}
            onFocusExperiment={focusPersonalizedExperiment}
            onContinueCourse={continuePersonalizedCourse}
          />

          <RealtimeTutorPanel
            onToolCall={handleTutorToolCall}
            adaptiveCue={adaptiveTutorCue}
            learningSessionId={activeLearningProofSessionId}
            onLearningAudit={recordTutorLearningAudit}
            demoReady={Boolean(editor)}
            onStartDemo={startDemoMode}
          />

          <details className="block-library__advanced">
            <summary>自由画布工具</summary>
            <p>想自己搭建内容时，再从这里添加卡片。</p>
            <div className="block-library__list">
              {TEACHING_BLOCK_TYPES.map((kind) => {
                const definition = TEACHING_BLOCK_DEFINITIONS[kind];
                return (
                  <button
                    key={kind}
                    type="button"
                    disabled={!editor}
                  onClick={() => void addBlock(kind)}
                  >
                    <span>{definition.shortLabel}</span>
                    <div>
                      <strong>{definition.label}</strong>
                      <small>{definition.summary}</small>
                    </div>
                    <b aria-hidden="true">＋</b>
                  </button>
                );
              })}
            </div>
          </details>

        </aside>

        <section className="canvas-stage" aria-label="无限教学画布">
          <section
            className="student-task-shell"
            aria-label="学习任务路线"
            data-task-stage={studentTaskStage}
            data-task-collapsed={!taskRouteExpanded}
          >
            <div className="student-task-shell__summary">
              <span>现在做什么</span>
              <strong>{currentTaskSummary}</strong>
              <small aria-live="polite">{activity}</small>
              <button
                type="button"
                aria-expanded={taskRouteExpanded}
                aria-label={taskRouteExpanded ? "收起学习任务路线" : "展开学习任务路线"}
                onClick={() => setTaskRouteExpanded((current) => !current)}
              >
                {taskRouteExpanded ? "收起" : "展开"}
              </button>
            </div>
            {taskRouteExpanded ? <ol>
              {STUDENT_TASK_STAGES.map((stage, index) => (
                <li
                  key={stage.id}
                  data-task-state={
                    index < studentTaskStageIndex
                      ? "complete"
                      : index === studentTaskStageIndex
                        ? "current"
                        : "upcoming"
                  }
                >
                  <b>{index + 1}</b>
                  <span>
                    <strong>{stage.label}</strong>
                    <small>{stage.detail}</small>
                  </span>
                </li>
              ))}
            </ol> : null}
            {taskRouteExpanded ? <button type="button" onClick={openCurrentLesson}>
              打开当前小课
            </button> : null}
          </section>
          <nav className="canvas-actionbar" aria-label="画布快捷操作">
            <button
              type="button"
              disabled={!editor || !editor.getCanUndo()}
              onClick={undoCanvas}
            >
              撤销
            </button>
            <button
              type="button"
              disabled={!editor || !editor.getCanRedo()}
              onClick={redoCanvas}
            >
              重做
            </button>
            <button type="button" disabled={!editor} onClick={deleteSelection}>
              删除所选
            </button>
            <button
              type="button"
              onClick={() => setLessonPanelsVisible((current) => !current)}
            >
              {lessonPanelsVisible ? "暂时收起小课" : "继续小课"}
            </button>
            <button type="button" disabled={!editor} onClick={groupSelection}>
              整理成组
            </button>
            <button type="button" disabled={!editor} onClick={startConnector}>
              连接内容
            </button>
            <button type="button" disabled={!editor} onClick={focusSelection}>
              回到内容
            </button>
            <button
              type="button"
              disabled={!editor}
              onClick={clearCanvas}
              onBlur={() => setIsClearCanvasArmed(false)}
            >
              {isClearCanvasArmed ? "确认清空" : "清空"}
            </button>
          </nav>
          <div
            className={
              isImporting
                ? "canvas-stage__editor canvas-stage__editor--drop"
                : "canvas-stage__editor"
            }
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }}
            onDrop={(event) => {
              event.preventDefault();
              void importStaticFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <RuntimeCanvasProvider
              projects={runtimeProjects}
              comparisons={comparisons}
              nearViewportBlockIds={metrics.nearViewportBlockIds}
              actions={runtimeActions}
              previewStore={runtimePreviewStore}
              onInspectionChange={handleInspectionChange}
              onInspectionBridgeReady={handleInspectionBridgeReady}
            >
              <TldrawCanvasSurface
                persistenceKey={CANVAS_PERSISTENCE_KEY}
                onMount={handleMount}
              />
            </RuntimeCanvasProvider>
          </div>
        </section>
      </div>
    </main>
  );
}
