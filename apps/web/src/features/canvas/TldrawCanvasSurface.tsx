"use client";

import {
  Tldraw,
  type Editor,
  type TLComponents,
} from "tldraw";

import { TeachingBlockShapeUtil } from "./TeachingBlockShape";

const SHAPE_UTILS = [TeachingBlockShapeUtil];
const HIDDEN_COMPONENTS: TLComponents = {
  ActionsMenu: null,
  ContextMenu: null,
  DebugMenu: null,
  DebugPanel: null,
  HelpMenu: null,
  HelperButtons: null,
  ImageToolbar: null,
  KeyboardShortcutsDialog: null,
  MainMenu: null,
  MenuPanel: null,
  Minimap: null,
  NavigationPanel: null,
  PageMenu: null,
  QuickActions: null,
  RichTextToolbar: null,
  SharePanel: null,
  StylePanel: null,
  Toolbar: null,
  TopPanel: null,
  VideoToolbar: null,
  ZoomMenu: null,
};

export function TldrawCanvasSurface({
  persistenceKey,
  onMount,
}: {
  readonly persistenceKey: string;
  readonly onMount: (editor: Editor) => void;
}) {
  return (
    <Tldraw
      persistenceKey={persistenceKey}
      shapeUtils={SHAPE_UTILS}
      components={HIDDEN_COMPONENTS}
      onMount={onMount}
      options={{ maxPages: 1 }}
    />
  );
}
