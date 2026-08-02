import {
  inspectionResultSchema,
  runtimeComparisonViewportStateSchema,
  runtimeMeasurementSchema,
  runtimeMessageEnvelopeSchema,
  type RuntimeMessageEnvelope,
  type RuntimeMessageType,
} from "@ai-tutor/contracts";
import type {
  CssControlChange,
  ElementTarget,
  InspectionResult,
  NormalizedProject,
  RenderResult,
  RuntimeHandle,
  RuntimeOptions,
  RuntimeStatus,
  RuntimeMeasurement,
  RuntimeComparisonViewportState,
  ComparisonViewportRequest,
} from "@ai-tutor/runtime-core";
import type { CodeRevision } from "@ai-tutor/teaching-model";

import { buildSandboxDocument } from "./sandbox-document";

const MESSAGE_TIMEOUT_MS = 4_000;
export const EXPERIMENT_STYLES_FILE = "__ai_tutor_experiments.css";

interface PendingMessage {
  readonly expectedType: RuntimeMessageType;
  readonly resolve: (message: RuntimeMessageEnvelope) => void;
  readonly reject: (error: Error) => void;
  readonly timeoutId: number;
}

export class StaticHtmlRuntime implements RuntimeHandle {
  readonly #iframe: HTMLIFrameElement;
  readonly #pending = new Map<string, PendingMessage>();
  #status: RuntimeStatus = "idle";
  #listening = false;
  #bootstrapResolve: (() => void) | null = null;
  #bootstrapReject: ((error: Error) => void) | null = null;
  #selectedTarget: ElementTarget | null = null;

  constructor(
    readonly project: NormalizedProject,
    readonly options: RuntimeOptions,
  ) {
    this.#iframe = document.createElement("iframe");
    this.#iframe.className = "static-html-runtime-frame";
    this.#iframe.title = "隔离 HTML/CSS 运行结果";
    this.#iframe.referrerPolicy = "no-referrer";
    this.#iframe.sandbox.add("allow-scripts");
  }

  getStatus(): RuntimeStatus {
    return this.#status;
  }

  async mount(target: HTMLElement): Promise<void> {
    if (this.#status === "disposed") {
      throw new Error("Cannot mount a disposed runtime.");
    }
    if (this.#status !== "idle") return;

    this.#status = "mounting";
    if (!this.#listening) {
      window.addEventListener("message", this.#handleMessage);
      this.#listening = true;
    }

    const bootstrap = new Promise<void>((resolve, reject) => {
      this.#bootstrapResolve = resolve;
      this.#bootstrapReject = reject;
      window.setTimeout(() => {
        if (!this.#bootstrapReject) return;
        this.#bootstrapReject(new Error("Sandbox bridge did not become ready."));
        this.#bootstrapResolve = null;
        this.#bootstrapReject = null;
      }, MESSAGE_TIMEOUT_MS);
    });

    const nonce = crypto.randomUUID().replace(/-/g, "");
    this.#iframe.srcdoc = buildSandboxDocument(
      this.project,
      this.options.runtimeInstanceId,
      nonce,
    );
    target.replaceChildren(this.#iframe);

    try {
      await bootstrap;
      await this.#request("runtime.init", "runtime.ready", {});
      this.#status = "ready";
    } catch (error) {
      this.#status = "error";
      throw error;
    }
  }

  async render(revision: CodeRevision): Promise<RenderResult> {
    this.#assertOperational();
    const revisionStyle = revision.files[EXPERIMENT_STYLES_FILE]?.content ?? "";
    await this.#request("runtime.render", "runtime.rendered", { revisionStyle });
    return {
      runtimeInstanceId: this.options.runtimeInstanceId,
      renderedAt: new Date().toISOString(),
      diagnostics: this.project.diagnostics,
    };
  }

  async setSelectionMode(enabled: boolean): Promise<void> {
    this.#assertOperational();
    await this.#request(
      "runtime.enable_selection",
      "runtime.selection_enabled",
      {
        enabled,
        ...(this.#selectedTarget ? { target: this.#selectedTarget } : {}),
      },
    );
  }

  async clearSelection(): Promise<void> {
    this.#assertOperational();
    await this.#request(
      "runtime.clear_selection",
      "runtime.selection_cleared",
      {},
    );
    this.#selectedTarget = null;
  }

  async inspect(target: ElementTarget): Promise<InspectionResult> {
    this.#assertOperational();
    if (target.runtimeInstanceId !== this.options.runtimeInstanceId) {
      throw new Error("Element target belongs to a different runtime.");
    }
    const response = await this.#request(
      "runtime.inspect",
      "runtime.inspection_result",
      { target },
    );
    const result = this.#parseInspectionResult(response.payload);
    this.#selectedTarget = result.target;
    return result;
  }

  async applyTransientStyle(
    change: CssControlChange,
  ): Promise<RuntimeMeasurement> {
    this.#assertOperational();
    if (change.target.runtimeInstanceId !== this.options.runtimeInstanceId) {
      throw new Error("Element target belongs to a different runtime.");
    }
    const response = await this.#request(
      "runtime.apply_transient_style",
      "runtime.transient_style_applied",
      { change },
    );
    const parsed = runtimeMeasurementSchema.safeParse(response.payload);
    if (!parsed.success) {
      throw new Error("Sandbox returned an invalid CSS measurement.");
    }
    return parsed.data;
  }

