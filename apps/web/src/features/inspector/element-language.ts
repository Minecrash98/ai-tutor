import type { InspectionResult } from "@ai-tutor/runtime-core";

type ElementClues = Pick<
  InspectionResult,
  "attributes" | "domPath" | "tagName"
>;

const TAG_LABELS: Readonly<Record<string, string>> = {
  html: "页面",
  body: "页面内容",
  main: "主要内容",
  header: "页头",
  footer: "页尾",
  nav: "导航",
  section: "内容区域",
  article: "内容卡片",
  aside: "补充内容",
  div: "内容区域",
  span: "文字",
  p: "段落",
  h1: "一级标题",
  h2: "二级标题",
  h3: "三级标题",
  button: "按钮",
  a: "链接",
  img: "图片",
  input: "输入框",
  form: "表单",
  ul: "列表",
  ol: "列表",
  li: "列表项",
};

const CLUE_LABELS: readonly [RegExp, string][] = [
  [/\b(lesson|course)\b/i, "课程卡片"],
  [/\b(toolbar|tools|actions?)\b/i, "工具栏"],
  [/\b(notice|alert|message|tip)\b/i, "提示卡片"],
  [/\b(card|panel|tile)\b/i, "内容卡片"],
  [/\b(badge|tag|label)\b/i, "标签"],
  [/\b(hero|banner)\b/i, "头图区域"],
  [/\b(nav|menu)\b/i, "导航"],
];

const ORDINALS: Readonly<Record<number, string>> = {
  1: "第一",
  2: "第二",
  3: "第三",
  4: "第四",
  5: "第五",
  6: "第六",
  7: "第七",
  8: "第八",
  9: "第九",
  10: "第十",
};

function withOrdinal(label: string, selector: string): string {
  const index = Number(selector.match(/:nth-of-type\((\d+)\)/)?.[1]);
  if (!Number.isInteger(index) || index < 1) return label;
  const ordinal = ORDINALS[index] ?? `第 ${index}`;
  const classifier = label.includes("卡片") ? "张" : "个";
  return `${ordinal}${classifier}${label}`;
}

function labelFromSelector(selector: string): string {
  const clue = CLUE_LABELS.find(([pattern]) => pattern.test(selector));
  if (clue) return withOrdinal(clue[1], selector);
  const tag = selector
    .trim()
    .match(/^[a-z][a-z0-9-]*/i)?.[0]
    ?.toLowerCase();
  return withOrdinal((tag && TAG_LABELS[tag]) || "内容区域", selector);
}

export function studentElementLabel(result: ElementClues): string {
  const ariaLabel = result.attributes["aria-label"]?.trim();
  const accessibleClue = ariaLabel
    ? CLUE_LABELS.find(([pattern]) => pattern.test(ariaLabel))
    : undefined;
  if (accessibleClue) return accessibleClue[1];
  if (ariaLabel && ariaLabel.length <= 40 && /[\u3400-\u9fff]/u.test(ariaLabel)) {
    return ariaLabel;
  }

  const clueText = [
    result.attributes.id,
    result.attributes.class,
    result.domPath.split(">").at(-1),
  ]
    .filter(Boolean)
    .join(" ");
  const clue = CLUE_LABELS.find(([pattern]) => pattern.test(clueText));
  const selector = result.domPath.split(/\s*>\s*/).at(-1) ?? "";
  if (clue) return withOrdinal(clue[1], selector);
  return withOrdinal(
    TAG_LABELS[result.tagName.toLowerCase()] || "页面内容",
    selector,
  );
}

export function studentElementLabelIsInferred(result: ElementClues): boolean {
  const ariaLabel = result.attributes["aria-label"]?.trim();
  return !(
    ariaLabel &&
    ariaLabel.length <= 40 &&
    /[\u3400-\u9fff]/u.test(ariaLabel)
  );
}

export interface StudentElementBreadcrumbItem {
  readonly label: string;
  readonly domPath: string;
  readonly current: boolean;
}

export function studentElementBreadcrumbItems(
  result: ElementClues,
): readonly StudentElementBreadcrumbItem[] {
  const segments = result.domPath.split(/\s*>\s*/).filter(Boolean);
  return segments.map((segment, index) => ({
    label:
      index === segments.length - 1
        ? studentElementLabel(result)
        : labelFromSelector(segment),
    domPath: segments.slice(0, index + 1).join(" > "),
    current: index === segments.length - 1,
  }));
}

export function studentElementBreadcrumb(
  result: ElementClues,
): readonly string[] {
  const labels = studentElementBreadcrumbItems(result).map(
    (item) => item.label,
  );
  if (labels.length === 0) return [studentElementLabel(result)];
  return labels.filter((label, index) => index === 0 || label !== labels[index - 1]);
}

const STYLE_VALUE_LABELS: Readonly<
  Record<string, Readonly<Record<string, string>>>
> = {
  display: {
    block: "单独占一行",
    inline: "跟着文字排列",
    "inline-block": "跟着文字排列，也能设宽高",
    flex: "弹性排列",
    grid: "网格排列",
    none: "暂时隐藏",
  },
  position: {
    static: "跟随页面自然排列",
    relative: "从原来的位置微调",
    absolute: "相对最近的定位容器移动",
    fixed: "固定在屏幕上",
    sticky: "滚动到边缘后停住",
  },
  "box-sizing": {
    "content-box": "宽度只算内容，内侧空隙另加",
    "border-box": "宽度包含内侧空隙和边框",
  },
  "justify-content": {
    "flex-start": "从开头排列",
    center: "居中排列",
    "space-between": "两端贴边，中间等距",
    "space-around": "每项两侧留出空隙",
  },
};

export function studentStyleValue(property: string, value: string): string {
  return STYLE_VALUE_LABELS[property]?.[value] ?? (value || "—");
}
