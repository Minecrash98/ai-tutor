import { describe, expect, it } from "vitest";

import {
  REALTIME_PERFORMANCE_POLICY,
  REMOTE_AUDIO_RMS_THRESHOLD,
  nearestRankPercentile,
  remoteAudioRms,
  summarizeLatency,
} from "./realtime-performance";

describe("Realtime performance policy", () => {
  it("uses the frozen nearest-rank percentile rule", () => {
    const samples = [2487, 1700, 2078, 2331, 1900];
    expect(nearestRankPercentile(samples, 0.5)).toBe(2078);
    expect(nearestRankPercentile(samples, 0.95)).toBe(2487);
    expect(summarizeLatency(samples)).toEqual({
      count: 5,
      minimum: 1700,
      p50: 2078,
      p95: 2487,
      maximum: 2487,
    });
  });

  it("keeps every milestone and failure boundary explicit", () => {
    expect(REALTIME_PERFORMANCE_POLICY).toMatchObject({
      version: "p6-performance-v2",
      voiceT0: "last-above-threshold-vad-sample",
      textT0: "before-text-input-http-request",
      inputTranscriptFinal: "final-user-transcript-received-after-voice-t0",
      confirmationAudio:
        "controlled-acknowledgement-playback-started-event-or-play-promise",
      firstModelAudio:
        "first-output-audio-delta-or-audible-remote-audio-or-playing-event",
      firstMeaningfulCaption:
        "first-visible-assistant-or-canvas-ready-caption-with-two-nonspace-characters-after-voice-intent-gating",
      percentile: "nearest-rank",
      failures: "included-in-denominator-and-reported-separately",
      startup: "cold-and-warm-reported-separately",
    });
  });

  it("separates remote silence from audible model audio", () => {
    expect(remoteAudioRms(new Float32Array(128))).toBe(0);
    expect(remoteAudioRms(new Float32Array([0.004, -0.004]))).toBeGreaterThan(
      REMOTE_AUDIO_RMS_THRESHOLD,
    );
  });
});
