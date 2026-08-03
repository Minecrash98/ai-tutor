"use client";

import { useEffect } from "react";

const EXACT_TEXT = new Map<string, string>([
  ["CSS 学习画布", "AI Tutor Canvas"],
  ["边看边试，马上理解", "See it. Change it. Explain it."],
  ["当前任务", "Current task"],
  ["个内容", " content blocks"],
  ["个实验", " experiments"],
  ["今天的第一步", "START HERE"],
  ["先完成一节小课", "Learn through a real page"],
  ["不用准备文件，也可以直接从盒模型开始。", "Import HTML and CSS, make a prediction, then test it."],
  ["学一个概念", "Learn a concept"],
  ["修一个页面", "Fix a page"],
  ["继续上次学习", "Continue learning"],
  ["我的页面", "YOUR PAGE"],
  ["正在载入…", "Importing…"],
  ["载入我的页面", "Import HTML + CSS"],
  ["选择 HTML 和 CSS 文件", "Choose HTML and CSS files"],
  ["随时问我", "ASK WHILE YOU WORK"],
  ["AI 学习搭档", "AI Tutor"],
  ["想学什么", "Topic"],
  ["内容周围的空隙", "CSS variables"],
  ["全局颜色变量", "Global color variables"],
  ["横向排列与间距", "Flexbox"],
  ["把元素放到指定位置", "Positioning"],
  ["可以开始", "Ready"],
  ["正在检查连接", "Checking connection"],
  ["准备语音", "Preparing voice"],
  ["马上就好", "Connecting"],
  ["正在陪你学", "Connected"],
  ["正在听你说", "Listening"],
  ["正在想", "Thinking"],
  ["正在调整画布", "Checking the canvas"],
  ["正在讲解", "Explaining"],
  ["正在恢复", "Reconnecting"],
  ["本次已结束", "Session ended"],
  ["暂时不可用", "Temporarily unavailable"],
  ["开始文字问答", "Start text chat"],
  ["开始语音讲解", "Start voice session"],
  ["立即停止", "Stop session"],
  ["结束", "Stop session"],
  ["关闭麦克风", "Mute microphone"],
  ["打开麦克风", "Unmute microphone"],
  ["正在连接文字问答…", "Connecting text chat…"],
  ["试着问：“怎么让卡片里面更宽松？”", "Ask a question about the imported page."],
  ["你", "Student"],
  ["发送", "Send"],
  ["现在做什么", "WHAT TO DO NOW"],
  ["现在开始第一课；一次点击进入预测", "Import a page, predict the effect, then test it."],
  ["空白画布已就绪", "Blank canvas ready"],
  ["页面已载入，可以开始调整", "Page imported. Select, inspect, or edit it."],
  ["HTML/CSS 新版本已保存，之前的版本仍可切回", "New HTML/CSS version saved. The original remains available."],
  ["已显示全部画布内容", "All canvas content is in view."],
  ["已聚焦当前选择", "Focused current selection"],
  ["收起", "Collapse"],
  ["展开", "Expand"],
  ["打开当前小课", "Open current lesson"],
  ["撤销", "Undo"],
  ["重做", "Redo"],
  ["删除所选", "Delete selected"],
  ["暂时收起小课", "Hide lessons"],
  ["继续小课", "Show lessons"],
  ["整理成组", "Group"],
  ["连接内容", "Connect"],
  ["取消连接", "Cancel connection"],
  ["回到内容", "Fit content"],
  ["确认清空", "Confirm clear"],
  ["清空", "Clear"],
  ["还没有页面", "No page yet"],
  ["从左侧载入 HTML 和 CSS", "Import HTML and CSS from the left"],
  ["编辑 HTML/CSS", "Edit HTML/CSS"],
  ["取消选择", "Cancel selection"],
  ["换一个", "Choose another"],
  ["选择页面内容", "Select page element"],
  ["可互动", "Interactive"],
  ["准备中", "Preparing"],
  ["安全源码编辑", "SAFE SOURCE EDITOR"],
  ["编辑 HTML 和 CSS", "Edit HTML and CSS"],
  ["这里编辑的是导入后可安全运行的版本，不包含被移除的脚本。", "Edit the normalized files that run inside the sandbox."],
  ["先运行修改；确认安全预览后，才能保存为新版本。", "Run the draft first. Save only after the safe preview succeeds."],
  ["修改 HTML/CSS", "Update HTML/CSS"],
  ["内容已变化，请重新运行后再保存。", "Content changed. Run the draft again before saving."],
  ["正在检查并准备安全预览…", "Validating and preparing a safe preview…"],
  ["这份修改已在隔离预览中运行，可以保存为新版本。", "The change passed in an isolated preview and can be saved."],
  ["正在保存新版本…", "Saving a new version…"],
  ["新版本已保存，旧版本仍可随时切回。", "New version saved. The original remains available."],
  ["刚才的修改", "Latest changes"],
  ["上一次安全运行结果", "Previous safe run"],
  ["有错误时，这里不会被破坏。", "Errors never replace the last safe preview."],
  ["这次修改叫什么", "Name this version"],
  ["放弃修改", "Discard draft"],
  ["正在运行…", "Running…"],
  ["运行修改", "Run changes"],
  ["保存为新版本", "Save as new version"],
  ["并排", "Side by side"],
  ["揭示", "Wipe"],
  ["完整源码", "Full source"],
  ["实验改动", "Experiment diff"],
  ["修改前", "Before"],
  ["修改后", "After"],
  ["看变化位置", "Focus change"],
  ["看整页", "Full page"],
  ["对比", "Compare"],
  ["看看修改前后", "See before and after"],
  ["这次没有可靠的变化位置，正在展示整页。", "No reliable change target was recorded, so the full page is shown."],
  ["整页同步位置", "Synced full-page position"],
  ["查看这句话为什么成立", "Why this answer is grounded"],
  ["查看还缺少什么", "What evidence is missing"],
  ["页面里的位置", "Target on page"],
  ["刚才的变化", "Observed change"],
  ["页面命中的样式", "Matched rule"],
  ["从哪里找到", "Source"],
  ["样式", "style"],
  ["未记录", "not recorded"],
  ["当前目标", "current target"],
  ["已核对", "verified"],
  ["当前页面的样式规则", "current page stylesheet"],
  ["刚才没有改动你的内容", "Your page was not changed"],
  ["重试", "Retry"],
  ["教学块库", "Learning tools"],
  ["开始学习", "Start learning"],
  ["教学主题", "Learning topic"],
  ["请先选择按住说话或持续聆听", "Choose a voice input mode first"],
  ["文字询问 CSS 问题", "Ask a CSS question"],
  ["也可以输入问题…", "Type a question…"],
  ["无限教学画布", "Learning canvas"],
  ["学习任务路线", "Learning path"],
  ["收起学习任务路线", "Collapse learning path"],
  ["展开学习任务路线", "Expand learning path"],
  ["画布快捷操作", "Canvas shortcuts"],
  ["将焦点移至画布", "Focus canvas"],
  ["上传静态 HTML 和 CSS 文件", "Upload static HTML and CSS files"],
  ["关闭源码编辑器", "Close source editor"],
  ["源码文件", "Source files"],
  ["源码问题", "Source issues"],
  ["版本说明", "Version name"],
  ["实验", "Experiment"],
  ["调节", "Color control"],
  ["隔离 HTML/CSS 运行结果", "Sandboxed HTML/CSS result"],
  ["旋转", "Rotate"],
  ["实验页面", "Experiment page"],
  ["已载入 index.html，可以从源码和实际页面生成一个最小实验。", "Imported index.html. Inspect the source and the live page."],
  ["已载入 2 个文件，可以开始点选和调整页面。", "Imported 2 files. Select, inspect, or edit the page."],
  ["这次变化已保存，之前的样子也还在", "Change saved. The original remains available."],
  ["这次变化已经保存过，没有重复建立版本", "This saved version already exists."],
  ["AI 已添加 --brand 控制器", "AI added the brand color control."],
  ["画布已经更新，你可以先看看。", "The canvas is updated—take a look."],
  ["修改后 · 未保存预览", "After · Unsaved preview"],
  ["修改前目标尺寸", "Before target size"],
  ["修改后目标尺寸", "After target size"],
  ["目标无法在此版本中同步", "The target is unavailable in this version."],
  ["保存两次变化后，就可以在这里一起看。", "Save two changes to compare them here."],
  ["这组修改记录已经找不到了。", "This comparison is no longer available."],
  ["这里按文件比较完整 HTML/CSS 源码。", "This view compares the complete HTML/CSS source by file."],
  ["这里只比较这次实验追加的样式，不是完整源码。", "This view compares only the styles added by this experiment."],
  ["完整 HTML 和 CSS 源码差异", "Complete HTML and CSS source diff"],
  ["实验样式差异（不是完整源码）", "Experiment style diff"],
  ["前后页面高度不同，底部位置会各自到达边界。", "Page heights differ, so each side reaches its own lower boundary."],
  ["前后查看比例", "Before and after reveal"],
  ["修改前 · 未保存预览", "Before · Unsaved preview"],
]);

