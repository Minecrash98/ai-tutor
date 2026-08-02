import type {
  ImportedFile,
  NormalizedProject,
} from "@ai-tutor/runtime-core";
import {
  EXPERIMENT_STYLES_FILE,
  StaticHtmlImportError,
  staticHtmlCssAdapter,
} from "@ai-tutor/runtime-static-html";
import type { CodeRevision, StoredFile } from "@ai-tutor/teaching-model";

import {
  createChildRevision,
  currentRevision,
  revisionById,
  type RuntimeProjectRecord,
} from "../canvas/p5-model";

export interface EditableSourceFile {
  readonly path: string;
  readonly mimeType: "text/html" | "text/css";
  readonly content: string;
}

export interface SourceDiagnostic {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly severity: "error" | "warning";
  readonly message: string;
}

export interface PreparedSourceRun {
  readonly baseRevisionId: string;
  readonly draftHash: string;
  readonly project: NormalizedProject;
  readonly revisionFiles: Readonly<Record<string, StoredFile>>;
  readonly diagnostics: readonly SourceDiagnostic[];
}

export class SourceValidationError extends Error {
  constructor(readonly diagnostics: readonly SourceDiagnostic[]) {
    super(diagnostics[0]?.message ?? "HTML/CSS 还不能安全运行。");
    this.name = "SourceValidationError";
  }
}

function restoreAssetReferences(
  content: string,
  project: NormalizedProject,
): string {
  let restored = content;
  for (const [path, asset] of Object.entries(project.assetManifest)) {
    restored = restored.split(asset.token).join(path);
  }
  return restored;
}

export function editableHtmlSource(
  content: string,
  entryFile: string,
  project: NormalizedProject,
): string {
  const withoutGeneratedCss = content.replace(
    /<style\b([^>]*)>([\s\S]*?)<\/style\s*>/gi,
    (whole, attributes: string) => {
      const source = attributes.match(
        /\bdata-ai-tutor-source\s*=\s*(?:"([^"]*)"|'([^']*)')/i,
      );
      const sourcePath = source?.[1] ?? source?.[2];
      if (sourcePath && sourcePath !== entryFile) return "";
      const cleanedAttributes = attributes.replace(
        /\s+data-ai-tutor-(?:source|base-line|base-column)\s*=\s*(?:"[^"]*"|'[^']*')/gi,
        "",
      );
      const body = whole
        .replace(/^<style\b[^>]*>/i, "")
        .replace(/<\/style\s*>$/i, "");
      return `<style${cleanedAttributes}>${body}</style>`;
    },
  );
  return restoreAssetReferences(withoutGeneratedCss, project);
}

export function editableSourceFiles(
  record: RuntimeProjectRecord,
  revision: CodeRevision = currentRevision(record),
): readonly EditableSourceFile[] {
  return Object.values(revision.files)
    .filter(
      (file): file is StoredFile & { mimeType: "text/html" | "text/css" } =>
        file.encoding !== "base64" &&
        file.path !== EXPERIMENT_STYLES_FILE &&
        (file.mimeType === "text/html" || file.mimeType === "text/css"),
    )
    .sort((left, right) =>
      left.path === record.snapshot.entryFile
        ? -1
        : right.path === record.snapshot.entryFile
          ? 1
          : left.path.localeCompare(right.path),
    )
    .map((file) => ({
      path: file.path,
      mimeType: file.mimeType,
      content:
        file.mimeType === "text/html"
          ? editableHtmlSource(file.content, record.snapshot.entryFile, record.project)
          : restoreAssetReferences(file.content, record.project),
    }));
}

