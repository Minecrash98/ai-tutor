export const REALTIME_PERFORMANCE_POLICY = {
  version: "p6-performance-v2",
  voiceT0: "last-above-threshold-vad-sample",
  textT0: "before-text-input-http-request",
  inputTranscriptFinal: "final-user-transcript-received-after-voice-t0",
  confirmationAudio:
    "controlled-acknowledgement-playback-started-event-or-play-promise",
  firstMeaningfulCaption:
    "first-visible-assistant-or-canvas-ready-caption-with-two-nonspace-characters-after-voice-intent-gating",
  firstModelAudio:
    "first-output-audio-delta-or-audible-remote-audio-or-playing-event",
  canvasVisibleT1: "first-animation-frame-after-successful-mutating-canvas-tool",
  percentile: "nearest-rank",
  failures: "included-in-denominator-and-reported-separately",
  startup: "cold-and-warm-reported-separately",
} as const;

export const REMOTE_AUDIO_RMS_THRESHOLD = 0.001;

export function remoteAudioRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let squareSum = 0;
  for (const sample of samples) squareSum += sample * sample;
  return Math.sqrt(squareSum / samples.length);
}

export function nearestRankPercentile(
  samples: readonly number[],
  percentile: number,
): number | null {
  if (samples.length === 0) return null;
  if (!(percentile > 0 && percentile <= 1)) {
    throw new RangeError("percentile must be greater than 0 and at most 1");
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const rank = Math.ceil(percentile * sorted.length);
  return sorted[rank - 1] ?? null;
}

export function summarizeLatency(samples: readonly number[]) {
  return {
    count: samples.length,
    minimum: samples.length === 0 ? null : Math.min(...samples),
    p50: nearestRankPercentile(samples, 0.5),
    p95: nearestRankPercentile(samples, 0.95),
    maximum: samples.length === 0 ? null : Math.max(...samples),
  } as const;
}
