import { describe, expect, it } from "vitest";

import type {
  ImportDiagnostic,
  NormalizedProject,
} from "@ai-tutor/runtime-core";

import {
  buildSandboxDocument,
  canImportStaticFiles,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_FILE_COUNT,
  MAX_IMPORT_TOTAL_BYTES,
  normalizeImportPath,
  normalizeStaticProject,
  sanitizeCss,
  staticHtmlRuntimeDescriptor,
} from "./index";

const encoder = new TextEncoder();

describe("static HTML/CSS runtime", () => {
  it("accepts one HTML entry with CSS/assets and rejects JavaScript", () => {
    expect(
      canImportStaticFiles([
        { path: "index.html", mimeType: "text/html", bytes: encoder.encode("") },
        { path: "styles.css", mimeType: "text/css", bytes: encoder.encode("") },
        { path: "logo.png", mimeType: "image/png", bytes: new Uint8Array() },
      ]),
    ).toBe(true);
    expect(
      canImportStaticFiles([
        { path: "index.html", mimeType: "text/html", bytes: encoder.encode("") },
        { path: "app.js", mimeType: "text/javascript", bytes: encoder.encode("") },
      ]),
    ).toBe(false);
  });

  it("normalizes project paths without allowing traversal", () => {
    expect(normalizeImportPath("demo\\assets/../index.html")).toBe(
      "demo/index.html",
    );
    expect(() => normalizeImportPath("../secret.html")).toThrow(
      "escapes the imported project",
    );
  });

  it("rejects traversal and empty-path fuzz cases deterministically", () => {
    const invalidPaths = [
      "",
      ".",
      "..",
      "../secret.html",
      "..\\secret.html",
      "a/../../secret.html",
      "////",
    ];
    for (const path of invalidPaths) {
      expect(() => normalizeImportPath(path), path).toThrow();
    }

    const validPaths = [
      ["./index.html", "index.html"],
      ["a//b/../index.html", "a/index.html"],
      ["\\demo\\style.css", "demo/style.css"],
      ["assets/.hidden.png", "assets/.hidden.png"],
    ] as const;
    for (const [path, expected] of validPaths) {
      expect(normalizeImportPath(path), path).toBe(expected);
    }
  });

  it("rejects file-count and single-file resource bombs before DOM parsing", async () => {
    const tooMany = Array.from({ length: MAX_IMPORT_FILE_COUNT + 1 }, (_, index) => ({
      path: index === 0 ? "index.html" : `asset-${index}.png`,
      mimeType: index === 0 ? "text/html" : "image/png",
      bytes: new Uint8Array(),
    }));
    await expect(normalizeStaticProject(tooMany)).rejects.toThrow(
      `more than ${MAX_IMPORT_FILE_COUNT} files`,
    );

    await expect(
      normalizeStaticProject([
        {
          path: "index.html",
          mimeType: "text/html",
          bytes: encoder.encode("<!doctype html><html><body></body></html>"),
        },
        {
          path: "oversized.png",
          mimeType: "image/png",
          bytes: new Uint8Array(MAX_IMPORT_FILE_BYTES + 1),
        },
      ]),
    ).rejects.toThrow("exceeds the 2 MB file limit");

    const totalBomb = [
      {
        path: "index.html",
        mimeType: "text/html",
        bytes: encoder.encode("<!doctype html><html><body></body></html>"),
      },
      ...Array.from({ length: 6 }, (_, index) => ({
        path: `asset-${index}.png`,
        mimeType: "image/png",
        bytes: new Uint8Array(Math.floor(MAX_IMPORT_TOTAL_BYTES / 6) + 1),
      })),
    ];
    await expect(normalizeStaticProject(totalBomb)).rejects.toThrow(
      "exceeds the 10 MB total limit",
    );
  });

  it("removes CSS imports and rewrites local assets to opaque tokens", () => {
    const diagnostics: ImportDiagnostic[] = [];
    const css = sanitizeCss(
      '@import "https://example.com/x.css"; .hero{background:url("../img/a.png")}',
      "css/main.css",
      new Map([["img/a.png", "__AI_TUTOR_ASSET_0001__"]]),
      diagnostics,
    );
    expect(css).not.toContain("@import");
    expect(css).toContain("__AI_TUTOR_ASSET_0001__");
    expect(diagnostics).toHaveLength(1);
  });

  it("builds a minimal sandbox document with CSP and only the bridge nonce", () => {
    const project: NormalizedProject = {
      runtimeType: "static-html-css",
      entryFile: "index.html",
      files: {
        "index.html": {
          path: "index.html",
          mimeType: "text/html",
          content:
            '<!doctype html><html><head></head><body><img src="__AI_TUTOR_ASSET_0001__"></body></html>',
          encoding: "utf8",
        },
        "dot.png": {
          path: "dot.png",
          mimeType: "image/png",
          content: "AA==",
          encoding: "base64",
        },
      },
      assetManifest: {
        "dot.png": {
          token: "__AI_TUTOR_ASSET_0001__",
          mimeType: "image/png",
        },
      },
      diagnostics: [],
    };
    const document = buildSandboxDocument(project, "runtime-1", "nonce123");
    expect(document).toContain("default-src 'none'");
    expect(document).toContain("connect-src 'none'");
    expect(document).toContain('script nonce="nonce123"');
    expect(document).toContain("data:image/png;base64,AA==");
    expect(document).not.toContain("__AI_TUTOR_ASSET_0001__");
    expect(document).toContain("runtime.enable_selection");
    expect(document).toContain("runtime.element_selected");
    expect(document).toContain('addEventListener("pointerup"');
    expect(document).toContain("suppressSelectionClick");
    expect(document).toContain("runtime.apply_transient_style");
    expect(document).toContain("runtime.reset_transient_state");
    expect(document).toContain("Color controls require a six-digit hex color.");
    const transientHandler = document.match(
      /case "runtime\.apply_transient_style":[\s\S]*?break;/,
    )?.[0];
    expect(transientHandler).toContain("if (selectedElement === element)");
    expect(transientHandler).not.toContain("emitCurrentInspection");
    expect(transientHandler).not.toContain("selectedElement = element");
    expect(transientHandler).not.toContain("selectedTarget = targetFor");
    expect(document).toContain("runtime.set_box_model_overlay");
    expect(document).toContain("runtime.set_comparison_viewport");
    expect(document).toContain("runtime.comparison_viewport_set");
    expect(document).toContain("scrollIntoView");
    expect(document).toContain("data-ai-tutor-overlay");
    const bridge = document.match(
      /<script nonce="nonce123">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(bridge).toBeTruthy();
    expect(() => new Function(bridge ?? "")).not.toThrow();
  });

  it("declares P5 element inspection and transient style support", () => {
    expect(staticHtmlRuntimeDescriptor.capabilities.elementInspection).toBe(
      true,
    );
    expect(staticHtmlRuntimeDescriptor.capabilities.transientStyles).toBe(true);
  });
});
