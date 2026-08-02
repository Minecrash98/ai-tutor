import type {
  ImportDiagnostic,
  ImportedFile,
  NormalizedProject,
} from "@ai-tutor/runtime-core";
import type { StoredFile } from "@ai-tutor/teaching-model";

import { STATIC_HTML_RUNTIME_ID } from "./runtime-id";

export const MAX_IMPORT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_TOTAL_BYTES = 10 * 1024 * 1024;
export const MAX_IMPORT_FILE_COUNT = 256;
export const ASSET_TOKEN_PREFIX = "__AI_TUTOR_ASSET_";

const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const CSS_EXTENSIONS = new Set([".css"]);
const ASSET_MIME_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".bmp": "image/bmp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const REMOVED_ELEMENTS =
  "script, base, iframe, frame, object, embed, portal, applet";
const URL_ATTRIBUTES = new Set([
  "action",
  "cite",
  "data",
  "formaction",
  "href",
  "poster",
  "src",
  "xlink:href",
]);

function extensionOf(path: string): string {
  const cleanPath = path.split(/[?#]/, 1)[0] ?? path;
  const dotIndex = cleanPath.lastIndexOf(".");
  return dotIndex >= 0 ? cleanPath.slice(dotIndex).toLowerCase() : "";
}

export function normalizeImportPath(input: string): string {
  const slashPath = input.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  const segments: string[] = [];

  for (const segment of slashPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new Error(`Path escapes the imported project: ${input}`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  if (segments.length === 0) {
    throw new Error("Imported file path cannot be empty.");
  }

  return segments.join("/");
}

function resolveImportReference(
  fromPath: string,
  reference: string,
): string | null {
  const trimmed = reference.trim();
  if (
    !trimmed ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("//") ||
    /^[a-z][a-z\d+.-]*:/i.test(trimmed)
  ) {
    return null;
  }

  let decoded = trimmed;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    return null;
  }

  const withoutQuery = decoded.split(/[?#]/, 1)[0] ?? decoded;
  const baseSegments = normalizeImportPath(fromPath).split("/");
  baseSegments.pop();

  try {
    return normalizeImportPath([...baseSegments, withoutQuery].join("/"));
  } catch {
    return null;
  }
}

function isSafeInlineDataUrl(value: string): boolean {
  return /^data:image\/(?:avif|bmp|gif|jpeg|png|webp);base64,/i.test(value);
}

function createAssetToken(index: number): string {
  return `${ASSET_TOKEN_PREFIX}${String(index + 1).padStart(4, "0")}__`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8(file: ImportedFile): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
  } catch {
    throw new Error(`${file.path} is not valid UTF-8 text.`);
  }
}

function escapeCssForStyleElement(css: string): string {
  return css.replace(/</g, "\\3C ");
}

interface SourcePosition {
  readonly line: number;
  readonly column: number;
}

function sourcePositionAt(text: string, index: number): SourcePosition {
  const before = text.slice(0, Math.max(0, index));
  const lines = before.split(/\r?\n/);
  return {
    line: lines.length,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function findInlineStylePositions(html: string): readonly SourcePosition[] {
  const positions: SourcePosition[] = [];
  const pattern = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;

  for (const match of html.matchAll(pattern)) {
    if (match.index === undefined) continue;
    const openingEnd = match[0].indexOf(">") + 1;
    positions.push(sourcePositionAt(html, match.index + openingEnd));
  }

  return positions;
}

interface ReferenceContext {
  readonly sourcePath: string;
  readonly assetByPath: ReadonlyMap<string, string>;
  readonly diagnostics: ImportDiagnostic[];
}

function rewriteReference(
  value: string,
  attributeName: string,
  context: ReferenceContext,
): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#") && attributeName === "href") return trimmed;
  if (isSafeInlineDataUrl(trimmed)) return trimmed;

  const resolved = resolveImportReference(context.sourcePath, trimmed);
  const token = resolved ? context.assetByPath.get(resolved.toLowerCase()) : undefined;
  if (token) return token;

  context.diagnostics.push({
    severity: "warning",
    code: resolved ? "IMPORT_ASSET_NOT_FOUND" : "IMPORT_EXTERNAL_REFERENCE_REMOVED",
    message: resolved
      ? `Removed unresolved local reference: ${trimmed}`
      : `Removed external or unsafe reference: ${trimmed}`,
    filePath: context.sourcePath,
  });
  return attributeName === "href" ? "#" : "";
}

export function sanitizeCss(
  css: string,
  sourcePath: string,
  assetByPath: ReadonlyMap<string, string>,
  diagnostics: ImportDiagnostic[],
): string {
  const withoutImports = css.replace(
    /@import\s+(?:url\(\s*)?(?:"[^"]*"|'[^']*'|[^;)\s]+)\s*\)?[^;]*;/gi,
    () => {
      diagnostics.push({
        severity: "warning",
        code: "IMPORT_CSS_IMPORT_REMOVED",
        message: "Removed CSS @import; imported projects cannot fetch external styles.",
        filePath: sourcePath,
      });
      return "";
    },
  );

  const rewritten = withoutImports.replace(
    /url\(\s*(?:(["'])(.*?)\1|([^)]*?))\s*\)/gi,
    (_match, _quote: string | undefined, quoted: string | undefined, raw: string | undefined) => {
      const reference = (quoted ?? raw ?? "").trim();
      const value = rewriteReference(reference, "src", {
        sourcePath,
        assetByPath,
        diagnostics,
      });
      return value ? `url("${value.replace(/"/g, "%22")}")` : "url(\"\")";
    },
  );

  return escapeCssForStyleElement(rewritten);
}

function sanitizeDocument(
  html: string,
  htmlPath: string,
  cssFiles: readonly { path: string; content: string }[],
  assetByPath: ReadonlyMap<string, string>,
  diagnostics: ImportDiagnostic[],
): string {
  if (typeof DOMParser === "undefined") {
    throw new Error("Static HTML normalization requires a browser DOMParser.");
  }

  const document = new DOMParser().parseFromString(html, "text/html");
  const inlineStylePositions = findInlineStylePositions(html);
  document.querySelectorAll(REMOVED_ELEMENTS).forEach((element) => element.remove());
  document
    .querySelectorAll('meta[http-equiv]')
    .forEach((element) => element.remove());

  for (const element of Array.from(document.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name.startsWith("data-ai-tutor-") ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "ping"
      ) {
        element.removeAttribute(attribute.name);
        continue;
      }
      if (name === "style") {
        element.setAttribute(
          attribute.name,
          sanitizeCss(attribute.value, htmlPath, assetByPath, diagnostics),
        );
        continue;
      }
      if (element.tagName === "LINK" && name === "href") {
        // Stylesheet links are resolved against the imported CSS set below so
        // their exact authored position in the cascade can be preserved.
        continue;
      }
      if (URL_ATTRIBUTES.has(name)) {
        element.setAttribute(
          attribute.name,
          rewriteReference(attribute.value, name, {
            sourcePath: htmlPath,
            assetByPath,
            diagnostics,
          }),
        );
      }
    }
  }

  document.querySelectorAll("style").forEach((styleElement, index) => {
    const position = inlineStylePositions[index] ?? { line: 1, column: 1 };
    styleElement.dataset.aiTutorSource = htmlPath;
    styleElement.dataset.aiTutorBaseLine = String(position.line);
    styleElement.dataset.aiTutorBaseColumn = String(position.column);
    styleElement.textContent = sanitizeCss(
      styleElement.textContent ?? "",
      htmlPath,
      assetByPath,
      diagnostics,
    );
  });

  const cssByPath = new Map(
    cssFiles.map((cssFile) => [cssFile.path.toLowerCase(), cssFile]),
  );
  const linkedCssPaths = new Set<string>();
  document.querySelectorAll("link").forEach((linkElement) => {
    const rel = new Set(
      (linkElement.getAttribute("rel") ?? "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean),
    );
    if (!rel.has("stylesheet")) {
      linkElement.remove();
      return;
    }
    const href = linkElement.getAttribute("href") ?? "";
    const resolved = resolveImportReference(htmlPath, href);
    const cssFile = resolved
      ? cssByPath.get(resolved.toLowerCase())
      : undefined;
    if (!cssFile) {
      diagnostics.push({
        severity: "warning",
        code: "IMPORT_STYLESHEET_REMOVED",
        message: `Removed external or missing stylesheet: ${href || "(no href)"}`,
        filePath: htmlPath,
      });
      linkElement.remove();
      return;
    }
    const styleElement = document.createElement("style");
    styleElement.dataset.aiTutorSource = cssFile.path;
    styleElement.dataset.aiTutorBaseLine = "1";
    styleElement.dataset.aiTutorBaseColumn = "1";
    const media = linkElement.getAttribute("media");
    if (media) styleElement.setAttribute("media", media);
    styleElement.textContent = sanitizeCss(
      cssFile.content,
      cssFile.path,
      assetByPath,
      diagnostics,
    );
    linkedCssPaths.add(cssFile.path.toLowerCase());
    linkElement.replaceWith(styleElement);
  });

  for (const cssFile of cssFiles) {
    if (linkedCssPaths.has(cssFile.path.toLowerCase())) continue;
    const styleElement = document.createElement("style");
    styleElement.dataset.aiTutorSource = cssFile.path;
    styleElement.dataset.aiTutorBaseLine = "1";
    styleElement.dataset.aiTutorBaseColumn = "1";
    styleElement.textContent = sanitizeCss(
      cssFile.content,
      cssFile.path,
      assetByPath,
      diagnostics,
    );
    document.head.append(styleElement);
  }

  return `<!doctype html>\n${document.documentElement.outerHTML}`;
}

export class StaticHtmlImportError extends Error {
  constructor(readonly diagnostics: readonly ImportDiagnostic[]) {
    super(
      diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join(" "),
    );
    this.name = "StaticHtmlImportError";
  }
}

function fail(code: string, message: string, filePath?: string): ImportDiagnostic {
  return filePath
    ? { severity: "error", code, message, filePath }
    : { severity: "error", code, message };
}

export function canImportStaticFiles(files: readonly ImportedFile[]): boolean {
  if (files.length === 0 || files.length > MAX_IMPORT_FILE_COUNT) return false;
  const htmlCount = files.filter((file) =>
    HTML_EXTENSIONS.has(extensionOf(file.path)),
  ).length;
  return (
    htmlCount === 1 &&
    files.every((file) => {
      const extension = extensionOf(file.path);
      return (
        HTML_EXTENSIONS.has(extension) ||
        CSS_EXTENSIONS.has(extension) ||
        extension in ASSET_MIME_TYPES
      );
    })
  );
}

export async function normalizeStaticProject(
  importedFiles: readonly ImportedFile[],
): Promise<NormalizedProject> {
  const diagnostics: ImportDiagnostic[] = [];
  if (importedFiles.length > MAX_IMPORT_FILE_COUNT) {
    throw new StaticHtmlImportError([
      fail(
        "IMPORT_TOO_MANY_FILES",
        `Imported project has more than ${MAX_IMPORT_FILE_COUNT} files.`,
      ),
    ]);
  }
  const normalizedFiles: { file: ImportedFile; path: string; extension: string }[] = [];
  const seenPaths = new Set<string>();
  let totalBytes = 0;

  for (const file of importedFiles) {
    let path: string;
    try {
      path = normalizeImportPath(file.path);
    } catch (error) {
      diagnostics.push(
        fail(
          "IMPORT_INVALID_PATH",
          error instanceof Error ? error.message : "Invalid import path.",
          file.path,
        ),
      );
      continue;
    }

    const pathKey = path.toLowerCase();
    if (seenPaths.has(pathKey)) {
      diagnostics.push(
        fail("IMPORT_DUPLICATE_PATH", `Duplicate imported path: ${path}`, path),
      );
      continue;
    }
    seenPaths.add(pathKey);

    const extension = extensionOf(path);
    if (
      !HTML_EXTENSIONS.has(extension) &&
      !CSS_EXTENSIONS.has(extension) &&
      !(extension in ASSET_MIME_TYPES)
    ) {
      diagnostics.push(
        fail(
          "IMPORT_UNSUPPORTED_FILE",
          `Unsupported file type: ${path}. JavaScript is never accepted.`,
          path,
        ),
      );
      continue;
    }

    totalBytes += file.bytes.byteLength;
    if (file.bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
      diagnostics.push(
        fail("IMPORT_FILE_TOO_LARGE", `${path} exceeds the 2 MB file limit.`, path),
      );
    }
    normalizedFiles.push({ file, path, extension });
  }

  if (totalBytes > MAX_IMPORT_TOTAL_BYTES) {
    diagnostics.push(
      fail("IMPORT_TOTAL_TOO_LARGE", "Imported project exceeds the 10 MB total limit."),
    );
  }

  const htmlFiles = normalizedFiles.filter(({ extension }) =>
    HTML_EXTENSIONS.has(extension),
  );
  if (htmlFiles.length !== 1) {
    diagnostics.push(
      fail("IMPORT_HTML_ENTRY_COUNT", "Import exactly one .html or .htm entry file."),
    );
  }

  if (diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    throw new StaticHtmlImportError(diagnostics);
  }

  const storedFiles: Record<string, StoredFile> = {};
  const assetManifest: Record<string, { token: string; mimeType: string }> = {};
  const assetByPath = new Map<string, string>();
  let assetIndex = 0;

  for (const { file, path, extension } of normalizedFiles) {
    if (HTML_EXTENSIONS.has(extension) || CSS_EXTENSIONS.has(extension)) continue;
    const token = createAssetToken(assetIndex++);
    const mimeType = file.mimeType || ASSET_MIME_TYPES[extension] || "application/octet-stream";
    storedFiles[path] = {
      path,
      mimeType,
      content: bytesToBase64(file.bytes),
      encoding: "base64",
    };
    assetManifest[path] = { token, mimeType };
    assetByPath.set(path.toLowerCase(), token);
  }

  const cssFiles = normalizedFiles
    .filter(({ extension }) => CSS_EXTENSIONS.has(extension))
    .map(({ file, path }) => ({ path, content: decodeUtf8(file) }));
  const htmlFile = htmlFiles[0];
  if (!htmlFile) throw new StaticHtmlImportError(diagnostics);

  for (const cssFile of cssFiles) {
    storedFiles[cssFile.path] = {
      path: cssFile.path,
      mimeType: "text/css",
      content: cssFile.content,
      encoding: "utf8",
    };
  }

  const sanitizedHtml = sanitizeDocument(
    decodeUtf8(htmlFile.file),
    htmlFile.path,
    cssFiles,
    assetByPath,
    diagnostics,
  );
  storedFiles[htmlFile.path] = {
    path: htmlFile.path,
    mimeType: "text/html",
    content: sanitizedHtml,
    encoding: "utf8",
  };

  diagnostics.unshift({
    severity: "info",
    code: "IMPORT_NORMALIZED",
    message: `Normalized ${normalizedFiles.length} files without executing JavaScript.`,
  });

  return Object.freeze({
    runtimeType: STATIC_HTML_RUNTIME_ID,
    entryFile: htmlFile.path,
    files: Object.freeze(storedFiles),
    assetManifest: Object.freeze(assetManifest),
    diagnostics: Object.freeze(diagnostics),
  });
}
