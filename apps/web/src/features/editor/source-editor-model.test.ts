import type { NormalizedProject } from "@ai-tutor/runtime-core";
import type { CodeRevision, ImportSnapshot } from "@ai-tutor/teaching-model";
import { describe, expect, it } from "vitest";

import type { RuntimeProjectRecord } from "../canvas/p5-model";
import {
  createSourceRevision,
  editableHtmlSource,
  editableSourceFiles,
  projectForRevision,
  validateSourceFiles,
  type PreparedSourceRun,
} from "./source-editor-model";

function fixture(): RuntimeProjectRecord {
  const files = {
    "index.html": {
      path: "index.html",
      mimeType: "text/html",
      encoding: "utf8" as const,
      content:
        '<!doctype html><html><head><style data-ai-tutor-source="index.html" data-ai-tutor-base-line="2" data-ai-tutor-base-column="1">h1{color:red}</style><style data-ai-tutor-source="styles.css" data-ai-tutor-base-line="1" data-ai-tutor-base-column="1">h1{padding:4px}</style></head><body><img src="__AI_TUTOR_ASSET_0001__"><h1>Hello</h1></body></html>',
    },
    "styles.css": {
      path: "styles.css",
      mimeType: "text/css",
      encoding: "utf8" as const,
      content: "h1{padding:4px}",
    },
    "photo.png": {
      path: "photo.png",
      mimeType: "image/png",
      encoding: "base64" as const,
      content: "AA==",
    },
  };
  const project: NormalizedProject = {
    runtimeType: "static-html-css",
    entryFile: "index.html",
    files,
    assetManifest: {
      "photo.png": { token: "__AI_TUTOR_ASSET_0001__", mimeType: "image/png" },
    },
    diagnostics: [],
  };
  const snapshot: ImportSnapshot = {
    id: "snapshot-1",
    canvasId: "canvas-1",
    runtimeType: project.runtimeType,
    entryFile: project.entryFile,
    files,
    contentHash: "hash-1",
    createdAt: "2026-08-02T00:00:00.000Z",
  };
  const revision: CodeRevision = {
    id: "revision-1",
    blockId: "block-1",
    parentRevisionId: null,
    authorType: "user",
    files,
    contentHash: "hash-1",
    changeSummary: "import",
    createdAt: snapshot.createdAt,
  };
  return {
    snapshot,
    project,
    revisions: [revision],
    currentRevisionId: revision.id,
  };
}

describe("source editor model", () => {
  it("shows editable safe source without generated CSS duplication", () => {
    const record = fixture();
    const html = editableHtmlSource(
      record.project.files["index.html"]!.content,
      "index.html",
      record.project,
    );
    expect(html).toContain("h1{color:red}");
    expect(html).not.toContain("data-ai-tutor-source");
    expect(html).not.toContain("h1{padding:4px}</style>");
    expect(html).toContain('src="photo.png"');
    expect(editableSourceFiles(record).map((file) => file.path)).toEqual([
      "index.html",
      "styles.css",
    ]);
  });

  it("reports CSS and HTML errors with a file and source line", () => {
    const diagnostics = validateSourceFiles([
      {
        path: "styles.css",
        mimeType: "text/css",
        content: "h1 {\n  color: red;\n",
      },
      {
        path: "index.html",
        mimeType: "text/html",
        content: "<main>\n  <h1>Demo</main>",
      },
    ]);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ filePath: "styles.css", line: 1 }),
        expect.objectContaining({ filePath: "index.html", line: 2 }),
      ]),
    );
  });

  it("creates an immutable child revision and projects any revision safely", async () => {
    const record = fixture();
    const prepared: PreparedSourceRun = {
      baseRevisionId: "revision-1",
      draftHash: "draft-1",
      project: record.project,
      revisionFiles: {
        ...record.revisions[0]!.files,
        "styles.css": {
          path: "styles.css",
          mimeType: "text/css",
          encoding: "utf8",
          content: "h1{padding:24px}",
        },
      },
      diagnostics: [],
    };
    const child = await createSourceRevision(record, prepared, "改大标题留白");
    expect(child.parentRevisionId).toBe("revision-1");
    expect(child.changeSummary).toBe("改大标题留白");
    expect(record.revisions[0]!.files["styles.css"]!.content).toBe(
      "h1{padding:4px}",
    );
    expect(projectForRevision(record, child).files["styles.css"]!.content).toBe(
      "h1{padding:24px}",
    );
  });
});
