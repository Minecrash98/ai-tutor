import type { InspectionResult } from "@ai-tutor/runtime-core";
import type { CodeRevision } from "@ai-tutor/teaching-model";
import { describe, expect, it } from "vitest";

import {
  attachPersonalizedCourseVerification,
  buildPersonalizedCoursePlan,
  extractPersonalizedCourseCandidates,
  isPersonalizedCoursePlan,
  personalizedCourseSourceUnchanged,
  recordPersonalizedCourseAnswer,
  revisionDescendsFrom,
  verifyPersonalizedCourseExperiment,
} from "./personalized-course";

function revision(css: string): CodeRevision {
  return {
    id: "revision-1",
    blockId: "block-1",
    parentRevisionId: null,
    authorType: "user",
    files: {
      "styles.css": {
        path: "styles.css",
        mimeType: "text/css",
        content: css,
        encoding: "utf8",
      },
    },
    contentHash: "hash",
    changeSummary: "import",
    createdAt: "2026-08-02T00:00:00.000Z",
  };
}

function inspection(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    target: { runtimeInstanceId: "runtime-1", domPath: "main#card" },
    domPath: "main#card",
    tagName: "MAIN",
    attributes: { id: "card" },
    boundingRect: {
      x: 20,
      y: 30,
      width: 328,
      height: 160,
      top: 30,
      right: 348,
      bottom: 190,
      left: 20,
    },
    boxModel: {
      content: { width: 280, height: 112 },
      padding: { top: 20, right: 20, bottom: 20, left: 20 },
      border: { top: 4, right: 4, bottom: 4, left: 4 },
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      boxSizing: "content-box",
    },
    computedStyles: {
      display: "block",
      position: "static",
      "padding-top": "20px",
    },
    matchedRules: [
      {
        selectorText: "#card",
        source: {
          filePath: "styles.css",
          line: 2,
          column: 1,
          kind: "stylesheet",
        },
        specificity: [1, 0, 0],
        sourceOrder: 0,
        declarations: [
          { property: "width", value: "280px", important: false, inherited: false },
          { property: "padding", value: "20px", important: false, inherited: false },
        ],
        pseudoElement: null,
      },
    ],
    diagnostics: [],
    relations: { parent: null, children: [] },
    ...overrides,
  };
}

