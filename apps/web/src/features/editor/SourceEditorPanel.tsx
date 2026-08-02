"use client";

import type { RuntimeHandle } from "@ai-tutor/runtime-core";
import { staticHtmlCssAdapter } from "@ai-tutor/runtime-static-html";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { currentRevision, type RuntimeProjectRecord } from "../canvas/p5-model";
import {
  editableSourceFiles,
  prepareSourceRun,
  projectForRevision,
  SourceValidationError,
  type EditableSourceFile,
  type PreparedSourceRun,
  type SourceDiagnostic,
} from "./source-editor-model";

type EditorStatus =
  | "dirty"
  | "validating"
  | "invalid"
  | "safe-preview"
  | "saving"
  | "saved";

function highlightedLine(line: string, mimeType: EditableSourceFile["mimeType"]): ReactNode {
  const pattern =
    mimeType === "text/html"
      ? /(<!--[\s\S]*?-->|<\/?[a-z][^>]*>|"[^"]*"|'[^']*')/gi
      : /(\/\*.*?\*\/|#[\w-]+|\.[\w-]+|--[\w-]+|[\w-]+(?=\s*:)|"[^"]*"|'[^']*'|-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)?)/gi;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) parts.push(line.slice(offset, index));
    const token = match[0];
    const kind = token.startsWith("<!--") || token.startsWith("/*")
      ? "comment"
      : token.startsWith("<")
        ? "tag"
        : token.startsWith('"') || token.startsWith("'")
          ? "string"
          : /^-?\d/.test(token)
            ? "number"
            : token.startsWith(".") || token.startsWith("#")
              ? "selector"
              : "property";
    parts.push(
      <span data-token-kind={kind} key={`${index}-${token}`}>
        {token}
      </span>,
    );
    offset = index + token.length;
  }
  if (offset < line.length) parts.push(line.slice(offset));
  return parts.length > 0 ? parts : " ";
}

function SyntaxPreview({ file }: { file: EditableSourceFile }) {
  return (
    <pre
      className="source-editor__highlight"
      aria-label={`${file.path} 语法着色预览`}
      tabIndex={0}
    >
      {file.content.split("\n").map((line, index) => (
        <code key={index}>
          <span aria-hidden="true">{String(index + 1).padStart(3, " ")} </span>
          {highlightedLine(line, file.mimeType)}
        </code>
      ))}
    </pre>
  );
}

