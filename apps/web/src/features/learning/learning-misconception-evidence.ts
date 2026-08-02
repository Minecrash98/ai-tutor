import {
  learnerMisconceptionEvidenceSchema,
  type LearnerMisconceptionEvidence,
  type LearningLessonKind,
  type LearningLessonRecordedEvent,
  type LearningReplayBundle,
} from "@ai-tutor/contracts";
import {
  diagnoseCourseMisconceptions,
  type DiagnosticObservation,
} from "@ai-tutor/curriculum";

function observation(
  event: LearningLessonRecordedEvent,
  stage: DiagnosticObservation["stage"],
  signalId: string,
): DiagnosticObservation {
  return { observationId: event.eventId, stage, signalId };
}

export function diagnosticObservationsFromLearningEvents(
  lessonKind: LearningLessonKind,
  events: readonly LearningLessonRecordedEvent[],
): readonly DiagnosticObservation[] {
  return events.flatMap((event): readonly DiagnosticObservation[] => {
    if (lessonKind === "box-model-v1") {
      if (event.type === "predict" && event.answer === "same") {
        return [observation(event, "prediction", "prediction.same")];
      }
      if (event.type === "explain" && event.answer === "margin-pushes") {
        return [
          observation(event, "explanation", "explanation.margin-pushes"),
        ];
      }
      if (
        event.type === "transfer-submit" &&
        /(?:^|[;{])\s*margin(?:-[a-z-]+)?\s*:/i.test(event.code)
      ) {
        return [observation(event, "transfer", "transfer.margin")];
      }
      return [];
    }

    if (lessonKind === "flex-v1") {
      if (
        event.type === "scenario-predict" &&
        event.answer === "gap-resizes-items"
      ) {
        return [
          observation(event, "prediction", "prediction.gap-resizes"),
        ];
      }
      if (
        event.type === "scenario-explain" &&
        event.answer === "gap-changes-item-size"
      ) {
        return [
          observation(event, "explanation", "explanation.gap-is-padding"),
        ];
      }
      if (
        event.type === "scenario-explain" &&
        event.answer === "justify-is-cross-axis"
      ) {
        return [
          observation(event, "explanation", "explanation.axes-coupled"),
        ];
      }
      return [];
    }

    if (
      event.type === "scenario-predict" &&
      event.answer === "relative-leaves-flow"
    ) {
      return [
        observation(event, "prediction", "prediction.relative-leaves-flow"),
      ];
    }
    if (
      event.type === "scenario-explain" &&
      event.answer === "relative-leaves-flow"
    ) {
      return [
        observation(event, "explanation", "explanation.relative-leaves-flow"),
      ];
    }
    if (
      event.type === "scenario-explain" &&
      event.answer === "viewport-always"
    ) {
      return [
        observation(event, "explanation", "explanation.viewport-always"),
      ];
    }
    return [];
  });
}

export function deriveLearnerMisconceptionEvidence(input: {
  readonly lessonKind: LearningLessonKind;
  readonly sessionId: string;
  readonly events: readonly LearningLessonRecordedEvent[];
}): readonly LearnerMisconceptionEvidence[] {
  const observations = diagnosticObservationsFromLearningEvents(
    input.lessonKind,
    input.events,
  );
  return diagnoseCourseMisconceptions(input.lessonKind, observations)
    .filter((diagnosis) => diagnosis.state !== "none")
    .map((diagnosis) =>
      learnerMisconceptionEvidenceSchema.parse({
        lessonKind: input.lessonKind,
        sourceSessionId: input.sessionId,
        misconceptionId: diagnosis.misconceptionId,
        state:
          diagnosis.state === "supported" ? "repeated-pattern" : "uncertain",
        sourceEventIds: diagnosis.matchedObservationIds,
      }),
    );
}

export function deriveReplayMisconceptionEvidence(
  replay: LearningReplayBundle,
  throughSequence = replay.session.latestSequence,
): readonly LearnerMisconceptionEvidence[] {
  return deriveLearnerMisconceptionEvidence({
    lessonKind: replay.session.lessonKind,
    sessionId: replay.session.sessionId,
    events: replay.events
      .filter((record) => record.sequence <= throughSequence)
      .map((record) => record.event),
  });
}

export function strongestMisconceptionState(
  evidence: readonly LearnerMisconceptionEvidence[],
): "none" | "uncertain" | "supported" {
  if (evidence.some((item) => item.state === "repeated-pattern")) {
    return "supported";
  }
  return evidence.length > 0 ? "uncertain" : "none";
}
