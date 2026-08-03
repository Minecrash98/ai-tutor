import type { ElementTarget, NormalizedProject } from "@ai-tutor/runtime-core";
import { EXPERIMENT_STYLES_FILE } from "@ai-tutor/runtime-static-html";
import type {
  AuthorType,
  CodeRevision,
  ImportSnapshot,
  StoredFile,
} from "@ai-tutor/teaching-model";

import {
  isPersonalizedCoursePlan,
  type PersonalizedCoursePlan,
} from "../lesson/personalized-course";

export type ComparisonMode =
  | "side-by-side"
  | "wipe"
  | "source-diff"
  | "experiment-diff";

export interface RuntimeProjectRecord {
  readonly snapshot: ImportSnapshot;
  readonly project: NormalizedProject;
  readonly revisions: readonly CodeRevision[];
  readonly currentRevisionId: string;
  readonly sourceKind?: "user-import" | "lesson-demo" | "ai-demo" | "fork";
  readonly personalizedCourse?: PersonalizedCoursePlan;
  readonly forkedFrom?: {
    readonly blockId: string;
    readonly revisionId: string;
  };
}

export interface SavedElementTarget {
  readonly domPath: string;
  readonly fingerprint?: string;
}

export interface ComparisonRecord {
  readonly blockId: string;
  readonly sourceBlockId: string;
  readonly beforeRevisionId: string;
  readonly afterRevisionId: string;
  readonly mode: ComparisonMode;
  readonly wipePosition: number;
  readonly focusTarget?: SavedElementTarget;
}

export interface CssExperimentChange {
  readonly property: string;
  readonly value: string;
}

export const NUMERIC_CONTROLS = [
  { property: "padding", style: "padding-top", label: "里面留白", min: 0, max: 96, step: 1 },
  { property: "margin", style: "margin-top", label: "外面留白", min: -48, max: 96, step: 1 },
  { property: "width", style: "width", label: "宽度", min: 0, max: 600, step: 1 },
  { property: "height", style: "height", label: "高度", min: 0, max: 400, step: 1 },
  { property: "border-width", style: "border-top-width", label: "边框", min: 0, max: 24, step: 1 },
  { property: "gap", style: "gap", label: "项目间距", min: 0, max: 96, step: 1 },
  { property: "top", style: "top", label: "离顶部", min: -160, max: 160, step: 1 },
  { property: "right", style: "right", label: "离右边", min: -160, max: 160, step: 1 },
  { property: "bottom", style: "bottom", label: "离底部", min: -160, max: 160, step: 1 },
  { property: "left", style: "left", label: "离左边", min: -160, max: 160, step: 1 },
] as const;

export const ENUM_CONTROLS = [
  { property: "box-sizing", label: "尺寸怎么计算", values: ["content-box", "border-box"] },
  { property: "display", label: "显示方式", values: ["block", "inline-block", "flex", "grid", "none"] },
  { property: "flex-direction", label: "排列方向", values: ["row", "row-reverse", "column", "column-reverse"] },
  { property: "justify-content", label: "横向怎么对齐", values: ["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"] },
  { property: "align-items", label: "纵向怎么对齐", values: ["stretch", "flex-start", "center", "flex-end", "baseline"] },
  { property: "position", label: "放在哪里", values: ["static", "relative", "absolute"] },
] as const;

const NUMERIC_PROPERTIES: ReadonlySet<string> = new Set(
  NUMERIC_CONTROLS.map((control) => control.property),
);
const ENUM_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  ENUM_CONTROLS.map((control) => [control.property, new Set(control.values)]),
);
const COLOR_PROPERTIES: ReadonlySet<string> = new Set(["--brand"]);

export function isSafeExperimentChange(
  change: CssExperimentChange,
): boolean {
  if (NUMERIC_PROPERTIES.has(change.property)) {
    const match = change.value.match(/^(-?\d+(?:\.\d+)?)(px|%|rem|em|vh|vw)?$/);
    const value = match ? Number(match[1]) : Number.NaN;
    return Boolean(match) && Number.isFinite(value) && value >= -2000 && value <= 2000;
  }
  if (COLOR_PROPERTIES.has(change.property)) {
    return /^#[0-9a-f]{6}$/i.test(change.value);
  }
  return ENUM_VALUES.get(change.property)?.has(change.value) ?? false;
}