const PARTIAL_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["正在整理 ", "Preparing "],
  [" 个文件…", " files…"],
  ["编辑 ", "Edit "],
  [" 语法着色预览", " syntax-highlighted preview"],
  ["个内容", " content blocks"],
  ["个实验", " experiments"],
  ["导入 · ", "Import · "],
  ["AI 已添加 ", "AI added "],
  [" 控制器", " control"],
];

const ATTRIBUTE_NAMES = ["aria-label", "title", "placeholder"] as const;
const CJK_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/u;

function translateValue(value: string): string {
  const trimmed = value.trim();
  if (/^AI 已聚焦 .+$/u.test(trimmed)) {
    return value.replace(trimmed, "AI focused the requested content.");
  }
  if (/^已聚焦教学块 .+。?$/u.test(trimmed)) {
    return value.replace(trimmed, "Focused the requested content.");
  }
  const exact = EXACT_TEXT.get(trimmed);
  if (exact !== undefined) {
    return value.replace(trimmed, exact);
  }
  let translated = value;
  for (const [from, to] of PARTIAL_TEXT) {
    translated = translated.replaceAll(from, to);
  }
  return translated;
}

function translateElement(element: Element) {
  for (const attribute of ATTRIBUTE_NAMES) {
    const current = element.getAttribute(attribute);
    if (!current || !CJK_PATTERN.test(current)) continue;
    element.setAttribute(attribute, translateValue(current));
  }
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType !== Node.TEXT_NODE || !child.textContent) continue;
    if (!CJK_PATTERN.test(child.textContent)) continue;
    child.textContent = translateValue(child.textContent);
  }
  if (
    (element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement) &&
    CJK_PATTERN.test(element.value)
  ) {
    element.value = translateValue(element.value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

function translateTree(root: ParentNode) {
  if (root instanceof Element) translateElement(root);
  for (const element of root.querySelectorAll("*")) {
    translateElement(element);
  }
}

function translatePageAttributes() {
  for (const element of document.querySelectorAll(
    "[aria-label], [title], [placeholder]",
  )) {
    for (const attribute of ATTRIBUTE_NAMES) {
      const current = element.getAttribute(attribute);
      if (!current || !CJK_PATTERN.test(current)) continue;
      element.setAttribute(attribute, translateValue(current));
    }
  }
}

export function EnglishDemoPresentation() {
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("lang") !== "en" || query.get("demo") !== "css-vars") return;
    const root = document.documentElement;
    root.lang = "en";
    root.dataset.aiTutorDemoEn = "true";
    document.title = "AI Tutor — CSS Variables Lab";
    const presentationRoots = [
      ".canvas-app__header",
      ".block-library__intro",
      ".static-import",
      ".realtime-tutor",
      ".student-task-shell",
      ".canvas-actionbar",
      ".teaching-block__runtime",
      ".teaching-block",
      ".comparison-runtime",
      ".source-editor-layer",
      "button",
      "[role='button']",
    ];
    const translatePresentation = () => {
      document.title = "AI Tutor — CSS Variables Lab";
      for (const selector of presentationRoots) {
        for (const element of document.querySelectorAll(selector)) {
          translateTree(element);
        }
      }
      translatePageAttributes();
    };
    const demoWindow = window as Window & {
      __refreshAiTutorEnglishDemo?: () => void;
    };
    demoWindow.__refreshAiTutorEnglishDemo = translatePresentation;
    let frame = 0;
    const scheduleTranslation = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        translatePresentation();
      });
    };
    translatePresentation();
    const observer = new MutationObserver(scheduleTranslation);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: [...ATTRIBUTE_NAMES],
      childList: true,
      characterData: true,
      subtree: true,
    });
    return () => {
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      delete demoWindow.__refreshAiTutorEnglishDemo;
      delete root.dataset.aiTutorDemoEn;
    };
  }, []);

  return (
    <style>{`
      html[data-ai-tutor-demo-en="true"] .block-library > :not(.block-library__intro):not(.static-import):not(.realtime-tutor) { display: none !important; }
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__privacy,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__voice-mode,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__voice-settings,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__choice-note,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__demo,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__log,
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__adaptive { display: none !important; }
      html[data-ai-tutor-demo-en="true"] .block-library { width: 350px; }
      html[data-ai-tutor-demo-en="true"] .realtime-tutor__transcript { min-height: 118px; max-height: 235px; overflow: auto; }
      html[data-ai-tutor-demo-en="true"][data-ai-tutor-demo-focus="tutor"] .block-library { width: 560px; }
      html[data-ai-tutor-demo-en="true"][data-ai-tutor-demo-focus="tutor"] .realtime-tutor__transcript { min-height: 250px; max-height: 360px; }
      html[data-ai-tutor-demo-en="true"] .student-task-shell ol,
      html[data-ai-tutor-demo-en="true"] .student-task-shell > button { display: none !important; }
      html[data-ai-tutor-demo-en="true"] .canvas-stage__editor--drop::after { content: "Safely importing HTML and CSS…" !important; }
      html[data-ai-tutor-demo-en="true"] .source-editor__highlight::before { content: "Syntax-highlighted preview" !important; }
    `}</style>
  );
}
