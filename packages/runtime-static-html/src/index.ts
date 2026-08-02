import type { RuntimeAdapter, RuntimeOptions } from "@ai-tutor/runtime-core";

import {
  canImportStaticFiles,
  normalizeStaticProject,
} from "./normalization";
import { StaticHtmlRuntime } from "./runtime";
import { STATIC_HTML_RUNTIME_ID } from "./runtime-id";

export { STATIC_HTML_RUNTIME_ID } from "./runtime-id";
export {
  ASSET_TOKEN_PREFIX,
  MAX_IMPORT_FILE_COUNT,
  MAX_IMPORT_FILE_BYTES,
  MAX_IMPORT_TOTAL_BYTES,
  StaticHtmlImportError,
  canImportStaticFiles,
  normalizeImportPath,
  normalizeStaticProject,
  sanitizeCss,
} from "./normalization";
export { buildSandboxDocument } from "./sandbox-document";
export { EXPERIMENT_STYLES_FILE, StaticHtmlRuntime } from "./runtime";

export const staticHtmlRuntimeDescriptor = {
  id: STATIC_HTML_RUNTIME_ID,
  capabilities: {
    html: true,
    css: true,
    javascript: false,
    packageManager: false,
    elementInspection: true,
    transientStyles: true,
  },
} as const;

export const staticHtmlCssAdapter: RuntimeAdapter = {
  ...staticHtmlRuntimeDescriptor,
  canImport: canImportStaticFiles,
  normalize: normalizeStaticProject,
  async createRuntime(project, options: RuntimeOptions) {
    if (project.runtimeType !== STATIC_HTML_RUNTIME_ID) {
      throw new Error(`Unsupported runtime type: ${project.runtimeType}.`);
    }
    const runtime = new StaticHtmlRuntime(project, options);
    if (options.mountTarget) await runtime.mount(options.mountTarget);
    return runtime;
  },
};

export const STATIC_HTML_RUNTIME_IMPLEMENTATION_STATUS = "P5_ACTIVE" as const;
