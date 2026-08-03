import { RUNTIME_PROTOCOL_VERSION } from "@ai-tutor/contracts";

function inlineJson(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function createInspectionBridgeScript(
  runtimeIdValue: string,
  entryFileValue: string,
): string {
  return String.raw`
(() => {
  "use strict";
  const protocolVersion = ${RUNTIME_PROTOCOL_VERSION};
  const runtimeInstanceId = ${inlineJson(runtimeIdValue)};
  const entryFile = ${inlineJson(entryFileValue)};
  const internalSelector = "[data-ai-tutor-overlay]";
  const inheritedProperties = new Set([
    "color", "cursor", "direction", "font-family", "font-size", "font-style",
    "font-weight", "letter-spacing", "line-height", "list-style",
    "text-align", "text-indent", "text-transform", "visibility",
    "white-space", "word-spacing",
  ]);
  const numericControlProperties = new Set([
    "width", "height", "margin", "margin-top", "margin-right",
    "margin-bottom", "margin-left", "padding", "padding-top",
    "padding-right", "padding-bottom", "padding-left", "border-width",
    "gap", "top", "right", "bottom", "left",
  ]);
  const colorControlProperties = new Set(["--brand"]);
  const enumControlValues = new Map([
    ["box-sizing", new Set(["content-box", "border-box"])],
    ["display", new Set(["block", "inline", "inline-block", "flex", "grid", "none"])],
    ["flex-direction", new Set(["row", "row-reverse", "column", "column-reverse"])],
    ["justify-content", new Set(["flex-start", "center", "flex-end", "space-between", "space-around", "space-evenly"])],
    ["align-items", new Set(["stretch", "flex-start", "center", "flex-end", "baseline"])],
    ["position", new Set(["static", "relative", "absolute"])],
  ]);
  let selectionMode = false;
  let boxModelOverlayEnabled = false;
  let sequence = 0;
  let hoveredElement = null;
  let selectedElement = null;
  let selectedTarget = null;
  const transientChanges = new Map();
  const revisionStyleElement = document.createElement("style");
  revisionStyleElement.dataset.aiTutorSource = "__ai_tutor_experiments.css";
  document.head.append(revisionStyleElement);

  const send = (type, messageId, payload = {}) => {
    parent.postMessage(
      { protocolVersion, runtimeInstanceId, messageId, type, payload },
      "*",
    );
  };
  const fail = (code, message) => {
    const error = new Error(message);
    error.code = code;
    throw error;
  };
  const createOverlay = (name, color, fill) => {
    const overlay = document.createElement("div");
    overlay.dataset.aiTutorOverlay = name;
    overlay.setAttribute("aria-hidden", "true");
    const declarations = {
      position: "fixed", display: "none", pointerEvents: "none",
      zIndex: "2147483647", boxSizing: "border-box",
      border: "2px solid " + color, background: fill, borderRadius: "3px",
      boxShadow: "0 0 0 1px rgba(255,255,255,.85)",
      margin: "0", padding: "0", transform: "none", opacity: "1",
      visibility: "visible", filter: "none", mixBlendMode: "normal",
      animation: "none", transition: "none",
    };
    Object.entries(declarations).forEach(([property, value]) => {
      overlay.style.setProperty(
        property.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase()),
        value,
        "important",
      );
    });
    document.documentElement.append(overlay);
    return overlay;
  };
  const hoverOverlay = createOverlay("hover", "#2276ff", "rgba(34,118,255,.08)");
  const selectedOverlay = createOverlay("selected", "#ff5a36", "rgba(255,90,54,.10)");
  const boxMarginOverlay = createOverlay("box-margin", "transparent", "rgba(255,173,66,.16)");
  const boxBorderOverlay = createOverlay("box-border", "transparent", "rgba(255,218,75,.20)");
  const boxPaddingOverlay = createOverlay("box-padding", "transparent", "rgba(130,202,90,.20)");
  const boxContentOverlay = createOverlay("box-content", "transparent", "rgba(65,160,230,.18)");
  const boxOverlays = [
    boxMarginOverlay, boxBorderOverlay, boxPaddingOverlay, boxContentOverlay,
  ];
  boxOverlays.forEach((overlay) =>
    overlay.style.setProperty("z-index", "2147483646", "important"));
  const hideOverlay = (overlay) => {
    overlay.style.setProperty("display", "none", "important");
  };
  const drawOverlay = (overlay, element) => {
    if (!(element instanceof Element) || !element.isConnected) {
      hideOverlay(overlay);
      return;
    }
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      hideOverlay(overlay);
      return;
    }
    overlay.style.setProperty("display", "block", "important");
    overlay.style.setProperty("left", rect.left + "px", "important");
    overlay.style.setProperty("top", rect.top + "px", "important");
    overlay.style.setProperty("width", rect.width + "px", "important");
    overlay.style.setProperty("height", rect.height + "px", "important");
  };
  const drawOverlayRect = (overlay, left, top, width, height) => {
    if (width <= 0 || height <= 0) {
      hideOverlay(overlay);
      return;
    }
    overlay.style.setProperty("display", "block", "important");
    overlay.style.setProperty("left", left + "px", "important");
    overlay.style.setProperty("top", top + "px", "important");
    overlay.style.setProperty("width", width + "px", "important");
    overlay.style.setProperty("height", height + "px", "important");
  };
  const drawBoxModel = (element) => {
    if (!boxModelOverlayEnabled || !(element instanceof Element) ||
        !element.isConnected) {
      boxOverlays.forEach(hideOverlay);
      return;
    }
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const margin = {
      top: Math.max(0, numeric(style.marginTop)),
      right: Math.max(0, numeric(style.marginRight)),
      bottom: Math.max(0, numeric(style.marginBottom)),
      left: Math.max(0, numeric(style.marginLeft)),
    };
    const border = {
      top: numeric(style.borderTopWidth), right: numeric(style.borderRightWidth),
      bottom: numeric(style.borderBottomWidth), left: numeric(style.borderLeftWidth),
    };
    const padding = {
      top: numeric(style.paddingTop), right: numeric(style.paddingRight),
      bottom: numeric(style.paddingBottom), left: numeric(style.paddingLeft),
    };
    drawOverlayRect(
      boxMarginOverlay,
      rect.left - margin.left,
      rect.top - margin.top,
      rect.width + margin.left + margin.right,
      rect.height + margin.top + margin.bottom,
    );
    drawOverlayRect(boxBorderOverlay, rect.left, rect.top, rect.width, rect.height);
    drawOverlayRect(
      boxPaddingOverlay,
      rect.left + border.left,
      rect.top + border.top,
      rect.width - border.left - border.right,
      rect.height - border.top - border.bottom,
    );
    drawOverlayRect(
      boxContentOverlay,
      rect.left + border.left + padding.left,
      rect.top + border.top + padding.top,
      rect.width - border.left - border.right - padding.left - padding.right,
      rect.height - border.top - border.bottom - padding.top - padding.bottom,
    );
  };
  const refreshOverlays = () => {
    if (selectionMode && hoveredElement) drawOverlay(hoverOverlay, hoveredElement);
    else hideOverlay(hoverOverlay);
    if (selectedElement) drawOverlay(selectedOverlay, selectedElement);
    else hideOverlay(selectedOverlay);
    drawBoxModel(selectedElement);
  };
  const isInspectable = (element) => {
    if (!(element instanceof Element) || element.closest(internalSelector)) return false;
    if (element.matches("script,style,link,meta,head,title,base")) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 &&
      style.display !== "none" && style.visibility !== "hidden";
  };
  const cssEscape = (value) => {
    if (globalThis.CSS && typeof CSS.escape === "function") return CSS.escape(value);
    return value.replace(/[^a-zA-Z0-9_-]/g, (character) =>
      "\\" + character.codePointAt(0).toString(16) + " ");
  };
  const nthOfType = (element) => {
    const parent = element.parentElement;
    if (!parent) return 1;
    return Array.from(parent.children)
      .filter((candidate) => candidate.tagName === element.tagName)
      .indexOf(element) + 1;
  };
  const buildDomPath = (element) => {
    const segments = [];
    let current = element;
    while (current instanceof Element) {
      const tag = current.tagName.toLowerCase();
      if (current.id &&
          document.querySelectorAll("#" + cssEscape(current.id)).length === 1) {
        segments.unshift(tag + "#" + cssEscape(current.id));
        break;
      }
      const parent = current.parentElement;
      const sameTypeCount = parent
        ? Array.from(parent.children)
            .filter((candidate) => candidate.tagName === current.tagName).length
        : 1;
      segments.unshift(sameTypeCount > 1
        ? tag + ":nth-of-type(" + nthOfType(current) + ")"
        : tag);
      current = parent;
    }
    return segments.join(" > ");
  };
  const buildFingerprint = (element) => {
    const parent = element.parentElement;
    const childIndex = parent ? Array.from(parent.children).indexOf(element) : 0;
    return [
      element.tagName.toLowerCase(),
      element.id || "-",
      parent ? parent.tagName.toLowerCase() : "-",
      String(childIndex),
    ].join("|");
  };
  const targetFor = (element) => ({
    runtimeInstanceId,
    domPath: buildDomPath(element),
    fingerprint: buildFingerprint(element),
  });
  const publicAttributesFor = (element) => {
    const attributes = {};
    for (const attribute of Array.from(element.attributes)) {
      if (!attribute.name.startsWith("data-ai-tutor-")) {
        attributes[attribute.name] = attribute.value;
      }
    }
    return attributes;
  };
  const relationFor = (element) => ({
    target: targetFor(element),
    domPath: buildDomPath(element),
    tagName: element.tagName.toLowerCase(),
    attributes: publicAttributesFor(element),
  });
  const resolveTarget = (target) => {
    if (!target || target.runtimeInstanceId !== runtimeInstanceId ||
        typeof target.domPath !== "string") {
      fail("INVALID_ELEMENT_TARGET", "Element target does not belong to this runtime.");
    }
    let element = null;
    try {
      element = document.querySelector(target.domPath);
    } catch {
      fail("INVALID_DOM_PATH", "The saved DOM path is not a valid selector.");
    }
    if (!element || !isInspectable(element)) {
      fail("TARGET_NOT_FOUND", "The selected element could not be relocated after rendering.");
    }
    if (target.fingerprint && buildFingerprint(element) !== target.fingerprint) {
      fail("TARGET_FINGERPRINT_MISMATCH", "The DOM path now points to a different element.");
    }
    return element;
  };
  const numeric = (value) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const rounded = (value) => Math.round(value * 100) / 100;
  const rectValue = (rect) => ({
    x: rounded(rect.x), y: rounded(rect.y),
    width: rounded(rect.width), height: rounded(rect.height),
    top: rounded(rect.top), right: rounded(rect.right),
    bottom: rounded(rect.bottom), left: rounded(rect.left),
  });
  const edgeValues = (style, prefix, suffix = "") => ({
    top: rounded(numeric(style.getPropertyValue(prefix + "-top" + suffix))),
    right: rounded(numeric(style.getPropertyValue(prefix + "-right" + suffix))),
    bottom: rounded(numeric(style.getPropertyValue(prefix + "-bottom" + suffix))),
    left: rounded(numeric(style.getPropertyValue(prefix + "-left" + suffix))),
  });
  const splitSelectors = (text) => {
    const result = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (quote) {
        if (character === quote && text[index - 1] !== "\\") quote = "";
        continue;
      }
      if (character === "\"" || character === "'") {
        quote = character;
        continue;
      }
      if (character === "(" || character === "[") depth += 1;
      else if (character === ")" || character === "]") depth -= 1;
      else if (character === "," && depth === 0) {
        result.push(text.slice(start, index).trim());
        start = index + 1;
      }
    }
    result.push(text.slice(start).trim());
    return result.filter(Boolean);
  };
  const specificityFor = (selector) => {
    const source = selector.replace(/:where\([^)]*\)/g, "");
    const ids = (source.match(/#[\w-]+/g) || []).length;
    const classes =
      (source.match(/\.[\w-]+/g) || []).length +
      (source.match(/\[[^\]]+\]/g) || []).length +
      (source.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length;
    const typeSource = source
      .replace(/#[\w-]+|\.[\w-]+|\[[^\]]+\]|::?[\w-]+(?:\([^)]*\))?/g, " ")
      .replace(/[>+~*]/g, " ");
    const types = (typeSource.match(/(?:^|\s)[a-zA-Z][\w-]*/g) || []).length +
      (source.match(/::[\w-]+/g) || []).length;
    return [ids, classes, types];
  };
  const compareSpecificity = (left, right) => {
    for (let index = 0; index < 3; index += 1) {
      if (left[index] !== right[index]) return left[index] - right[index];
    }
    return 0;
  };
  const selectorMatch = (element, selectorText) => {
    let result = null;
    for (const selector of splitSelectors(selectorText)) {
      const pseudo = selector.match(/(::before|::after)\s*$/);
      const candidate = pseudo
        ? selector.slice(0, pseudo.index).trim() || "*"
        : selector;
      try {
        if (!element.matches(candidate)) continue;
      } catch {
        continue;
      }
      const specificity = specificityFor(selector);
      if (!result || compareSpecificity(specificity, result.specificity) > 0) {
        result = {
          matchedSelector: selector,
          specificity,
          pseudoElement: pseudo ? pseudo[1] : null,
        };
      }
    }
    return result;
  };
  const declarationsFor = (style, inherited) => {
    const declarations = [];
    for (let index = 0; index < style.length; index += 1) {
      const property = style.item(index);
      if (!property) continue;
      declarations.push({
        property,
        value: style.getPropertyValue(property).trim(),
        important: style.getPropertyPriority(property) === "important",
        inherited,
      });
    }
    return declarations;
  };
  const sourcePosition = (styleElement, selectorText, cursors) => {
    const sourceText = styleElement.textContent || "";
    const startAt = cursors.get(styleElement) || 0;
    let index = sourceText.indexOf(selectorText, startAt);
    if (index < 0) index = sourceText.indexOf(selectorText);
    if (index < 0) {
      return {
        filePath: styleElement.dataset.aiTutorSource || entryFile,
        line: null, column: null, kind: "stylesheet",
      };
    }
    cursors.set(styleElement, index + selectorText.length);
    const lines = sourceText.slice(0, index).split(/\r?\n/);
    const localLine = lines.length;
    const localColumn = (lines.at(-1) || "").length + 1;
    const baseLine = Number(styleElement.dataset.aiTutorBaseLine || "1");
    const baseColumn = Number(styleElement.dataset.aiTutorBaseColumn || "1");
    return {
      filePath: styleElement.dataset.aiTutorSource || entryFile,
      line: baseLine + localLine - 1,
      column: localLine === 1 ? baseColumn + localColumn - 1 : localColumn,
      kind: "stylesheet",
    };
  };
  const collectRuleRecords = () => {
    const records = [];
    const cursors = new Map();
    let sourceOrder = 0;
    const visit = (rules, styleElement) => {
      for (const rule of Array.from(rules || [])) {
        if (rule instanceof CSSStyleRule) {
          records.push({
            rule,
            selectorText: rule.selectorText,
            source: sourcePosition(styleElement, rule.selectorText, cursors),
            sourceOrder: sourceOrder++,
          });
        } else if ("cssRules" in rule) {
          if (
            rule instanceof CSSMediaRule &&
            !matchMedia(rule.conditionText).matches
          ) {
            continue;
          }
          if (
            typeof CSSSupportsRule !== "undefined" &&
            rule instanceof CSSSupportsRule &&
            !CSS.supports(rule.conditionText)
          ) {
            continue;
          }
          try {
            visit(rule.cssRules, styleElement);
          } catch {
            // Unsupported conditional rules are omitted.
          }
        }
      }
    };
    for (const sheet of Array.from(document.styleSheets)) {
      const owner = sheet.ownerNode;
      if (!(owner instanceof HTMLStyleElement) ||
          owner.dataset.aiTutorInternal === "true") continue;
      try {
        visit(sheet.cssRules, owner);
      } catch {
        // Inaccessible stylesheets are ignored defensively.
      }
    }
    return records;
  };
  const ruleResult = (record, match, declarations, inheritedFrom) => ({
    selectorText: match.matchedSelector,
    source: record.source,
    specificity: match.specificity,
    sourceOrder: record.sourceOrder,
    declarations,
    ...(inheritedFrom ? { inheritedFrom } : {}),
    pseudoElement: match.pseudoElement,
  });
  const inspectElement = (element) => {
    if (!isInspectable(element)) {
      fail("ELEMENT_NOT_INSPECTABLE", "Choose a visible page element.");
    }
    const target = targetFor(element);
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    const padding = edgeValues(computed, "padding");
    const border = edgeValues(computed, "border", "-width");
    const margin = edgeValues(computed, "margin");
    const computedStyles = {};
    for (let index = 0; index < computed.length; index += 1) {
      const property = computed.item(index);
      if (property) computedStyles[property] = computed.getPropertyValue(property);
    }

    const records = collectRuleRecords();
    const directRules = [];
    const pseudoRules = [];
    const directProperties = new Set();
    for (const record of records) {
      const match = selectorMatch(element, record.selectorText);
      if (!match) continue;
      const declarations = declarationsFor(record.rule.style, false);
      if (match.pseudoElement) {
        pseudoRules.push(ruleResult(record, match, declarations));
      } else {
        declarations.forEach((declaration) =>
          directProperties.add(declaration.property));
        directRules.push(ruleResult(record, match, declarations));
      }
    }
    if (
      (element instanceof HTMLElement || element instanceof SVGElement) &&
      element.style.length > 0
    ) {
      const declarations = declarationsFor(element.style, false);
      declarations.forEach((declaration) =>
        directProperties.add(declaration.property));
      directRules.push({
        selectorText: "element.style",
        source: {
          filePath: entryFile, line: null, column: null, kind: "inline-style",
        },
        specificity: [1000, 0, 0],
        sourceOrder: records.length,
        declarations,
        pseudoElement: null,
      });
    }

    const inheritedRules = [];
    const inheritedNames = new Set();
    let ancestor = element.parentElement;
    while (ancestor && inheritedRules.length < 12) {
      const ancestorComputed = getComputedStyle(ancestor);
      for (const record of records) {
        const match = selectorMatch(ancestor, record.selectorText);
        if (!match || match.pseudoElement) continue;
        const declarations = declarationsFor(record.rule.style, true).filter(
          (declaration) =>
            inheritedProperties.has(declaration.property) &&
            !directProperties.has(declaration.property) &&
            computed.getPropertyValue(declaration.property) ===
              ancestorComputed.getPropertyValue(declaration.property),
        );
        if (declarations.length === 0) continue;
        declarations.forEach((declaration) =>
          inheritedNames.add(declaration.property));
        inheritedRules.push(
          ruleResult(record, match, declarations, targetFor(ancestor)),
        );
      }
      ancestor = ancestor.parentElement;
    }

    const diagnostics = [];
    if (directRules.length === 0) {
      diagnostics.push({
        severity: "info",
        code: "INSPECTION_NO_AUTHORED_RULE",
        message:
          "No authored CSS rule directly matches this element; browser defaults or inheritance may determine its appearance.",
      });
    }
    if (inheritedNames.size > 0) {
      diagnostics.push({
        severity: "info",
        code: "INSPECTION_INHERITED_STYLES",
        message: "Inherited properties: " +
          Array.from(inheritedNames).slice(0, 8).join(", "),
      });
    }
    if (pseudoRules.length > 0) {
      diagnostics.push({
        severity: "info",
        code: "INSPECTION_PSEUDO_ELEMENTS",
        message:
          "Matching ::before or ::after rules are reported separately; the selected target is the originating element.",
      });
    }
    const attributes = publicAttributesFor(element);
    return {
      target,
      domPath: target.domPath,
      tagName: element.tagName.toLowerCase(),
      attributes,
      boundingRect: rectValue(rect),
      boxModel: {
        content: {
          width: rounded(Math.max(
            0,
            rect.width - padding.left - padding.right - border.left - border.right,
          )),
          height: rounded(Math.max(
            0,
            rect.height - padding.top - padding.bottom - border.top - border.bottom,
          )),
        },
        padding,
        border,
        margin,
        boxSizing: computed.boxSizing,
      },
      computedStyles,
      matchedRules: [...directRules, ...pseudoRules, ...inheritedRules],
      diagnostics,
      relations: {
        parent:
          element.parentElement && isInspectable(element.parentElement)
            ? relationFor(element.parentElement)
            : null,
        children: Array.from(element.children)
          .filter((child) => isInspectable(child))
          .slice(0, 24)
          .map((child) => relationFor(child)),
      },
    };
  };
  const selectElement = (element, messageId) => {
    const result = inspectElement(element);
    selectedElement = element;
    selectedTarget = result.target;
    selectionMode = false;
    hoveredElement = null;
    refreshOverlays();
    send("runtime.element_selected", messageId, result);
  };
  const validatedControl = (change) => {
    if (!change || typeof change !== "object") {
      fail("INVALID_CSS_CHANGE", "CSS control change is missing.");
    }
    const property = typeof change.property === "string"
      ? change.property.trim().toLowerCase()
      : "";
    const value = typeof change.value === "string" ? change.value.trim() : "";
    if (numericControlProperties.has(property)) {
      const match = value.match(/^(-?\d+(?:\.\d+)?)(px|%|rem|em|vh|vw)?$/);
      const number = match ? Number(match[1]) : Number.NaN;
      if (!match || !Number.isFinite(number) || number < -2000 || number > 2000) {
        fail("INVALID_CSS_VALUE", "Numeric CSS controls require a bounded value.");
      }
      return { property, value };
    }
    if (colorControlProperties.has(property)) {
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        fail("INVALID_CSS_VALUE", "Color controls require a six-digit hex color.");
      }
      return { property, value: value.toLowerCase() };
    }
    const allowedValues = enumControlValues.get(property);
    if (!allowedValues || !allowedValues.has(value)) {
      fail("UNSUPPORTED_CSS_CONTROL", "This CSS property or value is not allowed.");
    }
    return { property, value };
  };
  const validateRevisionStyle = (value) => {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 100000) {
      fail("INVALID_REVISION_STYLE", "Revision CSS is missing or too large.");
    }
    if (/@import|url\s*\(|expression\s*\(|javascript:/i.test(value)) {
      fail("UNSAFE_REVISION_STYLE", "Revision CSS contains a blocked construct.");
    }
    return value;
  };
  const rememberOriginalStyle = (element, property) => {
    let properties = transientChanges.get(element);
    if (!properties) {
      properties = new Map();
      transientChanges.set(element, properties);
    }
    if (!properties.has(property)) {
      properties.set(property, {
        value: element.style.getPropertyValue(property),
        priority: element.style.getPropertyPriority(property),
        present: element.style.getPropertyValue(property) !== "" ||
          element.style.getPropertyPriority(property) !== "",
      });
    }
  };
  const restoreTransientStyles = () => {
    for (const [element, properties] of transientChanges) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) continue;
      for (const [property, original] of properties) {
        if (original.present) {
          element.style.setProperty(property, original.value, original.priority);
        } else {
          element.style.removeProperty(property);
        }
      }
    }
    transientChanges.clear();
  };
  const emitCurrentInspection = (prefix) => {
    if (!selectedElement || !selectedElement.isConnected) return;
    const result = inspectElement(selectedElement);
    selectedTarget = result.target;
    refreshOverlays();
    send("runtime.element_selected", prefix + String(++sequence), result);
  };
  let suppressSelectionClick = false;
  const selectFromPointer = (event) => {
    if (!selectionMode || !isInspectable(event.target)) return false;
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      selectElement(event.target, "selection-" + String(++sequence));
    } catch (error) {
      send("runtime.inspection_error", "selection-" + String(++sequence), {
        code: error && error.code ? error.code : "INSPECTION_FAILED",
        message: error instanceof Error
          ? error.message
          : "Element inspection failed.",
      });
    }
    return true;
  };

  document.addEventListener("pointerover", (event) => {
    if (!selectionMode || !isInspectable(event.target)) return;
    hoveredElement = event.target;
    drawOverlay(hoverOverlay, event.target);
  }, true);
  document.addEventListener("pointerout", (event) => {
    if (!selectionMode || event.relatedTarget instanceof Element) return;
    hoveredElement = null;
    hideOverlay(hoverOverlay);
  }, true);
  document.addEventListener("pointerup", (event) => {
    if (!selectFromPointer(event)) return;
    suppressSelectionClick = true;
  }, true);
  document.addEventListener("click", (event) => {
    if (suppressSelectionClick) {
      suppressSelectionClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    selectFromPointer(event);
  }, true);
  addEventListener("scroll", refreshOverlays, true);
  addEventListener("resize", refreshOverlays);

  const pause = () => {
    document.documentElement.dataset.aiTutorRuntime = "paused";
    document.querySelectorAll("*").forEach((element) => {
      if ((element instanceof HTMLElement || element instanceof SVGElement) &&
          !element.closest(internalSelector)) {
        element.style.setProperty(
          "animation-play-state",
          "paused",
          "important",
        );
      }
    });
  };
  const resume = () => {
    delete document.documentElement.dataset.aiTutorRuntime;
    document.querySelectorAll("*").forEach((element) => {
      if ((element instanceof HTMLElement || element instanceof SVGElement) &&
          !element.closest(internalSelector)) {
        element.style.removeProperty("animation-play-state");
      }
    });
  };
  addEventListener("message", (event) => {
    if (event.source !== parent) return;
    const message = event.data;
    if (!message ||
        message.protocolVersion !== protocolVersion ||
        message.runtimeInstanceId !== runtimeInstanceId ||
        typeof message.messageId !== "string") return;
    try {
      switch (message.type) {
        case "runtime.init":
          send("runtime.ready", message.messageId);
          break;
        case "runtime.render":
          restoreTransientStyles();
          revisionStyleElement.textContent = validateRevisionStyle(
            message.payload && message.payload.revisionStyle,
          );
          if (selectedTarget) {
            try {
              selectedElement = resolveTarget(selectedTarget);
              const result = inspectElement(selectedElement);
              selectedTarget = result.target;
              refreshOverlays();
              send(
                "runtime.element_selected",
                "relocated-" + String(++sequence),
                result,
              );
            } catch (error) {
              selectedElement = null;
              selectedTarget = null;
              refreshOverlays();
              send(
                "runtime.inspection_error",
                "relocate-" + String(++sequence),
                {
                  code: error && error.code ? error.code : "TARGET_NOT_FOUND",
                  message: error instanceof Error
                    ? error.message
                    : "The selected element could not be relocated.",
                },
              );
            }
          }
          send("runtime.rendered", message.messageId);
          break;
        case "runtime.apply_transient_style": {
          const startedAt = performance.now();
          const change = message.payload && message.payload.change;
          const target = change && change.target;
          const element = resolveTarget(target);
          if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
            fail("UNSUPPORTED_STYLE_TARGET", "The selected element cannot receive styles.");
          }
          const validated = validatedControl(change);
          rememberOriginalStyle(element, validated.property);
          element.style.setProperty(
            validated.property,
            validated.value,
            "important",
          );
          // A transient preview must stay on the animation hot path. It does
          // not implicitly select the target or emit a full inspection (which
          // walks CSS rules, computes a fingerprint, and forces layout). When
          // the target was already selected, keep its visible overlay in sync.
          if (selectedElement === element) refreshOverlays();
          const durationMs = Math.max(0, performance.now() - startedAt);
          send("runtime.transient_style_applied", message.messageId, {
            name: "transient-style",
            durationMs,
          });
          break;
        }
        case "runtime.reset_transient_state":
          restoreTransientStyles();
          refreshOverlays();
          send("runtime.transient_state_reset", message.messageId);
          emitCurrentInspection("reset-");
          break;
        case "runtime.set_box_model_overlay": {
          const enabled = message.payload && message.payload.enabled;
          if (typeof enabled !== "boolean") {
            fail("INVALID_OVERLAY_PAYLOAD", "Box model overlay requires a boolean.");
          }
          boxModelOverlayEnabled = enabled;
          refreshOverlays();
          send("runtime.box_model_overlay_set", message.messageId, { enabled });
          break;
        }
        case "runtime.set_comparison_viewport": {
          const payload = message.payload;
          const mode = payload && payload.mode;
          const scrollingElement = document.scrollingElement || document.documentElement;
          if (mode !== "focus" && mode !== "page") {
            fail("INVALID_COMPARISON_VIEWPORT", "Comparison viewport mode is invalid.");
          }
          let targetViewportCenterY = null;
          if (mode === "focus") {
            const element = resolveTarget(payload && payload.target);
            element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
            selectedElement = element;
            selectedTarget = targetFor(element);
            refreshOverlays();
            const targetRect = element.getBoundingClientRect();
            targetViewportCenterY = targetRect.top + targetRect.height / 2;
          } else {
            const ratio = payload && payload.scrollRatio;
            if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
              fail("INVALID_COMPARISON_SCROLL", "Comparison page position must be between zero and one.");
            }
            selectedElement = null;
            selectedTarget = null;
            refreshOverlays();
            const maxScrollTopBefore = Math.max(0, scrollingElement.scrollHeight - innerHeight);
            scrollTo({ top: maxScrollTopBefore * ratio, left: 0, behavior: "instant" });
          }
          const maxScrollTop = Math.max(0, scrollingElement.scrollHeight - innerHeight);
          const maxScrollLeft = Math.max(0, scrollingElement.scrollWidth - innerWidth);
          const scrollTop = Math.max(0, scrollingElement.scrollTop || scrollY || 0);
          const scrollLeft = Math.max(0, scrollingElement.scrollLeft || scrollX || 0);
          send("runtime.comparison_viewport_set", message.messageId, {
            mode,
            scrollTop,
            scrollLeft,
            maxScrollTop,
            maxScrollLeft,
            viewportWidth: Math.max(1, innerWidth),
            viewportHeight: Math.max(1, innerHeight),
            documentWidth: Math.max(1, scrollingElement.scrollWidth),
            documentHeight: Math.max(1, scrollingElement.scrollHeight),
            scrollRatio: maxScrollTop === 0 ? 0 : Math.min(1, scrollTop / maxScrollTop),
            zoom: 1,
            targetViewportCenterY,
          });
          break;
        }
        case "runtime.enable_selection": {
          const enabled = message.payload && message.payload.enabled;
          if (typeof enabled !== "boolean") {
            fail(
              "INVALID_SELECTION_PAYLOAD",
              "Selection mode requires a boolean enabled value.",
            );
          }
          selectionMode = enabled;
          hoveredElement = null;
          hideOverlay(hoverOverlay);
          if (message.payload.target) {
            selectedElement = resolveTarget(message.payload.target);
            selectedTarget = targetFor(selectedElement);
            drawOverlay(selectedOverlay, selectedElement);
          }
          send("runtime.selection_enabled", message.messageId, { enabled });
          break;
        }
        case "runtime.clear_selection":
          selectionMode = false;
          hoveredElement = null;
          selectedElement = null;
          selectedTarget = null;
          boxModelOverlayEnabled = false;
          refreshOverlays();
          send("runtime.selection_cleared", message.messageId);
          break;
        case "runtime.inspect": {
          const element = resolveTarget(
            message.payload && message.payload.target,
          );
          const result = inspectElement(element);
          selectedElement = element;
          selectedTarget = result.target;
          drawOverlay(selectedOverlay, element);
          send("runtime.inspection_result", message.messageId, result);
          break;
        }
        case "runtime.pause":
          pause();
          send("runtime.paused", message.messageId);
          break;
        case "runtime.resume":
          resume();
          send("runtime.resumed", message.messageId);
          break;
        case "runtime.dispose":
          send("runtime.disposed", message.messageId);
          break;
        default:
          send("runtime.error", message.messageId, {
            code: "UNSUPPORTED_RUNTIME_MESSAGE",
            message: "The sandbox bridge does not support this message.",
          });
      }
    } catch (error) {
      send("runtime.error", message.messageId, {
        code: error && error.code ? error.code : "BRIDGE_FAILURE",
        message: error instanceof Error
          ? error.message
          : "Unknown bridge error",
      });
    }
  });
  send("runtime.ready", "bootstrap");
})();
`.trim();
}
