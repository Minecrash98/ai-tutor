import type { NormalizedProject } from "@ai-tutor/runtime-core";

export function inferDefaultSelector(project: NormalizedProject): string {
  const html = project.files[project.entryFile]?.content ?? "";
  if (/\bid\s*=\s*(["'])demo\1/i.test(html)) return "#demo";

  const idMatch = html.match(/\bid\s*=\s*(["'])([^"']+)\1/i);
  const id = idMatch?.[2];
  if (id && /^[-_a-zA-Z][-_a-zA-Z0-9]*$/.test(id)) return `#${id}`;
  return "body";
}

export function selectorExistsInProject(
  project: NormalizedProject,
  selector: string,
): boolean {
  const html = project.files[project.entryFile]?.content;
  if (!html || typeof DOMParser === "undefined") {
    return selector === inferDefaultSelector(project);
  }

  try {
    const document = new DOMParser().parseFromString(html, "text/html");
    return document.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

export function requireVerifiedProjectSelector(
  project: NormalizedProject,
  selector: string,
): string {
  const candidate = selector.trim();
  if (!candidate || !selectorExistsInProject(project, candidate)) {
    throw new Error(
      `无法在当前页面验证选择器：${candidate || "（空）"}。请重新读取画布后使用真实目标，不要猜测。`,
    );
  }
  return candidate;
}
