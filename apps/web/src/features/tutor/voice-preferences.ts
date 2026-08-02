export const VOICE_PREFERENCES_STORAGE_KEY =
  "ai-tutor-voice-preferences-v1";

export type VoiceInputMode = "push-to-talk" | "continuous";

export interface VoicePreferences {
  readonly inputMode: VoiceInputMode | null;
  readonly deviceId: string | null;
  readonly outputMuted: boolean;
  readonly outputVolume: number;
  readonly playbackRate: number;
  readonly captionsEnabled: boolean;
}

export interface VoicePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = Object.freeze({
  inputMode: null,
  deviceId: null,
  outputMuted: false,
  outputVolume: 1,
  playbackRate: 1,
  captionsEnabled: true,
});

const PLAYBACK_RATES = [0.8, 1, 1.2] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPlaybackRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    PLAYBACK_RATES.some((candidate) => candidate === value)
  );
}

export function parseVoicePreferences(value: unknown): VoicePreferences {
  if (!isRecord(value)) return DEFAULT_VOICE_PREFERENCES;
  const inputMode =
    value.inputMode === "continuous" || value.inputMode === "push-to-talk"
      ? value.inputMode
      : DEFAULT_VOICE_PREFERENCES.inputMode;
  const outputMuted =
    typeof value.outputMuted === "boolean"
      ? value.outputMuted
      : DEFAULT_VOICE_PREFERENCES.outputMuted;
  const outputVolume =
    typeof value.outputVolume === "number" &&
    Number.isFinite(value.outputVolume)
      ? Math.min(1, Math.max(0, value.outputVolume))
      : DEFAULT_VOICE_PREFERENCES.outputVolume;

  return {
    inputMode,
    deviceId:
      typeof value.deviceId === "string" && value.deviceId.length <= 256
        ? value.deviceId
        : null,
    outputMuted,
    outputVolume,
    playbackRate: isPlaybackRate(value.playbackRate)
      ? value.playbackRate
      : DEFAULT_VOICE_PREFERENCES.playbackRate,
    captionsEnabled: outputMuted
      ? true
      : typeof value.captionsEnabled === "boolean"
        ? value.captionsEnabled
        : DEFAULT_VOICE_PREFERENCES.captionsEnabled,
  };
}

export function loadVoicePreferences(
  storage: VoicePreferenceStorage,
): VoicePreferences {
  try {
    const raw = storage.getItem(VOICE_PREFERENCES_STORAGE_KEY);
    if (!raw) return DEFAULT_VOICE_PREFERENCES;
    return parseVoicePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}

export function saveVoicePreferences(
  storage: VoicePreferenceStorage,
  preferences: VoicePreferences,
): void {
  storage.setItem(
    VOICE_PREFERENCES_STORAGE_KEY,
    JSON.stringify(parseVoicePreferences(preferences)),
  );
}

export function shouldEnableMicrophoneTrack(
  preferences: Pick<VoicePreferences, "inputMode">,
  muted: boolean,
  pushToTalkActive: boolean,
): boolean {
  if (muted) return false;
  return (
    preferences.inputMode === "continuous" ||
    (preferences.inputMode === "push-to-talk" && pushToTalkActive)
  );
}