export function currentRevision(
  record: RuntimeProjectRecord,
): CodeRevision {
  const revision = record.revisions.find(
    (candidate) => candidate.id === record.currentRevisionId,
  );
  if (!revision) throw new Error("Current code revision is missing.");
  return revision;
}

export function revisionById(
  record: RuntimeProjectRecord,
  revisionId: string,
): CodeRevision | undefined {
  return record.revisions.find((revision) => revision.id === revisionId);
}

function safeSelector(target: SavedElementTarget): string {
  if (
    !target.domPath ||
    target.domPath.length > 2048 ||
    /[{};@\r\n]/.test(target.domPath)
  ) {
    throw new Error("The selected element path cannot be saved as CSS.");
  }
  return target.domPath;
}

export function buildExperimentCss(
  target: SavedElementTarget,
  changes: readonly CssExperimentChange[],
): string {
  if (changes.length === 0 || changes.some((change) => !isSafeExperimentChange(change))) {
    throw new Error("Experiment contains an unsupported CSS value.");
  }
  const declarations = changes
    .map((change) => `  ${change.property}: ${change.value} !important;`)
    .join("\n");
  return `${safeSelector(target)} {\n${declarations}\n}`;
}

async function hashFiles(
  files: Readonly<Record<string, StoredFile>>,
): Promise<string> {
  const canonical = Object.keys(files)
    .sort()
    .map((path) => {
      const file = files[path];
      return file
        ? [path, file.mimeType, file.encoding ?? "utf8", file.content]
        : [path];
    });
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export async function createChildRevision(
  record: RuntimeProjectRecord,
  files: Readonly<Record<string, StoredFile>>,
  options: {
    readonly authorType?: AuthorType;
    readonly changeSummary: string;
    readonly parentRevisionId?: string;
  },
): Promise<CodeRevision> {
  const parent = revisionById(
    record,
    options.parentRevisionId ?? record.currentRevisionId,
  );
  if (!parent) throw new Error("找不到这次修改的上一个版本。");
  const frozenFiles = Object.freeze(
    Object.fromEntries(
      Object.entries(files).map(([path, file]) => [path, Object.freeze({ ...file })]),
    ),
  );
  return Object.freeze({
    id: `revision-${crypto.randomUUID()}`,
    blockId: parent.blockId,
    parentRevisionId: parent.id,
    authorType: options.authorType ?? "user",
    files: frozenFiles,
    contentHash: await hashFiles(frozenFiles),
    changeSummary: options.changeSummary.trim() || "修改 HTML/CSS",
    createdAt: new Date().toISOString(),
  });
}

export interface AppendRevisionResult {
  readonly record: RuntimeProjectRecord;
  readonly branched: boolean;
  readonly competingRevisionId: string;
  readonly duplicate: boolean;
  readonly revisionId: string;
}

export function appendRevision(
  record: RuntimeProjectRecord,
  revision: CodeRevision,
  project: NormalizedProject = record.project,
): AppendRevisionResult {
  if (revision.blockId !== currentRevision(record).blockId) {
    throw new Error("这个版本不属于当前页面。");
  }
  if (
    !revision.parentRevisionId ||
    !revisionById(record, revision.parentRevisionId)
  ) {
    throw new Error("找不到这次修改的父版本，无法安全保存。");
  }
  if (revision.mutationId) {
    const previousMutation = record.revisions.find(
      (candidate) => candidate.mutationId === revision.mutationId,
    );
    if (previousMutation) {
      if (
        !revision.mutationDigest ||
        previousMutation.mutationDigest !== revision.mutationDigest
      ) {
        throw new Error("同一个 AI 操作编号对应了不同内容，已停止保存。");
      }
      return {
        record,
        branched: false,
        competingRevisionId: record.currentRevisionId,
        duplicate: true,
        revisionId: previousMutation.id,
      };
    }
  }
  const duplicate = record.revisions.find(
    (candidate) =>
      candidate.parentRevisionId === revision.parentRevisionId &&
      candidate.authorType === revision.authorType &&
      candidate.contentHash === revision.contentHash &&
      candidate.changeSummary === revision.changeSummary,
  );
  if (duplicate) {
    return {
      record,
      branched: false,
      competingRevisionId: record.currentRevisionId,
      duplicate: true,
      revisionId: duplicate.id,
    };
  }
  if (revisionById(record, revision.id)) {
    throw new Error("同一个版本编号对应了不同内容，已停止保存。");
  }
  const siblings = record.revisions.filter(
    (candidate) => candidate.parentRevisionId === revision.parentRevisionId,
  );
  const currentSibling = siblings.find(
    (candidate) => candidate.id === record.currentRevisionId,
  );
  const competingRevisionId =
    currentSibling?.id ??
    siblings.at(-1)?.id ??
    record.currentRevisionId;
  return {
    record: Object.freeze({
      ...record,
      project,
      revisions: Object.freeze([...record.revisions, revision]),
      currentRevisionId: revision.id,
    }),
    branched:
      siblings.length > 0 ||
      record.currentRevisionId !== revision.parentRevisionId,
    competingRevisionId,
    duplicate: false,
    revisionId: revision.id,
  };
}

export async function createExperimentRevision(
  record: RuntimeProjectRecord,
  target: SavedElementTarget,
  changes: readonly CssExperimentChange[],
): Promise<CodeRevision> {
  const parent = currentRevision(record);
  const previousCss = parent.files[EXPERIMENT_STYLES_FILE]?.content.trim();
  const experimentCss = buildExperimentCss(target, changes);
  const content = [previousCss, experimentCss].filter(Boolean).join("\n\n");
  const files = Object.freeze({
    ...parent.files,
    [EXPERIMENT_STYLES_FILE]: Object.freeze({
      path: EXPERIMENT_STYLES_FILE,
      mimeType: "text/css",
      content,
      encoding: "utf8" as const,
    }),
  });
  return createChildRevision(record, files, {
    authorType: "user",
    parentRevisionId: parent.id,
    changeSummary: changes
      .map((change) => `${change.property}: ${change.value}`)
      .join(" · "),
  });
}

export function savedTarget(target: ElementTarget): SavedElementTarget {
  return {
    domPath: target.domPath,
    ...(target.fingerprint ? { fingerprint: target.fingerprint } : {}),
  };
}

interface PersistedP5State {
  readonly version: 1;
  readonly projects: readonly [string, RuntimeProjectRecord][];
  readonly comparisons: readonly [string, ComparisonRecord][];
}

export function serializeP5State(
  projects: ReadonlyMap<string, RuntimeProjectRecord>,
  comparisons: ReadonlyMap<string, ComparisonRecord>,
): string {
  return JSON.stringify({
    version: 1,
    projects: [...projects],
    comparisons: [...comparisons],
  } satisfies PersistedP5State);
}

export function parseP5State(value: string): {
  projects: Map<string, RuntimeProjectRecord>;
  comparisons: Map<string, ComparisonRecord>;
} | null {
  try {
    const parsed = JSON.parse(value) as Partial<PersistedP5State>;
    if (
      parsed.version !== 1 ||
      !Array.isArray(parsed.projects) ||
      !Array.isArray(parsed.comparisons)
    ) {
      return null;
    }
    const projects = new Map<string, RuntimeProjectRecord>();
    for (const entry of parsed.projects) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [blockId, candidate] = entry as [unknown, unknown];
      const record = candidate as RuntimeProjectRecord;
      if (
        typeof blockId !== "string" ||
        blockId.length === 0 ||
        projects.has(blockId) ||
        !record ||
        !Array.isArray(record.revisions) ||
        record.revisions.length === 0 ||
        typeof record.currentRevisionId !== "string" ||
        !record.revisions.some((revision) => revision.id === record.currentRevisionId)
      ) {
        return null;
      }
      const revisions = new Map<string, CodeRevision>();
      for (const revision of record.revisions) {
        if (
          !revision ||
          typeof revision.id !== "string" ||
          revision.id.length === 0 ||
          revisions.has(revision.id) ||
          revision.blockId !== blockId ||
          (revision.parentRevisionId !== null &&
            typeof revision.parentRevisionId !== "string")
        ) {
          return null;
        }
        revisions.set(revision.id, revision);
      }
      const roots = record.revisions.filter(
        (revision) => revision.parentRevisionId === null,
      );
      if (roots.length !== 1) return null;
      for (const revision of record.revisions) {
        if (
          revision.parentRevisionId !== null &&
          !revisions.has(revision.parentRevisionId)
        ) {
          return null;
        }
        const visited = new Set<string>();
        let cursor: CodeRevision | undefined = revision;
        while (cursor && cursor.parentRevisionId !== null) {
          if (visited.has(cursor.id)) return null;
          visited.add(cursor.id);
          cursor = revisions.get(cursor.parentRevisionId);
        }
        if (!cursor) return null;
      }
      if (
        (record.sourceKind !== undefined &&
          !["user-import", "lesson-demo", "ai-demo", "fork"].includes(
            record.sourceKind,
          )) ||
        (record.personalizedCourse !== undefined &&
          (!isPersonalizedCoursePlan(record.personalizedCourse) ||
            record.personalizedCourse.blockId !== blockId ||
            !revisions.has(record.personalizedCourse.baseRevisionId)))
      ) {
        return null;
      }
      projects.set(blockId, record);
    }
    const comparisons = new Map<string, ComparisonRecord>();
    for (const entry of parsed.comparisons) {
      if (!Array.isArray(entry) || entry.length !== 2) return null;
      const [blockId, candidate] = entry as [unknown, unknown];
      const comparison = candidate as ComparisonRecord;
      const rawMode = (candidate as { mode?: unknown } | null)?.mode;
      if (
        typeof blockId !== "string" ||
        blockId.length === 0 ||
        comparisons.has(blockId) ||
        !comparison ||
        comparison.blockId !== blockId ||
        typeof comparison.sourceBlockId !== "string" ||
        typeof comparison.beforeRevisionId !== "string" ||
        typeof comparison.afterRevisionId !== "string" ||
        typeof comparison.wipePosition !== "number" ||
        !Number.isFinite(comparison.wipePosition) ||
        comparison.wipePosition < 0 ||
        comparison.wipePosition > 100 ||
        ![
          "side-by-side",
          "wipe",
          "source-diff",
          "experiment-diff",
          "code-diff",
        ].includes(String(rawMode))
      ) {
        return null;
      }
      const source = projects.get(comparison.sourceBlockId);
      if (
        !source ||
        !source.revisions.some(
          (revision) => revision.id === comparison.beforeRevisionId,
        ) ||
        !source.revisions.some(
          (revision) => revision.id === comparison.afterRevisionId,
        )
      ) {
        return null;
      }
      comparisons.set(blockId, {
        ...comparison,
        mode:
          rawMode === "code-diff"
            ? "experiment-diff"
            : (rawMode as ComparisonMode),
      });
    }
    return { projects, comparisons };
  } catch {
    return null;
  }
}

