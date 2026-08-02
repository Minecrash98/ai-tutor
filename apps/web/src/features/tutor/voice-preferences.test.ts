import { describe, expect, it } from "vitest";

import {
  DEFAULT_VOICE_PREFERENCES,
  VOICE_PREFERENCES_STORAGE_KEY,
  loadVoicePreferences,
  parseVoicePreferences,
  saveVoicePreferences,
  shouldEnableMicrophoneTrack,
  type VoicePreferenceStorage,
} from "./voice-preferences";

class MemoryStorage implements VoicePreferenceStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("voice preferences", () => {
  it("requires an explicit first choice and keeps captions visible", () => {
    expect(DEFAULT_VOICE_PREFERENCES).toMatchObject({
      inputMode: null,
      outputMuted: false,
      outputVolume: 1,
      playbackRate: 1,
      captionsEnabled: true,
    });
    expect(
      shouldEnableMicrophoneTrack(DEFAULT_VOICE_PREFERENCES, false, false),
    ).toBe(false);
    expect(
      shouldEnableMicrophoneTrack(DEFAULT_VOICE_PREFERENCES, false, true),
    ).toBe(false);
    expect(
      shouldEnableMicrophoneTrack(
        { inputMode: "push-to-talk" },
        false,
        true,
      ),
    ).toBe(true);
  });

  it("keeps mute authoritative in both input modes", () => {
    expect(
      shouldEnableMicrophoneTrack({ inputMode: "continuous" }, true, true),
    ).toBe(false);
    expect(
      shouldEnableMicrophoneTrack({ inputMode: "continuous" }, false, false),
    ).toBe(true);
  });

  it("round-trips valid local preferences", () => {
    const storage = new MemoryStorage();
    saveVoicePreferences(storage, {
      inputMode: "continuous",
      deviceId: "classroom-mic",
      outputMuted: false,
      outputVolume: 0.45,
      playbackRate: 0.8,
      captionsEnabled: false,
    });
    expect(loadVoicePreferences(storage)).toEqual({
      inputMode: "continuous",
      deviceId: "classroom-mic",
      outputMuted: false,
      outputVolume: 0.45,
      playbackRate: 0.8,
      captionsEnabled: false,
    });
  });

  it("never restores silent output with captions also hidden", () => {
    expect(
      parseVoicePreferences({
        inputMode: "push-to-talk",
        outputMuted: true,
        captionsEnabled: false,
      }),
    ).toMatchObject({ outputMuted: true, captionsEnabled: true });
  });

  it("repairs malformed and out-of-range values without throwing", () => {
    expect(parseVoicePreferences({ outputVolume: 4, playbackRate: 9 })).toEqual({
      ...DEFAULT_VOICE_PREFERENCES,
      outputVolume: 1,
    });
    const storage = new MemoryStorage();
    storage.setItem(VOICE_PREFERENCES_STORAGE_KEY, "{broken");
    expect(loadVoicePreferences(storage)).toBe(DEFAULT_VOICE_PREFERENCES);
  });
});
