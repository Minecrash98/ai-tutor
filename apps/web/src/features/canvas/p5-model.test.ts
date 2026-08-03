import { describe, expect, it } from "vitest";

import type { NormalizedProject } from "@ai-tutor/runtime-core";
import { EXPERIMENT_STYLES_FILE } from "@ai-tutor/runtime-static-html";
import type { CodeRevision, ImportSnapshot } from "@ai-tutor/teaching-model";

import {
  appendRevision,
  buildExperimentCss,
  buildLineDiff,
  comparisonExperimentCode,
  comparisonSourceCode,
  createExperimentRevision,
  parseP5State,
  serializeP5State,
  type ComparisonRecord,
  type RuntimeProjectRecord,
} from "./p5-model";

function fixtureRecord(): RuntimeProjectRecord {
  const createdAt = "2026-07-26T00:00:00.000Z";
  const files = {
    "index.html": {
      path: "index.html",
      mimeType: "text/html",
      content: "<main id=\"card\">demo</main>",
      encoding: "utf8" as const,
    },
  };
  const project: NormalizedProject = {
    runtimeType: "static-html-css",
    entryFile: "index.html",
    files,
    assetManifest: {},
    diagnostics: [],
  };
  const snapshot: ImportSnapshot = {
    id: "snapshot-1",
    canvasId: "canvas-1",
    runtimeType: project.runtimeType,
    entryFile: project.entryFile,
    files,
    contentHash: "hash-1",
    createdAt,
  };
  const revision: CodeRevision = {
    id: "revision-1",
    blockId: "block-1",
    parentRevisionId: null,
    authorType: "user",
    files,
    contentHash: "hash-1",
    changeSummary: "import",
    createdAt,
  };
  return {
    snapshot,
    project,
    revisions: [revision],
    currentRevisionId: revision.id,
  };
}