  async resetTransientState(): Promise<void> {
    this.#assertOperational();
    await this.#request(
      "runtime.reset_transient_state",
      "runtime.transient_state_reset",
      {},
    );
  }

  async setBoxModelOverlay(enabled: boolean): Promise<void> {
    this.#assertOperational();
    await this.#request(
      "runtime.set_box_model_overlay",
      "runtime.box_model_overlay_set",
      { enabled },
    );
  }

  async setComparisonViewport(
    request: ComparisonViewportRequest,
  ): Promise<RuntimeComparisonViewportState> {
    this.#assertOperational();
    if (
      request.mode === "focus" &&
      request.target.runtimeInstanceId !== this.options.runtimeInstanceId
    ) {
      throw new Error("Element target belongs to a different runtime.");
    }
    const response = await this.#request(
      "runtime.set_comparison_viewport",
      "runtime.comparison_viewport_set",
      request,
    );
    const parsed = runtimeComparisonViewportStateSchema.safeParse(
      response.payload,
    );
    if (!parsed.success) {
      throw new Error("Sandbox returned an invalid comparison viewport.");
    }
    return parsed.data;
  }

  async pause(): Promise<void> {
    if (this.#status === "paused" || this.#status === "disposed") return;
    this.#assertOperational();
    await this.#request("runtime.pause", "runtime.paused", {});
    this.#status = "paused";
  }

  async resume(): Promise<void> {
    if (this.#status === "ready" || this.#status === "disposed") return;
    if (this.#status !== "paused") {
      throw new Error(`Cannot resume runtime from ${this.#status}.`);
    }
    await this.#request("runtime.resume", "runtime.resumed", {});
    this.#status = "ready";
  }

  async dispose(): Promise<void> {
    if (this.#status === "disposed") return;
    if (this.#status === "ready" || this.#status === "paused") {
      try {
        await this.#request("runtime.dispose", "runtime.disposed", {});
      } catch {
        // The iframe is removed even if its final acknowledgement is lost.
      }
    }
    this.#status = "disposed";
    this.#iframe.remove();
    if (this.#listening) {
      window.removeEventListener("message", this.#handleMessage);
      this.#listening = false;
    }
    for (const pending of this.#pending.values()) {
      window.clearTimeout(pending.timeoutId);
      pending.reject(new Error("Runtime disposed before the message completed."));
    }
    this.#pending.clear();
  }

  readonly #handleMessage = (event: MessageEvent<unknown>) => {
    if (event.source !== this.#iframe.contentWindow) return;
    const parsed = runtimeMessageEnvelopeSchema.safeParse(event.data);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.runtimeInstanceId !== this.options.runtimeInstanceId) return;

    if (message.type === "runtime.ready" && message.messageId === "bootstrap") {
      this.#bootstrapResolve?.();
      this.#bootstrapResolve = null;
      this.#bootstrapReject = null;
      return;
    }

    if (message.type === "runtime.element_selected") {
      const parsed = inspectionResultSchema.safeParse(message.payload);
      if (!parsed.success) return;
      if (
        parsed.data.target.runtimeInstanceId !==
        this.options.runtimeInstanceId
      ) {
        return;
      }
      this.#selectedTarget = parsed.data.target;
      try {
        this.options.onElementSelected?.(parsed.data);
      } catch {
        // Consumer callbacks cannot break the runtime message loop.
      }
      return;
    }

    if (message.type === "runtime.inspection_error") {
      const payload =
        typeof message.payload === "object" && message.payload !== null
          ? (message.payload as Record<string, unknown>)
          : {};
      const code =
        typeof payload.code === "string" ? payload.code : "INSPECTION_ERROR";
      const detail =
        typeof payload.message === "string"
          ? payload.message
          : "Element inspection failed.";
      this.#selectedTarget = null;
      try {
        this.options.onInspectionError?.(new Error(`${code}: ${detail}`));
      } catch {
        // Consumer callbacks cannot break the runtime message loop.
      }
      return;
    }

    const pending = this.#pending.get(message.messageId);
    if (!pending) return;
    window.clearTimeout(pending.timeoutId);
    this.#pending.delete(message.messageId);
    if (message.type === "runtime.error") {
      const payload =
        typeof message.payload === "object" && message.payload !== null
          ? (message.payload as Record<string, unknown>)
          : {};
      const code =
        typeof payload.code === "string" ? payload.code : "RUNTIME_ERROR";
      const detail =
        typeof payload.message === "string"
          ? payload.message
          : "Sandbox bridge reported a runtime error.";
      pending.reject(new Error(`${code}: ${detail}`));
      return;
    }
    if (message.type !== pending.expectedType) {
      pending.reject(
        new Error(
          `Expected ${pending.expectedType}, received ${message.type}.`,
        ),
      );
      return;
    }
    pending.resolve(message);
  };

  #assertOperational() {
    if (this.#status !== "ready" && this.#status !== "paused") {
      throw new Error(`Runtime is not operational: ${this.#status}.`);
    }
  }

  #parseInspectionResult(payload: unknown): InspectionResult {
    const parsed = inspectionResultSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("Sandbox returned an invalid inspection result.");
    }
    if (
      parsed.data.target.runtimeInstanceId !==
      this.options.runtimeInstanceId
    ) {
      throw new Error("Inspection result belongs to a different runtime.");
    }
    return parsed.data;
  }

  #request(
    type: RuntimeMessageType,
    expectedType: RuntimeMessageType,
    payload: unknown,
  ): Promise<RuntimeMessageEnvelope> {
    const target = this.#iframe.contentWindow;
    if (!target) {
      return Promise.reject(new Error("Sandbox iframe is not mounted."));
    }
    const messageId = crypto.randomUUID();
    const envelope = {
      protocolVersion: 1 as const,
      runtimeInstanceId: this.options.runtimeInstanceId,
      messageId,
      type,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        this.#pending.delete(messageId);
        reject(new Error(`Sandbox message timed out: ${type}.`));
      }, MESSAGE_TIMEOUT_MS);
      this.#pending.set(messageId, {
        expectedType,
        resolve,
        reject,
        timeoutId,
      });
      target.postMessage(envelope, "*");
    });
  }
}
