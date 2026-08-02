import { z } from "zod";

import { learningLessonKindSchema } from "./learning-proof";

export const transferAssessmentKindSchema = z.enum([
  "immediate-hidden",
  "delayed-retention",
]);

export const transferAssessmentStatusSchema = z.enum([
  "locked",
  "available",
  "passed-on-time",
  "passed-late",
]);

export const transferAssessmentItemSchema = z.object({
  itemId: z.string().trim().min(1).max(120),
  courseId: learningLessonKindSchema,
  kind: transferAssessmentKindSchema,
  status: transferAssessmentStatusSchema,
  dueAt: z.string().datetime({ offset: true }).nullable(),
  closesAt: z.string().datetime({ offset: true }).nullable(),
  revealedAt: z.string().datetime({ offset: true }).nullable(),
  passedAt: z.string().datetime({ offset: true }).nullable(),
  attemptCount: z.number().int().nonnegative(),
  prompt: z.string().trim().min(1).max(800).optional(),
  html: z.string().min(1).max(20_000).optional(),
  baseCss: z.string().min(1).max(20_000).optional(),
  targetSelector: z.string().trim().min(1).max(200).optional(),
});

export const transferAssessmentListResponseSchema = z.object({
  sessionId: z.string().uuid(),
  courseId: learningLessonKindSchema,
  claimBoundary: z.literal(
    "两次迁移和延迟保持均有证据后，才可讨论长期掌握。",
  ),
  items: z.array(transferAssessmentItemSchema).length(2),
});

export const submitTransferAssessmentRequestSchema = z
  .object({
    itemId: z.string().trim().min(1).max(120),
    answer: z.string().trim().min(1).max(200),
  })
  .strict();

export const submitTransferAssessmentResponseSchema = z.object({
  itemId: z.string().trim().min(1).max(120),
  passed: z.boolean(),
  submittedInWindow: z.boolean(),
  attemptSequence: z.number().int().positive(),
  feedback: z.string().trim().min(1).max(500),
  normalizedAnswer: z.string().trim().min(1).max(200).nullable(),
});

export type TransferAssessmentKind = z.infer<
  typeof transferAssessmentKindSchema
>;
export type TransferAssessmentStatus = z.infer<
  typeof transferAssessmentStatusSchema
>;
export type TransferAssessmentItem = z.infer<
  typeof transferAssessmentItemSchema
>;
export type TransferAssessmentListResponse = z.infer<
  typeof transferAssessmentListResponseSchema
>;
export type SubmitTransferAssessmentRequest = z.infer<
  typeof submitTransferAssessmentRequestSchema
>;
export type SubmitTransferAssessmentResponse = z.infer<
  typeof submitTransferAssessmentResponseSchema
>;