export function SourceEditorPanel({
  record,
  onSave,
  onClose,
}: {
  record: RuntimeProjectRecord;
  onSave: (prepared: PreparedSourceRun, summary: string) => Promise<void>;
  onClose: () => void;
}) {
  const [openedRecord] = useState(record);
  const baseRevision = currentRevision(openedRecord);
  const initialFiles = useMemo(
    () => editableSourceFiles(openedRecord, baseRevision),
    [baseRevision, openedRecord],
  );
  const [files, setFiles] = useState<readonly EditableSourceFile[]>(initialFiles);
  const [activePath, setActivePath] = useState(initialFiles[0]?.path ?? "");
  const [diagnostics, setDiagnostics] = useState<readonly SourceDiagnostic[]>([]);
  const [prepared, setPrepared] = useState<PreparedSourceRun | null>(null);
  const [status, setStatus] = useState<EditorStatus>("dirty");
  const [message, setMessage] = useState(
    "先运行修改；确认安全预览后，才能保存为新版本。",
  );
  const [summary, setSummary] = useState("修改 HTML/CSS");
  const activeMountRef = useRef<HTMLDivElement>(null);
  const stagingMountRef = useRef<HTMLDivElement>(null);
  const activeRuntimeRef = useRef<RuntimeHandle | null>(null);
  const generationRef = useRef(0);
  const saveInFlightRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const activeFile =
    files.find((file) => file.path === activePath) ?? files[0] ?? null;

  useEffect(() => {
    const mount = activeMountRef.current;
    if (!mount) return;
    let cancelled = false;
    let ownedRuntime: RuntimeHandle | null = null;
    const project = projectForRevision(openedRecord, baseRevision);
    void staticHtmlCssAdapter
      .createRuntime(project, {
        runtimeInstanceId: `source-editor-safe-${crypto.randomUUID()}`,
      })
      .then(async (runtime) => {
        ownedRuntime = runtime;
        await runtime.mount(mount);
        await runtime.render(baseRevision);
        if (cancelled) {
          await runtime.dispose();
          return;
        }
        activeRuntimeRef.current = runtime;
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMessage(
            error instanceof Error
              ? `安全预览暂时打不开：${error.message}`
              : "安全预览暂时打不开。",
          );
        }
      });
    return () => {
      cancelled = true;
      if (activeRuntimeRef.current === ownedRuntime) {
        activeRuntimeRef.current = null;
      }
      if (ownedRuntime) void ownedRuntime.dispose();
    };
  }, [baseRevision, openedRecord]);

  useEffect(
    () => () => {
      const runtime = activeRuntimeRef.current;
      activeRuntimeRef.current = null;
      if (runtime) void runtime.dispose();
    },
    [],
  );

  const updateActiveFile = (content: string) => {
    generationRef.current += 1;
    setFiles((current) =>
      current.map((file) =>
        file.path === activePath ? { ...file, content } : file,
      ),
    );
    setPrepared(null);
    setDiagnostics([]);
    setStatus("dirty");
    setMessage("内容已变化，请重新运行后再保存。");
  };

  const runDraft = async () => {
    const generation = generationRef.current;
    const snapshot = files.map((file) => ({ ...file }));
    setStatus("validating");
    setDiagnostics([]);
    setMessage("正在检查并准备安全预览…");
    let candidate: RuntimeHandle | null = null;
    try {
      const nextPrepared = await prepareSourceRun(
        openedRecord,
        baseRevision.id,
        snapshot,
      );
      const staging = stagingMountRef.current;
      const active = activeMountRef.current;
      if (!staging || !active) throw new Error("预览区域尚未准备好。");
      staging.replaceChildren();
      candidate = await staticHtmlCssAdapter.createRuntime(nextPrepared.project, {
        runtimeInstanceId: `source-editor-candidate-${crypto.randomUUID()}`,
      });
      await candidate.mount(staging);
      await candidate.render({
        ...baseRevision,
        files: nextPrepared.revisionFiles,
      });
      if (generationRef.current !== generation) {
        await candidate.dispose();
        setStatus("dirty");
        setMessage("运行期间内容又变化了，请再运行一次。");
        return;
      }
      const previous = activeRuntimeRef.current;
      if (previous) await previous.dispose();
      active.replaceChildren(...Array.from(staging.childNodes));
      activeRuntimeRef.current = candidate;
      candidate = null;
      setPrepared(nextPrepared);
      setStatus("safe-preview");
      setMessage("这份修改已在隔离预览中运行，可以保存为新版本。");
    } catch (error) {
      if (candidate) await candidate.dispose().catch(() => undefined);
      const nextDiagnostics =
        error instanceof SourceValidationError
          ? error.diagnostics
          : [
              {
                filePath: activePath || openedRecord.snapshot.entryFile,
                line: 1,
                column: 1,
                severity: "error" as const,
                message: error instanceof Error ? error.message : "修改无法安全运行。",
              },
            ];
      setDiagnostics(nextDiagnostics);
      setPrepared(null);
      setStatus("invalid");
      setMessage("修改里还有问题；右侧仍保留上一次安全运行结果。");
    }
  };

  const save = async () => {
    if (!prepared || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setStatus("saving");
    setMessage("正在保存新版本…");
    try {
      await onSave(prepared, summary);
      setStatus("saved");
      setMessage("新版本已保存，旧版本仍可随时切回。");
      onClose();
    } catch (error) {
      setStatus("safe-preview");
      setMessage(error instanceof Error ? error.message : "保存失败，请重试。");
    } finally {
      saveInFlightRef.current = false;
    }
  };

  return (
    <div className="source-editor-layer" onPointerDown={(event) => event.stopPropagation()}>
      <section
        className="source-editor"
        role="dialog"
        aria-modal="true"
        aria-label="编辑 HTML 和 CSS"
        data-editor-status={status}
      >
        <header>
          <div>
            <span>安全源码编辑</span>
            <h2>编辑 HTML 和 CSS</h2>
            <small>这里编辑的是导入后可安全运行的版本，不包含被移除的脚本。</small>
          </div>
          <button type="button" onClick={onClose} aria-label="关闭源码编辑器">
            ×
          </button>
        </header>

        <div className="source-editor__workspace">
          <div className="source-editor__code">
            <nav aria-label="源码文件">
              {files.map((file) => (
                <button
                  type="button"
                  key={file.path}
                  aria-pressed={file.path === activeFile?.path}
                  onClick={() => setActivePath(file.path)}
                >
                  {file.path}
                </button>
              ))}
            </nav>
            {activeFile ? (
              <>
                <div className="source-editor__input">
                  <ol aria-hidden="true">
                    {activeFile.content.split("\n").map((_, index) => (
                      <li key={index}>{index + 1}</li>
                    ))}
                  </ol>
                  <textarea
                    ref={textareaRef}
                    aria-label={`编辑 ${activeFile.path}`}
                    spellCheck={false}
                    value={activeFile.content}
                    onChange={(event) => updateActiveFile(event.currentTarget.value)}
                  />
                </div>
                <SyntaxPreview file={activeFile} />
              </>
            ) : (
              <p>这个版本没有可编辑的 HTML/CSS 文件。</p>
            )}
          </div>

          <aside className="source-editor__result">
            <div>
              <strong>
                {status === "safe-preview" ? "刚才的修改" : "上一次安全运行结果"}
              </strong>
              <span>有错误时，这里不会被破坏。</span>
            </div>
            <div ref={activeMountRef} className="source-editor__preview" />
            <div ref={stagingMountRef} className="source-editor__staging" aria-hidden="true" />
          </aside>
        </div>

        {diagnostics.length > 0 ? (
          <section className="source-editor__diagnostics" aria-label="源码问题">
            <strong>请先修正这些位置</strong>
            <ul>
              {diagnostics.map((item, index) => (
                <li key={`${item.filePath}-${item.line}-${item.column}-${index}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setActivePath(item.filePath);
                      queueMicrotask(() => textareaRef.current?.focus());
                    }}
                  >
                    {item.filePath} · 第 {item.line} 行，第 {item.column} 列：
                    {item.message}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <footer>
          <p role={status === "invalid" ? "alert" : "status"}>{message}</p>
          <label>
            <span>这次修改叫什么</span>
            <input
              aria-label="版本说明"
              value={summary}
              maxLength={80}
              onChange={(event) => setSummary(event.currentTarget.value)}
            />
          </label>
          <div>
            <button type="button" onClick={onClose}>放弃修改</button>
            <button
              type="button"
              onClick={() => void runDraft()}
              disabled={status === "validating" || status === "saving" || !activeFile}
            >
              {status === "validating" ? "正在运行…" : "运行修改"}
            </button>
            <button
              type="button"
              className="is-primary"
              onClick={() => void save()}
              disabled={!prepared || status !== "safe-preview"}
            >
              保存为新版本
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
