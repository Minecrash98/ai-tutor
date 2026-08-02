import { z } from "zod";

export * from "./realtime";
export * from "./learning-proof";
export * from "./learning-analysis";
export * from "./transfer-assessment";

export const RUNTIME_PROTOCOL_VERSION = 1 as const;

export const runtimeIdSchema = z.string().trim().min(1);

export const runtimeCapabilitiesSchema = z.object({
  html: z.boolean(),
  css: z.boolean(),
  javascript: z.boolean(),
  packageManager: z.boolean(),
  elementInspection: z.boolean(),
  transientStyles: z.boolean(),
});

export const runtimeMessageTypeSchema = z.enum([
  "runtime.init",
  "runtime.render",
  "runtime.enable_selection",
  "runtime.clear_selection",
  "runtime.pause",
  "runtime.resume",
  "runtime.dispose",
  "runtime.inspect",
  "runtime.apply_transient_style",
  "runtime.reset_transient_state",
  "runtime.set_box_model_overlay",
  "runtime.set_comparison_viewport",
  "runtime.ready",
  "runtime.rendered",
  "runtime.selection_enabled",
  "runtime.selection_cleared",
  "runtime.element_selected",
  "runtime.inspection_error",
  "runtime.paused",
  "runtime.resumed",
  "runtime.inspection_result",
  "runtime.transient_style_applied",
  "runtime.transient_state_reset",
  "runtime.box_model_overlay_set",
  "runtime.comparison_viewport_set",
  "runtime.measurement",
  "runtime.error",
  "runtime.disposed",
]);

export type RuntimeMessageType = z.infer<typeof runtimeMessageTypeSchema>;

export type RuntimeCapabilities = z.infer<
  typeof runtimeCapabilitiesSchema
>;

export const runtimeMessageEnvelopeSchema = z.object({
  protocolVersion: z.literal(RUNTIME_PROTOCOL_VERSION),
  runtimeInstanceId: z.string().trim().min(1),
  messageId: z.string().trim().min(1),
  type: runtimeMessageTypeSchema,
  payload: z.unknown(),
});

export type RuntimeMessageEnvelope = z.infer<
  typeof runtimeMessageEnvelopeSchema
>;

export const runtimeComparisonViewportStateSchema = z.object({
  mode: z.enum(["focus", "page"]),
  scrollTop: z.number().finite().nonnegative(),
  scrollLeft: z.number().finite().nonnegative(),
  maxScrollTop: z.number().finite().nonnegative(),
  maxScrollLeft: z.number().finite().nonnegative(),
  viewportWidth: z.number().finite().positive(),
  viewportHeight: z.number().finite().positive(),
  documentWidth: z.number().finite().positive(),
  documentHeight: z.number().finite().positive(),
  scrollRatio: z.number().finite().min(0).max(1),
  zoom: z.literal(1),
  targetViewportCenterY: z.number().finite().nullable(),
});

export type RuntimeComparisonViewportState = z.infer<
  typeof runtimeComparisonViewportStateSchema
>;

const finiteNumberSchema = z.number().finite();

export const elementTargetSchema = z.object({
  runtimeInstanceId: z.string().trim().min(1),
  domPath: z.string().trim().min(1),
  fingerprint: z.string().trim().min(1).optional(),
});

export const rectSchema = z.object({
  x: finiteNumberSchema,
  y: finiteNumberSchema,
  width: finiteNumberSchema.nonnegative(),
  height: finiteNumberSchema.nonnegative(),
  top: finiteNumberSchema,
  right: finiteNumberSchema,
  bottom: finiteNumberSchema,
  left: finiteNumberSchema,
});

export const boxEdgesSchema = z.object({
  top: finiteNumberSchema,
  right: finiteNumberSchema,
  bottom: finiteNumberSchema,
  left: finiteNumberSchema,
});

export const boxModelMetricsSchema = z.object({
  content: z.object({
    width: finiteNumberSchema.nonnegative(),
    height: finiteNumberSchema.nonnegative(),
  }),
  padding: boxEdgesSchema,
  border: boxEdgesSchema,
  margin: boxEdgesSchema,
  boxSizing: z.string(),
});

export const matchedCssDeclarationSchema = z.object({
  property: z.string().trim().min(1),
  value: z.string(),
  important: z.boolean(),
  inherited: z.boolean(),
});

export const cssSourceLocationSchema = z.object({
  filePath: z.string().trim().min(1),
  line: z.number().int().positive().nullable(),
  column: z.number().int().positive().nullable(),
  kind: z.enum(["stylesheet", "inline-style"]),
});

export const matchedCssRuleSchema = z.object({
  selectorText: z.string().trim().min(1),
  source: cssSourceLocationSchema,
  specificity: z.tuple([
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
    z.number().int().nonnegative(),
  ]),
  sourceOrder: z.number().int().nonnegative(),
  declarations: z.array(matchedCssDeclarationSchema),
  inheritedFrom: elementTargetSchema.optional(),
  pseudoElement: z.enum(["::before", "::after"]).nullable(),
});

export const inspectionDiagnosticSchema = z.object({
  severity: z.enum(["info", "warning", "error"]),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
});

export const inspectionTargetCandidateSchema = z.object({
  target: elementTargetSchema,
  domPath: z.string().trim().min(1),
  tagName: z.string().trim().min(1),
  attributes: z.record(z.string(), z.string()),
});

export const inspectionResultSchema = z.object({
  target: elementTargetSchema,
  domPath: z.string().trim().min(1),
  tagName: z.string().trim().min(1),
  attributes: z.record(z.string(), z.string()),
  boundingRect: rectSchema,
  boxModel: boxModelMetricsSchema,
  computedStyles: z.record(z.string(), z.string()),
  matchedRules: z.array(matchedCssRuleSchema),
  diagnostics: z.array(inspectionDiagnosticSchema),
  relations: z
    .object({
      parent: inspectionTargetCandidateSchema.nullable(),
      children: z.array(inspectionTargetCandidateSchema).max(24),
    })
    .optional(),
});

export type ElementTarget = z.infer<typeof elementTargetSchema>;
export type Rect = z.infer<typeof rectSchema>;
export type BoxEdges = z.infer<typeof boxEdgesSchema>;
export type BoxModelMetrics = z.infer<typeof boxModelMetricsSchema>;
export type MatchedCssDeclaration = z.infer<
  typeof matchedCssDeclarationSchema
>;
export type CssSourceLocation = z.infer<typeof cssSourceLocationSchema>;
export type MatchedCssRule = z.infer<typeof matchedCssRuleSchema>;
export type InspectionDiagnostic = z.infer<
  typeof inspectionDiagnosticSchema
>;
export type InspectionTargetCandidate = z.infer<
  typeof inspectionTargetCandidateSchema
>;
export type InspectionResult = z.infer<typeof inspectionResultSchema>;

export const runtimeMeasurementSchema = z.object({
  name: z.enum(["transient-style"]),
  durationMs: finiteNumberSchema.nonnegative(),
});

export type RuntimeMeasurement = z.infer<typeof runtimeMeasurementSchema>;

export interface RuntimeDescriptor {
  readonly id: string;
  readonly capabilities: RuntimeCapabilities;
}