describe("personalized imported-page course", () => {
  it("extracts only conservative, source-locatable box, flex, and positioning candidates", () => {
    const candidates = extractPersonalizedCourseCandidates(
      revision(`/* keep line */
        #card { width: 280px; padding: 20px; }
        .toolbar { display: flex; }
        .badge { position: absolute; top: 8px; }
        main > p { width: 10px; padding: 2px; }`),
    );
    expect(candidates.map((candidate) => [candidate.topic, candidate.selector])).toEqual([
      ["box-model", "#card"],
      ["flex", ".toolbar"],
      ["positioning", ".badge"],
    ]);
  });

  it("keeps multiple supported topics on the same source rule", () => {
    const candidates = extractPersonalizedCourseCandidates(
      revision("#layout { width: 280px; padding: 20px; display: flex; }"),
    );
    expect(candidates.map((candidate) => candidate.topic)).toEqual([
      "box-model",
      "flex",
    ]);
  });

  it("builds a fact-grounded box plan tied to one immutable revision and frozen transfer item", () => {
    const candidate = extractPersonalizedCourseCandidates(
      revision("\n#card { width: 280px; padding: 20px; }"),
    )[0]!;
    const plan = buildPersonalizedCoursePlan({
      blockId: "block-1",
      revisionId: "revision-1",
      contentHash: "hash",
      candidate,
      result: inspection(),
      generatedAt: "2026-08-02T01:00:00.000Z",
    });

    expect(plan).toMatchObject({
      topic: "box-model",
      baseRevisionId: "revision-1",
      source: { filePath: "styles.css", line: 2, selector: "#card" },
      before: { computedValue: "20px", boundingWidth: 328 },
      experiment: { property: "padding", trialValue: "36px" },
      hiddenTransferItemId: "box-transfer-b-1",
    });
  });

  it("refuses a box claim when runtime facts contradict content-box or direct source evidence", () => {
    const candidate = extractPersonalizedCourseCandidates(
      revision("\n#card { width: 280px; padding: 20px; }"),
    )[0]!;
    expect(
      buildPersonalizedCoursePlan({
        blockId: "block-1",
        revisionId: "revision-1",
        contentHash: "hash",
        candidate,
        result: inspection({
          boxModel: { ...inspection().boxModel, boxSizing: "border-box" },
        }),
      }),
    ).toBeNull();
    expect(
      buildPersonalizedCoursePlan({
        blockId: "block-1",
        revisionId: "revision-1",
        contentHash: "hash",
        candidate,
        result: inspection({ matchedRules: [] }),
      }),
    ).toBeNull();
  });

  it("rejects an earlier duplicate selector when a later rule supplies the computed values", () => {
    const source = revision(
      "#card { width: 280px; padding: 20px; }\n#card { width: 300px; padding: 40px; }",
    );
    const candidates = extractPersonalizedCourseCandidates(source).filter(
      (candidate) => candidate.topic === "box-model",
    );
    const rules: InspectionResult["matchedRules"] = [
      {
        ...inspection().matchedRules[0]!,
        source: { filePath: "styles.css", line: 1, column: 1, kind: "stylesheet" },
        sourceOrder: 0,
      },
      {
        ...inspection().matchedRules[0]!,
        source: { filePath: "styles.css", line: 2, column: 1, kind: "stylesheet" },
        sourceOrder: 1,
        declarations: [
          { property: "width", value: "300px", important: false, inherited: false },
          { property: "padding", value: "40px", important: false, inherited: false },
        ],
      },
    ];
    const runtime = inspection({
      boxModel: {
        ...inspection().boxModel,
        content: { width: 300, height: 112 },
        padding: { top: 40, right: 40, bottom: 40, left: 40 },
      },
      computedStyles: { "padding-top": "40px" },
      matchedRules: rules,
    });
    expect(
      buildPersonalizedCoursePlan({
        blockId: source.blockId,
        revisionId: source.id,
        contentHash: source.contentHash,
        candidate: candidates[0]!,
        result: runtime,
      }),
    ).toBeNull();
    expect(
      buildPersonalizedCoursePlan({
        blockId: source.blockId,
        revisionId: source.id,
        contentHash: source.contentHash,
        candidate: candidates[1]!,
        result: runtime,
      }),
    ).toMatchObject({ source: { line: 2 }, before: { computedValue: "40px" } });
  });

  it("builds grounded Flex and positioning plans from browser facts", () => {
    const flexCandidate = extractPersonalizedCourseCandidates(
      revision("\n.toolbar { display: flex; }"),
    )[0]!;
    const relation = {
      target: { runtimeInstanceId: "runtime-1", domPath: "div.item" },
      domPath: "div.item",
      tagName: "DIV",
      attributes: { class: "item" },
    };
    const flex = buildPersonalizedCoursePlan({
      blockId: "block-1",
      revisionId: "revision-1",
      contentHash: "hash",
      candidate: flexCandidate,
      result: inspection({
        domPath: "div.toolbar",
        computedStyles: { display: "flex", gap: "8px" },
        matchedRules: [{
          ...inspection().matchedRules[0]!,
          selectorText: ".toolbar",
          declarations: [{ property: "display", value: "flex", important: false, inherited: false }],
        }],
        relations: { parent: null, children: [relation, { ...relation, domPath: "div.item:nth-of-type(2)" }] },
      }),
    });
    expect(flex).toMatchObject({ topic: "flex", experiment: { property: "gap", trialValue: "24px" } });

    const positionCandidate = extractPersonalizedCourseCandidates(
      revision("\n.badge { position: absolute; top: 8px; }"),
    )[0]!;
    const positioned = buildPersonalizedCoursePlan({
      blockId: "block-1",
      revisionId: "revision-1",
      contentHash: "hash",
      candidate: positionCandidate,
      result: inspection({
        domPath: "span.badge",
        computedStyles: { position: "absolute", top: "8px" },
        matchedRules: [{
          ...inspection().matchedRules[0]!,
          selectorText: ".badge",
          declarations: [
            { property: "position", value: "absolute", important: false, inherited: false },
            { property: "top", value: "8px", important: false, inherited: false },
          ],
        }],
        relations: { parent: relation, children: [] },
      }),
    });
    expect(positioned).toMatchObject({ topic: "positioning", experiment: { property: "top", trialValue: "24px" } });
  });

  it("requires a new revision, computed trial value, and matched rule before verification", () => {
    const candidate = extractPersonalizedCourseCandidates(
      revision("\n#card { width: 280px; padding: 20px; }"),
    )[0]!;
    const plan = buildPersonalizedCoursePlan({
      blockId: "block-1",
      revisionId: "revision-1",
      contentHash: "hash",
      candidate,
      result: inspection(),
    })!;
    const afterResult = inspection({
      computedStyles: { "padding-top": "36px" },
      matchedRules: [
        ...inspection().matchedRules,
        {
          selectorText: "#card",
          source: {
            filePath: "__ai_tutor_experiments.css",
            line: 1,
            column: 1,
            kind: "stylesheet",
          },
          specificity: [1, 0, 0],
          sourceOrder: 1,
          declarations: [
            { property: "padding", value: "36px", important: true, inherited: false },
          ],
          pseudoElement: null,
        },
      ],
    });
    const verification = verifyPersonalizedCourseExperiment(plan, {
      blockId: "block-1",
      revisionId: "revision-2",
      capturedAt: "2026-08-02T02:00:00.000Z",
      result: afterResult,
    });
    expect(verification).toMatchObject({ revisionId: "revision-2", computedValue: "36px" });
    expect(
      verifyPersonalizedCourseExperiment(plan, {
        blockId: "block-1",
        revisionId: "revision-1",
        capturedAt: "2026-08-02T02:00:00.000Z",
        result: afterResult,
      }),
    ).toBeNull();
    expect(attachPersonalizedCourseVerification(plan, verification!).progress.verification)
      .toEqual(verification);
  });

  it("records formative answers without treating one wrong answer as mastery", () => {
    const candidate = extractPersonalizedCourseCandidates(
      revision("\n#card { width: 280px; padding: 20px; }"),
    )[0]!;
    const plan = buildPersonalizedCoursePlan({
      blockId: "block-1",
      revisionId: "revision-1",
      contentHash: "hash",
      candidate,
      result: inspection(),
    })!;
    const predicted = recordPersonalizedCourseAnswer(plan, "prediction", "outer-same");
    const explained = recordPersonalizedCourseAnswer(
      predicted,
      "explanation",
      "margin-grows-border",
    );
    expect(explained.progress).toMatchObject({
      predictionAnswer: "outer-same",
      explanationAttempts: 1,
      explanationCorrect: false,
    });
  });

  it("keeps a plan valid only on its base revision or a real descendant", () => {
    const root = revision("");
    const child = { ...root, id: "revision-2", parentRevisionId: root.id };
    const sibling = { ...root, id: "revision-3", parentRevisionId: root.id };
    expect(revisionDescendsFrom([root, child, sibling], child.id, root.id)).toBe(true);
    expect(revisionDescendsFrom([root, child, sibling], child.id, sibling.id)).toBe(false);
  });

  it("keeps a plan only while source files match and rejects damaged nested persistence", () => {
    const base = revision("\n#card { width: 280px; padding: 20px; }");
    const candidate = extractPersonalizedCourseCandidates(base)[0]!;
    const plan = buildPersonalizedCoursePlan({
      blockId: base.blockId,
      revisionId: base.id,
      contentHash: base.contentHash,
      candidate,
      result: inspection(),
    })!;
    const experiment = {
      ...base,
      id: "revision-2",
      parentRevisionId: base.id,
      contentHash: "experiment-hash",
      files: {
        ...base.files,
        "__ai_tutor_experiments.css": {
          path: "__ai_tutor_experiments.css",
          mimeType: "text/css",
          content: "#card { padding: 36px !important; }",
          encoding: "utf8" as const,
        },
      },
    };
    const edited = {
      ...experiment,
      id: "revision-3",
      parentRevisionId: experiment.id,
      files: {
        ...experiment.files,
        "styles.css": { ...base.files["styles.css"]!, content: "#card { padding: 5px; }" },
      },
    };
    expect(personalizedCourseSourceUnchanged(plan, [base, experiment], experiment.id)).toBe(true);
    expect(personalizedCourseSourceUnchanged(plan, [base, experiment, edited], edited.id)).toBe(false);
    expect(isPersonalizedCoursePlan({ ...plan, source: { filePath: 42 } })).toBe(false);
  });
});
