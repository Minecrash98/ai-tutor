"use client";

import dynamic from "next/dynamic";

const CanvasWorkspace = dynamic(
  () =>
    import("@/features/canvas/CanvasWorkspace").then(
      (module) => module.CanvasWorkspace,
    ),
  {
    ssr: false,
    loading: () => (
      <main className="canvas-loading" aria-busy="true" aria-live="polite">
        <span aria-hidden="true">CSS</span>
        <strong>正在准备学习画布…</strong>
        <small>马上就能开始第一节小课</small>
      </main>
    ),
  },
);

export function CanvasWorkspaceClient() {
  return <CanvasWorkspace />;
}
