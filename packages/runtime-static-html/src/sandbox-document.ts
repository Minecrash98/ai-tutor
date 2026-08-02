import type { NormalizedProject } from "@ai-tutor/runtime-core";

import { createInspectionBridgeScript } from "./inspection-bridge";

function materializeAssets(
  html: string,
  project: NormalizedProject,
): string {
  let result = html;
  for (const [path, asset] of Object.entries(project.assetManifest)) {
    const storedFile = project.files[path];
    if (!storedFile || storedFile.encoding !== "base64") continue;
    const dataUrl = `data:${asset.mimeType};base64,${storedFile.content}`;
    result = result.split(asset.token).join(dataUrl);
  }
  return result;
}

export function buildSandboxDocument(
  project: NormalizedProject,
  runtimeInstanceId: string,
  nonce: string,
): string {
  const entryFile = project.files[project.entryFile];
  if (!entryFile || entryFile.mimeType !== "text/html") {
    throw new Error("Static runtime entry file is missing or is not HTML.");
  }

  const csp = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    "img-src data:",
    "media-src data:",
    "object-src 'none'",
    `script-src 'nonce-${nonce}'`,
    "style-src 'unsafe-inline'",
  ].join("; ");
  const bridge = createInspectionBridgeScript(
    runtimeInstanceId,
    project.entryFile,
  );
  const headInjection =
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<meta name="referrer" content="no-referrer">' +
    '<style data-ai-tutor-internal="true">html[data-ai-tutor-runtime="paused"] *,html[data-ai-tutor-runtime="paused"] *::before,html[data-ai-tutor-runtime="paused"] *::after{animation-play-state:paused!important}</style>';
  const bodyInjection = `<script nonce="${nonce}">${bridge}<\/script>`;
  const materialized = materializeAssets(entryFile.content, project);

  return materialized
    .replace(/<head([^>]*)>/i, `<head$1>${headInjection}`)
    .replace(/<\/body>/i, `${bodyInjection}</body>`);
}