describe("P5 immutable CSS experiments", () => {
  it("serializes only allowed CSS declarations", () => {
    expect(
      buildExperimentCss(
        { domPath: "main#card" },
        [{ property: "padding", value: "24px" }],
      ),
    ).toContain("padding: 24px !important");
    expect(() =>
      buildExperimentCss(
        { domPath: "main#card" },
        [{ property: "background", value: "url(https://example.com)" }],
      ),
    ).toThrow("unsupported CSS");
  });

  it("accepts a bounded global brand hex color and rejects other color syntax", () => {
    expect(
      buildExperimentCss(
        { domPath: ":root" },
        [{ property: "--brand", value: "#0f9f8f" }],
      ),
    ).toContain("--brand: #0f9f8f !important");
    expect(() =>
      buildExperimentCss(
        { domPath: ":root" },
        [{ property: "--brand", value: "rgb(15, 159, 143)" }],
      ),
    ).toThrow("unsupported CSS");
  });

  it("creates a child revision without mutating its parent", async () => {
    const record = fixtureRecord();
    const parent = record.revisions[0]!;
    const child = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );
    expect(child.parentRevisionId).toBe(parent.id);
    expect(child.files[EXPERIMENT_STYLES_FILE]?.content).toContain("24px");
    expect(parent.files[EXPERIMENT_STYLES_FILE]).toBeUndefined();
  });

  it("keeps concurrent children as explicit sibling branches", async () => {
    const record = fixtureRecord();
    const first = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "16px" }],
    );
    const afterFirst = appendRevision(record, first).record;
    const concurrent = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );

    const result = appendRevision(afterFirst, concurrent);

    expect(result.branched).toBe(true);
    expect(result.competingRevisionId).toBe(first.id);
    expect(result.record.revisions).toHaveLength(3);
    expect(result.record.revisions.at(-2)?.parentRevisionId).toBe("revision-1");
    expect(result.record.revisions.at(-1)?.parentRevisionId).toBe("revision-1");
    expect(result.record.currentRevisionId).toBe(concurrent.id);
  });

  it("returns the original receipt when the same parent and payload are retried", async () => {
    const record = fixtureRecord();
    const first = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );
    const afterFirst = appendRevision(record, first).record;
    const retry = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );

    const result = appendRevision(afterFirst, retry);

    expect(result.duplicate).toBe(true);
    expect(result.revisionId).toBe(first.id);
    expect(result.record).toBe(afterFirst);
    expect(result.record.revisions).toHaveLength(2);
  });

  it("recognizes siblings even after the student switches back to their parent", async () => {
    const record = fixtureRecord();
    const first = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "16px" }],
    );
    const afterFirst = appendRevision(record, first).record;
    const viewingParent = {
      ...afterFirst,
      currentRevisionId: "revision-1",
    };
    const sibling = await createExperimentRevision(
      viewingParent,
      { domPath: "main#card" },
      [{ property: "padding", value: "32px" }],
    );

    const result = appendRevision(viewingParent, sibling);

    expect(result.branched).toBe(true);
    expect(result.competingRevisionId).toBe(first.id);
    expect(result.record.currentRevisionId).toBe(sibling.id);
  });

  it("recognizes a stale child when the current head is on a cousin branch", async () => {
    const root = fixtureRecord();
    const firstBranch = await createExperimentRevision(
      root,
      { domPath: "main#card" },
      [{ property: "padding", value: "16px" }],
    );
    const afterFirst = appendRevision(root, firstBranch).record;
    const secondBranch = await createExperimentRevision(
      root,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );
    const onSecondBranch = appendRevision(afterFirst, secondBranch).record;
    const staleRecord = {
      ...onSecondBranch,
      currentRevisionId: firstBranch.id,
    };
    const childOfFirst = await createExperimentRevision(
      staleRecord,
      { domPath: "main#card" },
      [{ property: "margin", value: "12px" }],
    );
    const currentOnSecond = {
      ...staleRecord,
      currentRevisionId: secondBranch.id,
    };

    const result = appendRevision(currentOnSecond, childOfFirst);

    expect(result.branched).toBe(true);
    expect(result.competingRevisionId).toBe(secondBranch.id);
  });

  it("returns a persisted AI mutation receipt and rejects id reuse with new input", async () => {
    const record = fixtureRecord();
    const generated = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );
    const first = {
      ...generated,
      mutationId: "tool-request-1",
      mutationDigest: "digest-a",
    };
    const saved = appendRevision(record, first).record;
    const retry = {
      ...generated,
      id: "revision-retry",
      mutationId: "tool-request-1",
      mutationDigest: "digest-a",
    };
    expect(appendRevision(saved, retry)).toMatchObject({
      duplicate: true,
      revisionId: first.id,
    });
    expect(() =>
      appendRevision(saved, {
        ...retry,
        mutationDigest: "digest-b",
      }),
    ).toThrow("同一个 AI 操作编号对应了不同内容");
  });

  it("restores version relationships and comparison configuration", () => {
    const base = fixtureRecord();
    const child = {
      ...base.revisions[0]!,
      id: "revision-2",
      parentRevisionId: "revision-1",
      contentHash: "hash-2",
    };
    const record = { ...base, revisions: [...base.revisions, child] };
    const comparison: ComparisonRecord = {
      blockId: "comparison-1",
      sourceBlockId: "block-1",
      beforeRevisionId: "revision-1",
      afterRevisionId: "revision-2",
      mode: "wipe",
      wipePosition: 38,
    };
    const parsed = parseP5State(
      serializeP5State(
        new Map([["block-1", record]]),
        new Map([["comparison-1", comparison]]),
      ),
    );
    expect(parsed?.projects.get("block-1")?.currentRevisionId).toBe("revision-1");
    expect(parsed?.comparisons.get("comparison-1")?.wipePosition).toBe(38);
  });

  it("marks added and removed lines in the code diff", () => {
    const diff = buildLineDiff("a\nb", "a\nc");
    expect(diff).toContainEqual({ kind: "remove", text: "b" });
    expect(diff).toContainEqual({ kind: "add", text: "c" });
  });

  it("keeps full-project and experiment-only comparisons explicit", async () => {
    const record = fixtureRecord();
    const child = await createExperimentRevision(
      record,
      { domPath: "main#card" },
      [{ property: "padding", value: "24px" }],
    );
    const withChild = { ...record, revisions: [...record.revisions, child] };

    expect(comparisonSourceCode(withChild, child.id)).toContain(
      "===== index.html =====",
    );
    expect(comparisonSourceCode(withChild, child.id)).toContain(
      `===== ${EXPERIMENT_STYLES_FILE} =====`,
    );
    expect(comparisonExperimentCode(withChild, child.id)).toContain(
      "padding: 24px",
    );
    expect(comparisonExperimentCode(withChild, child.id)).not.toContain(
      "index.html",
    );
  });

  it("migrates the legacy ambiguous code-diff mode to experiment diff", () => {
    const record = fixtureRecord();
    const serialized = JSON.stringify({
      version: 1,
      projects: [["block-1", record]],
      comparisons: [[
        "comparison-1",
        {
          blockId: "comparison-1",
          sourceBlockId: "block-1",
          beforeRevisionId: "revision-1",
          afterRevisionId: "revision-1",
          mode: "code-diff",
          wipePosition: 50,
        },
      ]],
    });

    expect(parseP5State(serialized)?.comparisons.get("comparison-1")?.mode).toBe(
      "experiment-diff",
    );
  });

  it("rejects duplicate, disconnected, cyclic, and cross-block revision graphs", () => {
    const record = fixtureRecord();
    const serializeRecord = (candidate: RuntimeProjectRecord) =>
      JSON.stringify({
        version: 1,
        projects: [["block-1", candidate]],
        comparisons: [],
      });

    expect(
      parseP5State(
        serializeRecord({
          ...record,
          revisions: [...record.revisions, record.revisions[0]!],
        }),
      ),
    ).toBeNull();
    expect(
      parseP5State(
        serializeRecord({
          ...record,
          revisions: [
            ...record.revisions,
            {
              ...record.revisions[0]!,
              id: "revision-missing-parent",
              parentRevisionId: "revision-not-there",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseP5State(
        serializeRecord({
          ...record,
          revisions: [
            {
              ...record.revisions[0]!,
              parentRevisionId: "revision-cycle",
            },
            {
              ...record.revisions[0]!,
              id: "revision-cycle",
              parentRevisionId: "revision-1",
            },
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseP5State(
        serializeRecord({
          ...record,
          revisions: [
            { ...record.revisions[0]!, blockId: "another-block" },
          ],
        }),
      ),
    ).toBeNull();
  });

  it("rejects comparison records whose key, source, revisions, or wipe value are invalid", () => {
    const record = fixtureRecord();
    const comparison: ComparisonRecord = {
      blockId: "comparison-1",
      sourceBlockId: "block-1",
      beforeRevisionId: "revision-1",
      afterRevisionId: "revision-1",
      mode: "wipe",
      wipePosition: 50,
    };
    const serializeComparison = (key: string, candidate: ComparisonRecord) =>
      JSON.stringify({
        version: 1,
        projects: [["block-1", record]],
        comparisons: [[key, candidate]],
      });

    expect(
      parseP5State(serializeComparison("wrong-key", comparison)),
    ).toBeNull();
    expect(
      parseP5State(
        serializeComparison("comparison-1", {
          ...comparison,
          sourceBlockId: "missing-block",
        }),
      ),
    ).toBeNull();
    expect(
      parseP5State(
        serializeComparison("comparison-1", {
          ...comparison,
          afterRevisionId: "missing-revision",
        }),
      ),
    ).toBeNull();
    expect(
      parseP5State(
        serializeComparison("comparison-1", {
          ...comparison,
          wipePosition: 101,
        }),
      ),
    ).toBeNull();
  });
});