function sourcePosition(content: string, index: number) {
  const before = content.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  return { line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

function diagnostic(
  file: EditableSourceFile,
  index: number,
  message: string,
): SourceDiagnostic {
  return {
    filePath: file.path,
    ...sourcePosition(file.content, index),
    severity: "error",
    message,
  };
}

function validateCss(file: EditableSourceFile): readonly SourceDiagnostic[] {
  const result: SourceDiagnostic[] = [];
  const openings: number[] = [];
  let quote = "";
  let quoteStart = 0;
  let commentStart = -1;
  for (let index = 0; index < file.content.length; index += 1) {
    const character = file.content[index] ?? "";
    const next = file.content[index + 1] ?? "";
    if (commentStart >= 0) {
      if (character === "*" && next === "/") {
        commentStart = -1;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === quote && file.content[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      commentStart = index;
      index += 1;
    } else if (character === '"' || character === "'") {
      quote = character;
      quoteStart = index;
    } else if (character === "{") {
      openings.push(index);
    } else if (character === "}") {
      if (openings.length === 0) {
        result.push(diagnostic(file, index, "这里多了一个右花括号 }。"));
      } else {
        openings.pop();
      }
    }
  }
  if (quote) result.push(diagnostic(file, quoteStart, "这段文字缺少结束引号。"));
  if (commentStart >= 0) {
    result.push(diagnostic(file, commentStart, "这段 CSS 注释没有结束。"));
  }
  for (const index of openings) {
    result.push(diagnostic(file, index, "这个 CSS 规则缺少右花括号 }。"));
  }
  return result;
}

const VOID_HTML_TAGS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

function validateHtml(file: EditableSourceFile): readonly SourceDiagnostic[] {
  const result: SourceDiagnostic[] = [];
  const stack: { tag: string; index: number }[] = [];
  const tokens = file.content.matchAll(
    /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi,
  );
  for (const token of tokens) {
    const source = token[0];
    const tag = token[1]?.toLowerCase();
    const index = token.index ?? 0;
    if (!tag || source.startsWith("<!--") || source.startsWith("<!")) continue;
    if (source.startsWith("</")) {
      const opening = stack.pop();
      if (!opening || opening.tag !== tag) {
        result.push(diagnostic(file, index, `结束标签 </${tag}> 没有对应的开始标签。`));
        if (opening) stack.push(opening);
      }
    } else if (!source.endsWith("/>") && !VOID_HTML_TAGS.has(tag)) {
      stack.push({ tag, index });
    }
  }
  for (const opening of stack) {
    result.push(
      diagnostic(file, opening.index, `开始标签 <${opening.tag}> 没有对应的结束标签。`),
    );
  }
  return result;
}

export function validateSourceFiles(
  files: readonly EditableSourceFile[],
): readonly SourceDiagnostic[] {
  return files.flatMap((file) =>
    file.mimeType === "text/css" ? validateCss(file) : validateHtml(file),
  );
}

async function hashDraft(files: readonly EditableSourceFile[]): Promise<string> {
  const canonical = files
    .map((file) => [file.path, file.mimeType, file.content])
    .sort(([left], [right]) => String(left).localeCompare(String(right)));
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(canonical)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function prepareSourceRun(
  record: RuntimeProjectRecord,
  baseRevisionId: string,
  files: readonly EditableSourceFile[],
): Promise<PreparedSourceRun> {
  const baseRevision = revisionById(record, baseRevisionId);
  if (!baseRevision) throw new Error("这个编辑版本已经找不到了，请重新打开编辑器。");
  const diagnostics = validateSourceFiles(files);
  if (diagnostics.some((item) => item.severity === "error")) {
    throw new SourceValidationError(diagnostics);
  }
  const importedFiles: ImportedFile[] = files.map((file) => ({
    path: file.path,
    mimeType: file.mimeType,
    bytes: new TextEncoder().encode(file.content),
  }));
  for (const file of Object.values(baseRevision.files)) {
    if (file.encoding === "base64") {
      importedFiles.push({
        path: file.path,
        mimeType: file.mimeType,
        bytes: decodeBase64(file.content),
      });
    }
  }
  let normalized: NormalizedProject;
  try {
    normalized = await staticHtmlCssAdapter.normalize(importedFiles);
  } catch (error) {
    if (error instanceof StaticHtmlImportError) {
      throw new SourceValidationError(
        error.diagnostics.map((item) => ({
          filePath: item.filePath ?? record.snapshot.entryFile,
          line: 1,
          column: 1,
          severity: item.severity === "error" ? "error" : "warning",
          message: item.message,
        })),
      );
    }
    throw error;
  }
  const experimentFile = baseRevision.files[EXPERIMENT_STYLES_FILE];
  const revisionFiles = Object.freeze({
    ...normalized.files,
    ...(experimentFile ? { [EXPERIMENT_STYLES_FILE]: experimentFile } : {}),
  });
  const project = Object.freeze({ ...normalized, files: revisionFiles });
  return Object.freeze({
    baseRevisionId,
    draftHash: await hashDraft(files),
    project,
    revisionFiles,
    diagnostics: Object.freeze([]),
  });
}

export async function createSourceRevision(
  record: RuntimeProjectRecord,
  prepared: PreparedSourceRun,
  summary: string,
): Promise<CodeRevision> {
  return createChildRevision(record, prepared.revisionFiles, {
    parentRevisionId: prepared.baseRevisionId,
    authorType: "user",
    changeSummary: summary || "修改 HTML/CSS",
  });
}

export function projectForRevision(
  record: RuntimeProjectRecord,
  revision: CodeRevision,
): NormalizedProject {
  return Object.freeze({ ...record.project, files: revision.files });
}
