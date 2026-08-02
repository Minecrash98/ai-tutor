import type {
  ElementTarget,
  InspectionResult,
  RuntimeMeasurement,
  RuntimeComparisonViewportState,
  RuntimeCapabilities,
  RuntimeDescriptor,
} from "@ai-tutor/contracts";
import type {
  CodeRevision,
  StoredFile,
} from "@ai-tutor/teaching-model";

export interface ImportedFile {
  readonly path: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface ImportDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly filePath?: string;
}

export interface NormalizedProject {
  readonly runtimeType: string;
  readonly entryFile: string;
  readonly files: Readonly<Record<string, StoredFile>>;
  readonly assetManifest: Readonly<
    Record<
      string,
      {
        readonly token: string;
        readonly mimeType: string;
      }
    >
  >;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export type {
  BoxEdges,
  BoxModelMetrics,
  CssSourceLocation,
  ElementTarget,
  InspectionDiagnostic,
  InspectionResult,
  RuntimeMeasurement,
  MatchedCssDeclaration,
  MatchedCssRule,
  Rect,
} from "@ai-tutor/contracts";

export interface CssControlChange {
  readonly target: ElementTarget;
  readonly property: string;
  readonly value: string;
}

export interface RuntimeOptions {
  readonly runtimeInstanceId: string;
  readonly mountTarget?: HTMLElement;
  readonly onElementSelected?: (result: InspectionResult) => void;
  readonly onInspectionError?: (error: Error) => void;
}

export type ComparisonViewportRequest =
  | { readonly mode: "focus"; readonly target: ElementTarget }
  | { readonly mode: "page"; readonly scrollRatio: number };

export type { RuntimeComparisonViewportState } from "@ai-tutor/contracts";

export interface RenderResult {
  readonly runtimeInstanceId: string;
  readonly renderedAt: string;
  readonly diagnostics: readonly ImportDiagnostic[];
}

export type RuntimeStatus =
  | "idle"
  | "mounting"
  | "ready"
  | "paused"
  | "error"
  | "disposed";

export interface RuntimeHandle {
  mount(target: HTMLElement): Promise<void>;
  getStatus(): RuntimeStatus;
  render(revision: CodeRevision): Promise<RenderResult>;
  setSelectionMode(enabled: boolean): Promise<void>;
  clearSelection(): Promise<void>;
  inspect(target: ElementTarget): Promise<InspectionResult>;
  applyTransientStyle(change: CssControlChange): Promise<RuntimeMeasurement>;
  resetTransientState(): Promise<void>;
  setBoxModelOverlay(enabled: boolean): Promise<void>;
  setComparisonViewport(
    request: ComparisonViewportRequest,
  ): Promise<RuntimeComparisonViewportState>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  dispose(): Promise<void>;
}

export interface RuntimeAdapter extends RuntimeDescriptor {
  readonly capabilities: RuntimeCapabilities;

  canImport(files: readonly ImportedFile[]): boolean;
  normalize(files: readonly ImportedFile[]): Promise<NormalizedProject>;
  createRuntime(
    project: NormalizedProject,
    options: RuntimeOptions,
  ): Promise<RuntimeHandle>;
}