export function comparisonExperimentCode(
  record: RuntimeProjectRecord,
  revisionId: string,
): string {
  return revisionById(record, revisionId)?.files[EXPERIMENT_STYLES_FILE]?.content ?? "";
}

export function comparisonSourceCode(
  record: RuntimeProjectRecord,
  revisionId: string,
): string {
  const revision = revisionById(record, revisionId);
  if (!revision) return "";
  return Object.values(revision.files)
    .filter(
      (file) =>
        file.encoding !== "base64" &&
        (file.mimeType === "text/html" || file.mimeType === "text/css"),
    )
    .sort((left, right) => left.path.localeCompare(right.path))
    .map((file) => `===== ${file.path} =====\n${file.content}`)
    .join("\n\n");
}

export interface DiffLine {
  readonly kind: "same" | "remove" | "add";
  readonly text: string;
}

export function buildLineDiff(before: string, after: string): DiffLine[] {
  const left = before.split("\n");
  const right = after.split("\n");
  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      matrix[i]![j] = left[i] === right[j]
        ? (matrix[i + 1]?.[j + 1] ?? 0) + 1
        : Math.max(matrix[i + 1]?.[j] ?? 0, matrix[i]?.[j + 1] ?? 0);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      result.push({ kind: "same", text: left[i] ?? "" });
      i += 1;
      j += 1;
    } else if (
      j < right.length &&
      (i >= left.length ||
        (matrix[i]?.[j + 1] ?? 0) >= (matrix[i + 1]?.[j] ?? 0))
    ) {
      result.push({ kind: "add", text: right[j] ?? "" });
      j += 1;
    } else {
      result.push({ kind: "remove", text: left[i] ?? "" });
      i += 1;
    }
  }
  return result;
}
