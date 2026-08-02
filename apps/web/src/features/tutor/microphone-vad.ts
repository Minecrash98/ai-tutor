export const VAD_SAMPLE_INTERVAL_MS = 50;
export const VAD_CALIBRATION_SAMPLES = 20;
export const VAD_SILENCE_MS = 500;
export const VAD_MIN_RMS_THRESHOLD = 0.012;
export const VAD_MAX_RMS_THRESHOLD = 0.06;
export const VAD_NOISE_MULTIPLIER = 2.5;
export const VAD_START_CONSECUTIVE_SAMPLES = 2;

export const KNOWN_VAD_LIMITATIONS = [
  "When speech RMS stays too close to sustained background RMS, energy-only VAD may miss speech.",
] as const;

export type VadTransition =
  | {
      readonly type: "calibrated";
      readonly atMs: number;
      readonly noiseFloor: number;
      readonly threshold: number;
      readonly sampleCount: number;
    }
  | {
      readonly type: "speech_started";
      readonly atMs: number;
      readonly rms: number;
      readonly noiseFloor: number;
      readonly threshold: number;
    }
  | {
      readonly type: "speech_stopped";
      readonly atMs: number;
      readonly speechEndedAtMs: number;
      readonly speechDurationMs: number;
      readonly noiseFloor: number;
      readonly threshold: number;
    };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function nearestRank(values: readonly number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(percentile * sorted.length));
  return sorted[rank - 1] ?? 0;
}

export class CalibratedEnergyVad {
  private readonly calibration: number[] = [];
  private calibrated = false;
  private noiseFloor = 0;
  private threshold = VAD_MIN_RMS_THRESHOLD;
  private consecutiveVoiceSamples = 0;
  private speechActive = false;
  private speechStartedAtMs = 0;
  private lastVoiceAtMs = 0;

  sample(rms: number, atMs: number): readonly VadTransition[] {
    const normalizedRms = Number.isFinite(rms) ? Math.max(0, rms) : 0;
    if (!this.calibrated) {
      this.calibration.push(normalizedRms);
      if (this.calibration.length < VAD_CALIBRATION_SAMPLES) return [];
      this.noiseFloor = nearestRank(this.calibration, 0.8);
      this.threshold = clamp(
        this.noiseFloor * VAD_NOISE_MULTIPLIER,
        VAD_MIN_RMS_THRESHOLD,
        VAD_MAX_RMS_THRESHOLD,
      );
      this.calibrated = true;
      return [
        {
          type: "calibrated",
          atMs,
          noiseFloor: this.noiseFloor,
          threshold: this.threshold,
          sampleCount: this.calibration.length,
        },
      ];
    }

    if (normalizedRms >= this.threshold) {
      this.lastVoiceAtMs = atMs;
      if (this.speechActive) return [];
      this.consecutiveVoiceSamples += 1;
      if (this.consecutiveVoiceSamples < VAD_START_CONSECUTIVE_SAMPLES) return [];
      this.speechActive = true;
      this.speechStartedAtMs =
        atMs - (VAD_START_CONSECUTIVE_SAMPLES - 1) * VAD_SAMPLE_INTERVAL_MS;
      return [
        {
          type: "speech_started",
          atMs: this.speechStartedAtMs,
          rms: normalizedRms,
          noiseFloor: this.noiseFloor,
          threshold: this.threshold,
        },
      ];
    }

    this.consecutiveVoiceSamples = 0;
    if (
      !this.speechActive ||
      this.lastVoiceAtMs <= 0 ||
      atMs - this.lastVoiceAtMs < VAD_SILENCE_MS
    ) {
      return [];
    }
    this.speechActive = false;
    const speechEndedAtMs = this.lastVoiceAtMs;
    this.lastVoiceAtMs = 0;
    return [
      {
        type: "speech_stopped",
        atMs,
        speechEndedAtMs,
        speechDurationMs: Math.max(0, speechEndedAtMs - this.speechStartedAtMs),
        noiseFloor: this.noiseFloor,
        threshold: this.threshold,
      },
    ];
  }

  snapshot() {
    return {
      calibrated: this.calibrated,
      calibrationSamples: this.calibration.length,
      noiseFloor: this.noiseFloor,
      threshold: this.threshold,
      speechActive: this.speechActive,
    } as const;
  }
}
