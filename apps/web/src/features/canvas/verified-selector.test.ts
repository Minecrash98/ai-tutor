import type { NormalizedProject } from "@ai-tutor/runtime-core";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  inferDefaultSelector,
  requireVerifiedProjectSelector,
} from "./verified-selector";

const project = {
  runtimeType: "static-html-css",
  entryFile: "index.html",
  files: {
    "index.html": {
      path: "index.html",
      mimeType: "text/html",
      content: '<main id="demo"><article class="card">内容</article></main>',
    },
  },
  diagnostics: [],
} as unknown as NormalizedProject;

afterEach(() => vi.unstubAllGlobals());

describe("verified project selector", () => {
  it("keeps the deterministic default selector", () => {
    expect(inferDefaultSelector(project)).toBe("#demo");
  });

  it("returns only the exact selector confirmed by the parsed document", () => {
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return {
            querySelector: (selector: string) =>
              selector === ".card" ? { nodeName: "ARTICLE" } : null,
          };
        }
      },
    );
    expect(requireVerifiedProjectSelector(project, " .card ")).toBe(".card");
  });

  it("rejects an absent or malformed selector instead of guessing a fallback", () => {
    vi.stubGlobal(
      "DOMParser",
      class {
        parseFromString() {
          return { querySelector: () => null };
        }
      },
    );
    expect(() => requireVerifiedProjectSelector(project, "#invented"))
      .toThrow("不要猜测");
    expect(() => requireVerifiedProjectSelector(project, " ")).toThrow(
      "不要猜测",
    );
  });
});
