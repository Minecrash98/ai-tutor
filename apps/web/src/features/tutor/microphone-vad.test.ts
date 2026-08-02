import { describe, expect, it } from "vitest";

import {
  CalibratedEnergyVad,
  KNOWN_VAD_LIMITATIONS,
  VAD_CALIBRATION_SAMPLES,
  VAD_SAMPLE_INTERVAL_MS,
  VAD_SILENCE_MS,
} from "./microphone-vad";

interface SyntheticProfile {
  readonly name: string;
  readonly calibration: (index: number) => number;
  readonly speechRms: number;
}

const profiles: readonly SyntheticProfile[] = [
  { name: "quiet", calibration: () => 0.003, speechRms: 0.028 },
  {
    name: "fan",
    calibration: (index) => 0.007 + (index % 3) * 0.0005,
    speechRms: 0.04,
  },
  {
    name: "keyboard impulses",
    calibration: (index) => (index === 4 || index === 15 ? 0.045 : 0.006),
    speechRms: 0.036,
  },
  {
    name: "classroom murmur",
    calibration: (index) => 0.016 + (index % 4) * 0.0005,
    speechRms: 0.058,
  },
  { name: "low-gain microphone", calibration: () => 0.002, speechRms: 0.022 },
  { name: "high-gain microphone", calibration: () => 0.024, speechRms: 0.08 },
];

function runProfile(profile: SyntheticProfile) {
  const vad = new CalibratedEnergyVad();
  const events = [] as ReturnType<CalibratedEnergyVad["sample"]>[number][];
  let atMs = 0;
  for (let index = 0; index < VAD_CALIBRATION_SAMPLES; index += 1) {
    events.push(...vad.sample(profile.calibration(index), atMs));
    atMs += VAD_SAMPLE_INTERVAL_MS;
  }
  for (let index = 0; index < 8; index += 1) {
    events.push(...vad.sample(profile.speechRms, atMs));
    atMs += VAD_SAMPLE_INTERVAL_MS;
  }
  for (let index = 0; index < 4; index += 1) {
    events.push(...vad.sample(0, atMs));
    atMs += VAD_SAMPLE_INTERVAL_MS;
  }
  for (let index = 0; index < 4; index += 1) {
    events.push(...vad.sample(profile.speechRms, atMs));
    atMs += VAD_SAMPLE_INTERVAL_MS;
  }
  for (let index = 0; index <= VAD_SILENCE_MS / VAD_SAMPLE_INTERVAL_MS; index += 1) {
    events.push(...vad.sample(0, atMs));
    atMs += VAD_SAMPLE_INTERVAL_MS;
  }
  return { events, snapshot: vad.snapshot() };
}

describe("calibrated microphone energy VAD", () => {
  for (const profile of profiles) {
    it(`detects one utterance without a false stop for ${profile.name}`, () => {
      const { events, snapshot } = runProfile(profile);
      expect(events.map((event) => event.type)).toEqual([
        "calibrated",
        "speech_started",
        "speech_stopped",
      ]);
      expect(snapshot.calibrated).toBe(true);
      expect(snapshot.threshold).toBeGreaterThan(snapshot.noiseFloor);
      const stopped = events.find((event) => event.type === "speech_stopped");
      expect(stopped).toBeDefined();
      if (stopped?.type !== "speech_stopped") {
        throw new Error("Expected a speech_stopped transition");
      }
      expect(stopped.atMs - stopped.speechEndedAtMs).toBeGreaterThanOrEqual(
        VAD_SILENCE_MS,
      );
    });
  }

  it("does not treat isolated keyboard spikes as speech after calibration", () => {
    const vad = new CalibratedEnergyVad();
    let atMs = 0;
    for (let index = 0; index < VAD_CALIBRATION_SAMPLES; index += 1) {
      vad.sample(0.006, atMs);
      atMs += VAD_SAMPLE_INTERVAL_MS;
    }
    const events = [] as ReturnType<CalibratedEnergyVad["sample"]>[number][];
    for (let index = 0; index < 40; index += 1) {
      events.push(...vad.sample(index % 10 === 0 ? 0.04 : 0.006, atMs));
      atMs += VAD_SAMPLE_INTERVAL_MS;
    }
    expect(events).toEqual([]);
  });

  it("documents the frozen low-SNR miss instead of claiming universal detection", () => {
    const vad = new CalibratedEnergyVad();
    let atMs = 0;
    for (let index = 0; index < VAD_CALIBRATION_SAMPLES; index += 1) {
      vad.sample(0.03, atMs);
      atMs += VAD_SAMPLE_INTERVAL_MS;
    }
    const events = [] as ReturnType<CalibratedEnergyVad["sample"]>[number][];
    for (let index = 0; index < 20; index += 1) {
      events.push(...vad.sample(0.04, atMs));
      atMs += VAD_SAMPLE_INTERVAL_MS;
    }
    expect(events).toEqual([]);
    expect(KNOWN_VAD_LIMITATIONS).toHaveLength(1);
  });
});
