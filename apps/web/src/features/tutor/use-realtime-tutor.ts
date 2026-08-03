"use client";

import {
  createRealtimeSessionResponseSchema,
  realtimeCapabilityResponseSchema,
  realtimePublicEventSchema,
  type RealtimeClientDiagnostic,
  type LearningAuditEventInput,
  type RealtimeTutorCue,
  type RealtimeToolResult,
  type TutorTopic,
} from "@ai-tutor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  CalibratedEnergyVad,
  VAD_SAMPLE_INTERVAL_MS,
} from "./microphone-vad";
import {
  REALTIME_PERFORMANCE_POLICY,
  REMOTE_AUDIO_RMS_THRESHOLD,
  remoteAudioRms,
} from "./realtime-performance";
import { VoiceIntentOutputGate } from "./voice-intent-output-gate";
import {
  shouldEnableMicrophoneTrack,
  type VoicePreferences,
} from "./voice-preferences";

export type RealtimeTutorStatus =
  | "idle"
  | "checking"
  | "requesting-microphone"
  | "connecting"
  | "connected"
  | "listening"
  | "thinking"
  | "doing"
  | "speaking"
  | "reconnecting"
  | "stopped"
  | "error";

export type RealtimeTutorMode = "text" | "voice";

export interface TutorTranscriptEntry {
  readonly id: string;
  readonly role: string;
  readonly text: string;
  readonly final: boolean;
}

export interface TutorFactReceipt {
  readonly allowed: boolean;
  readonly target: string;
  readonly property: string | null;
  readonly beforeValue: string | null;
  readonly afterValue: string | null;
  readonly selector: string | null;
  readonly source: string | null;
  readonly ruleValue: string | null;
  readonly uncertainty: string | null;
}

interface UseRealtimeTutorOptions {
  readonly topic: TutorTopic;
  readonly saveLearningRecord: boolean;
  readonly voicePreferences: VoicePreferences;
  readonly learningSessionId?: string | null;
  readonly onToolCall: (
    tool: string,
    argumentsValue: unknown,
  ) => Promise<RealtimeToolResult>;
  readonly onLearningAudit?: (
    learningSessionId: string,
    event: LearningAuditEventInput,
  ) => void;
}

interface QueuedDiagnostic extends RealtimeClientDiagnostic {
  readonly sessionId: string;
  readonly attempts: number;
}

type PerformanceMilestone =
  | "input_transcript_final"
  | "confirmation_audio"
  | "first_meaningful_caption"
  | "first_model_audio"
  | "canvas_visible_t1";

interface PerformanceTurn {
  readonly id: string;
  readonly mode: RealtimeTutorMode;
  readonly t0AtMs: number;
  readonly t0Source: string;
  readonly startupKind: "cold" | "warm";
  captionText: string;
  modelOutputObserved: boolean;
  readonly recorded: Set<PerformanceMilestone>;
}

const DIAGNOSTIC_FLUSH_MS = 1_500;
const DIAGNOSTIC_RETRY_MS = 2_000;
const DIAGNOSTIC_RATE_RETRY_MS = 15_000;
const VOICE_INTENT_GATE_TIMEOUT_MS = 8_000;
const WEBRTC_STATS_INTERVAL_MS = 5_000;
const REMOTE_AUDIO_SAMPLE_INTERVAL_MS = 50;
const MICROPHONE_LEVEL_INTERVAL_MS = 2_000;
const CANVAS_GROUNDED_REQUEST_PATTERN =
  /(?:创建|生成|做(?:一个|个)|建(?:一个|个)|修改|改成|调到|拖动|拖拽|对比|比较|控制|聚焦|放到画布|刚才改|页面为什么变成)/;
const CAUSAL_ASSERTION_REQUEST_PATTERN =
  /(?:为什么|为何|什么原因|哪条规则|什么规则|怎么导致|因果|刚才.{0,16}(?:变大|变小|移动|变化)|(?:变大|变小|移动|变化).{0,12}(?:原因|规则))/;
const CAUSAL_PAGE_CONTEXT_PATTERN =
  /(?:这张|这个|当前|页面|画布|卡片|元素|刚才|选中|它|前后|变大|变小|移动|变化)/;
const CANVAS_PROCESS_NARRATION_PATTERN =
  /^(?:(?:明白|好的|好)[，,。!！]*)?(?:我先|我来(?:准备|创建|做|检查|看)|让我(?:先)?|接着|然后我|下一步|第一步|第二步|我会(?:先|依次)|每一步)/;
const CANVAS_RESULT_RESPONSE_PATTERN =
  /^(?:(?:明白|好的|好)[，,。!！]*)?(?:我已|已经|已把|我刚|你刚|现在|完成|演示|页面|画布|这个|padding|对比)/i;
const CANVAS_VISIBLE_CONFIRMATION = "画布已经更新，你可以先看看。";
const MUTATING_TUTOR_TOOLS = new Set([
  "create_explanation_block",
  "create_demo_block",
  "apply_css_change",
  "create_css_controller",
  "create_comparison",
  "focus_block",
]);

export function requiresCanvasGrounding(text: string): boolean {
  return canvasGroundingRequirement(text) !== null;
}

export type CanvasGroundingRequirement = "canvas-change" | "causal-assertion";

export function canvasGroundingRequirement(
  text: string,
): CanvasGroundingRequirement | null {
  const normalized = text
    .replace(/\s+/g, "")
    .replace(/(?:不要|不用|无需|别)(?:再)?(?:修改|改动|操作)(?:我的)?(?:画布|页面|内容)/g, "");
  if (
    CAUSAL_ASSERTION_REQUEST_PATTERN.test(normalized) &&
    CAUSAL_PAGE_CONTEXT_PATTERN.test(normalized)
  ) {
    return "causal-assertion";
  }
  return CANVAS_GROUNDED_REQUEST_PATTERN.test(normalized)
    ? "canvas-change"
    : null;
}

export function classifyCanvasAssistantSegment(
  text: string,
  toolResultObserved: boolean,
  final: boolean,
): "wait" | "suppress" | "reveal" {
  const normalized = text.replace(/\s+/g, "");
  if (CANVAS_PROCESS_NARRATION_PATTERN.test(normalized)) return "suppress";
  if (!toolResultObserved) return final ? "suppress" : "wait";
  if (CANVAS_RESULT_RESPONSE_PATTERN.test(normalized)) return "reveal";
  return final ? "reveal" : "wait";
}

async function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(resolve, 2_500);
    const handleChange = () => {
      if (peer.iceGatheringState !== "complete") return;
      window.clearTimeout(timeout);
      peer.removeEventListener("icegatheringstatechange", handleChange);
      resolve();
    };
    peer.addEventListener("icegatheringstatechange", handleChange);
  });
}

function responseMessage(value: unknown, fallback: string): string {
  if (
    value &&
    typeof value === "object" &&
    "message" in value &&
    typeof value.message === "string"
  ) {
    return value.message;
  }
  return fallback;
}

export function parseTutorFactReceipt(message: string): TutorFactReceipt | null {
  let value: unknown;
  try {
    value = JSON.parse(message);
  } catch {
    return null;
  }
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.factType !== "teaching-assertion-evidence") return null;
  const target = record.target as Record<string, unknown> | undefined;
  const beforeAfter = record.beforeAfter as Record<string, unknown> | undefined;
  const firstRule = Array.isArray(record.relevantRules)
    ? (record.relevantRules[0] as Record<string, unknown> | undefined)
    : undefined;
  const source = firstRule?.source as Record<string, unknown> | undefined;
  const firstDeclaration = Array.isArray(firstRule?.declarations)
    ? (firstRule?.declarations[0] as Record<string, unknown> | undefined)
    : undefined;
  const stringOrNull = (candidate: unknown) =>
    typeof candidate === "string" ? candidate : null;
  const sourcePath = stringOrNull(source?.filePath);
  const line = typeof source?.line === "number" ? source.line : null;
  return {
    allowed: record.assertionAllowed === true,
    target: stringOrNull(target?.domPath) ?? "当前选中的页面内容",
    property: stringOrNull(beforeAfter?.property),
    beforeValue: stringOrNull(beforeAfter?.beforeValue),
    afterValue: stringOrNull(beforeAfter?.afterValue),
    selector: stringOrNull(firstRule?.selector),
    source: sourcePath ? `${sourcePath}${line === null ? "" : ` 第 ${line} 行`}` : null,
    ruleValue: stringOrNull(firstDeclaration?.value),
    uncertainty: stringOrNull(record.uncertainty),
  };
}

function auditReference(value: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.slice(0, 2_048) : null;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("学习会话启动已取消。", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function realtimeSessionLanguage(): "zh" | "en" {
  if (typeof window === "undefined") return "zh";
  const query = new URLSearchParams(window.location.search);
  return query.get("lang") === "en" && query.get("demo") === "css-vars"
    ? "en"
    : "zh";
}

export function useRealtimeTutor({
  topic,
  saveLearningRecord,
  voicePreferences,
  learningSessionId = null,
  onToolCall,
  onLearningAudit,
}: UseRealtimeTutorOptions) {
  const [status, setStatus] = useState<RealtimeTutorStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [pushToTalkActive, setPushToTalkActiveState] = useState(false);
  const [activeMode, setActiveMode] = useState<RealtimeTutorMode | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [logSessionId, setLogSessionId] = useState<string | null>(null);
  const [learningRecordEnabled, setLearningRecordEnabled] = useState(false);
  const [recordAvailable, setRecordAvailable] = useState(false);
  const [transcripts, setTranscripts] = useState<readonly TutorTranscriptEntry[]>([]);
  const [latestFactReceipt, setLatestFactReceipt] =
    useState<TutorFactReceipt | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const webRtcStreamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const acknowledgementAudioRef = useRef<HTMLAudioElement | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const eventsRef = useRef<EventSource | null>(null);
  const lastEventIdRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const boundLearningSessionIdRef = useRef<string | null>(null);
  const sessionEstablishedRef = useRef(false);
  const startAbortRef = useRef<AbortController | null>(null);
  const diagnosticQueueRef = useRef<QueuedDiagnostic[]>([]);
  const diagnosticTimerRef = useRef<number | null>(null);
  const diagnosticFlushTailRef = useRef<Promise<void>>(Promise.resolve());
  const flushDiagnosticsRef = useRef<(keepalive?: boolean) => Promise<void>>(
    () => Promise.resolve(),
  );
  const statsTimerRef = useRef<number | null>(null);
  const remoteAudioTimerRef = useRef<number | null>(null);
  const microphoneTimerRef = useRef<number | null>(null);
  const microphoneVadTimerRef = useRef<number | null>(null);
  const voiceIntentGateTimerRef = useRef<number | null>(null);
  const microphoneContextRef = useRef<AudioContext | null>(null);
  const remoteAudioContextRef = useRef<AudioContext | null>(null);
  const resumeOutputOnNextTurnRef = useRef(false);
  const canvasPreambleSuppressionRef = useRef(false);
  const canvasToolResultObservedRef = useRef(false);
  const canvasTranscriptBufferRef = useRef("");
  const canvasGroundingRequirementRef =
    useRef<CanvasGroundingRequirement | null>(null);
  const latestFactReceiptRef = useRef<TutorFactReceipt | null>(null);
  const voiceIntentGateRef = useRef(new VoiceIntentOutputGate());
  const realtimeTurnActiveRef = useRef(false);
  const turnIdleWaitersRef = useRef(new Set<() => void>());
  const onToolCallRef = useRef(onToolCall);
  const onLearningAuditRef = useRef(onLearningAudit);
  const activeModeRef = useRef<RealtimeTutorMode | null>(null);
  const saveLearningRecordRef = useRef(saveLearningRecord);
  const lastRecordedTutorStatusRef = useRef<string | null>(null);
  const performanceTurnRef = useRef<PerformanceTurn | null>(null);
  const activeTutorCueRef = useRef<RealtimeTutorCue | null>(null);
  const sessionStartsRef = useRef(0);
  const startupKindRef = useRef<"cold" | "warm">("cold");
  const mutedRef = useRef(false);
  const pushToTalkActiveRef = useRef(false);
  const voicePreferencesRef = useRef(voicePreferences);

  const setMicrophoneTracksEnabled = useCallback((enabled: boolean) => {
    const tracks = new Set<MediaStreamTrack>();
    for (const track of streamRef.current?.getAudioTracks() ?? []) {
      tracks.add(track);
    }
    for (const track of webRtcStreamRef.current?.getAudioTracks() ?? []) {
      tracks.add(track);
    }
    for (const track of tracks) track.enabled = enabled;
  }, []);

  useEffect(() => {
    onToolCallRef.current = onToolCall;
  }, [onToolCall]);

  useEffect(() => {
    onLearningAuditRef.current = onLearningAudit;
  }, [onLearningAudit]);

  useEffect(() => {
    saveLearningRecordRef.current = saveLearningRecord;
  }, [saveLearningRecord]);

  useEffect(() => {
    voicePreferencesRef.current = voicePreferences;
    if (voicePreferences.inputMode === "continuous") {
      pushToTalkActiveRef.current = false;
    }
    setMicrophoneTracksEnabled(
      shouldEnableMicrophoneTrack(
        voicePreferences,
        mutedRef.current,
        pushToTalkActiveRef.current,
      ),
    );
    const outputVolume = voicePreferences.outputMuted
      ? 0
      : voicePreferences.outputVolume;
    if (audioRef.current) {
      audioRef.current.volume = outputVolume;
      audioRef.current.playbackRate = voicePreferences.playbackRate;
    }
  }, [setMicrophoneTracksEnabled, voicePreferences]);

  const flushDiagnostics = useCallback((keepalive = false): Promise<void> => {
    if (diagnosticTimerRef.current !== null) {
      window.clearTimeout(diagnosticTimerRef.current);
      diagnosticTimerRef.current = null;
    }
    const sessionId = sessionEstablishedRef.current
      ? sessionIdRef.current
      : null;
    if (!sessionId) return Promise.resolve();

    const run = diagnosticFlushTailRef.current
      .catch(() => undefined)
      .then(async () => {
        while (diagnosticQueueRef.current.some((item) => item.sessionId === sessionId)) {
          const batch: QueuedDiagnostic[] = [];
          const remaining: QueuedDiagnostic[] = [];
          for (const item of diagnosticQueueRef.current) {
            if (item.sessionId === sessionId && batch.length < 50) batch.push(item);
            else remaining.push(item);
          }
          diagnosticQueueRef.current = remaining;
          let retryDelayMs = DIAGNOSTIC_RETRY_MS;
          try {
            const response = await fetch(
              `/api/realtime/session/${sessionId}/diagnostics`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  events: batch.map(({ event, at, payload }) => ({
                    event,
                    at,
                    payload,
                  })),
                }),
                keepalive,
              },
            );
            if (!response.ok) {
              if (response.status === 429) {
                retryDelayMs = DIAGNOSTIC_RATE_RETRY_MS;
              }
              throw new Error(`diagnostic endpoint returned ${response.status}`);
            }
          } catch (diagnosticError) {
            const retryable = batch
              .filter((item) => item.attempts < 2)
              .map((item) => ({ ...item, attempts: item.attempts + 1 }));
            diagnosticQueueRef.current = [
              ...retryable,
              ...diagnosticQueueRef.current,
            ];
            console.error(
              "Failed to persist realtime browser diagnostics",
              diagnosticError,
            );
            if (retryable.length > 0) {
              if (keepalive) {
                await new Promise<void>((resolve) => {
                  window.setTimeout(resolve, retryDelayMs);
                });
              } else {
                if (diagnosticTimerRef.current !== null) {
                  window.clearTimeout(diagnosticTimerRef.current);
                }
                diagnosticTimerRef.current = window.setTimeout(() => {
                  diagnosticTimerRef.current = null;
                  void flushDiagnosticsRef.current();
                }, retryDelayMs);
                return;
              }
            }
          }
        }
      });
    diagnosticFlushTailRef.current = run;
    return run;
  }, []);

  useEffect(() => {
    flushDiagnosticsRef.current = flushDiagnostics;
  }, [flushDiagnostics]);

  const recordDiagnostic = useCallback(
    (
      event: string,
      payload: Readonly<Record<string, unknown>> = {},
      sessionId = sessionIdRef.current,
    ) => {
      if (!sessionId) return;
      diagnosticQueueRef.current.push({
        sessionId,
        event,
        at: new Date().toISOString(),
        payload,
        attempts: 0,
      });
      // Keep startup diagnostics in memory until the owner-bound session exists.
      // This avoids pre-consent/pre-session 401 retries and preserves the early
      // microphone calibration sample for the first authorized flush.
      if (!sessionEstablishedRef.current) return;
      // Keep disconnect diagnostics queued locally. Retrying immediately while
      // the browser is offline only exhausts the bounded retry budget before
      // the connection can return.
      if (!navigator.onLine) return;
      if (diagnosticTimerRef.current === null) {
        diagnosticTimerRef.current = window.setTimeout(
          () => void flushDiagnostics(),
          DIAGNOSTIC_FLUSH_MS,
        );
      }
    },
    [flushDiagnostics],
  );

  const beginPerformanceTurn = useCallback(
    (
      mode: RealtimeTutorMode,
      t0AtMs: number,
      t0Source: string,
      sessionId: string,
    ) => {
      const turn: PerformanceTurn = {
        id: crypto.randomUUID(),
        mode,
        t0AtMs,
        t0Source,
        startupKind: startupKindRef.current,
        captionText: "",
        modelOutputObserved: false,
        recorded: new Set(),
      };
      performanceTurnRef.current = turn;
      recordDiagnostic(
        "performance.turn_t0",
        {
          turnId: turn.id,
          mode,
          t0At: new Date(t0AtMs).toISOString(),
          t0Source,
          startupKind: turn.startupKind,
          policyVersion: REALTIME_PERFORMANCE_POLICY.version,
        },
        sessionId,
      );
    },
    [recordDiagnostic],
  );

  const markPerformanceMilestone = useCallback(
    (
      milestone: PerformanceMilestone,
      payload: Readonly<Record<string, unknown>>,
      sessionId: string,
    ) => {
      const turn = performanceTurnRef.current;
      if (!turn || turn.recorded.has(milestone)) return;
      turn.recorded.add(milestone);
      recordDiagnostic(
        `performance.${milestone}`,
        {
          turnId: turn.id,
          mode: turn.mode,
          t0Source: turn.t0Source,
          startupKind: turn.startupKind,
          latencyMs: Math.max(0, Date.now() - turn.t0AtMs),
          policyVersion: REALTIME_PERFORMANCE_POLICY.version,
          ...payload,
        },
        sessionId,
      );
    },
    [recordDiagnostic],
  );

  const suppressCanvasPreamble = useCallback(
    (text: string, trigger: "text" | "voice", sessionId: string) => {
      const requirement = canvasGroundingRequirement(text);
      if (!requirement || canvasPreambleSuppressionRef.current) return;
      canvasPreambleSuppressionRef.current = true;
      canvasGroundingRequirementRef.current = requirement;
      canvasToolResultObservedRef.current = false;
      canvasTranscriptBufferRef.current = "";
      resumeOutputOnNextTurnRef.current = false;
      if (requirement === "causal-assertion") {
        latestFactReceiptRef.current = null;
        setLatestFactReceipt(null);
      }
      if (audioRef.current) audioRef.current.muted = true;
      recordDiagnostic(
        "client.canvas_preamble_suppressed",
        { trigger, requirement },
        sessionId,
      );
      if (trigger === "text") return;
      const acknowledgement =
        acknowledgementAudioRef.current ?? new Audio("/audio/realtime-ack.wav");
      acknowledgement.preload = "auto";
      acknowledgement.volume = voicePreferencesRef.current.outputMuted
        ? 0
        : voicePreferencesRef.current.outputVolume;
      acknowledgementAudioRef.current = acknowledgement;
      acknowledgement.pause();
      acknowledgement.currentTime = 0;
      const acknowledgementRequestedAt = performance.now();
      let acknowledgementStarted = false;
      const recordAcknowledgementStarted = (source: string) => {
        if (acknowledgementStarted) return;
        acknowledgementStarted = true;
        recordDiagnostic(
          "client.canvas_ack_playing",
          {
            trigger,
            source,
            latencyMs: Number(
              (performance.now() - acknowledgementRequestedAt).toFixed(2),
            ),
          },
          sessionId,
        );
        markPerformanceMilestone(
          "confirmation_audio",
          { trigger, source },
          sessionId,
        );
      };
      acknowledgement.addEventListener(
        "playing",
        () => recordAcknowledgementStarted("playing-event"),
        { once: true },
      );
      void acknowledgement
        .play()
        .then(() => recordAcknowledgementStarted("play-promise-resolved"))
        .catch((acknowledgementError) =>
          recordDiagnostic(
            "client.canvas_ack_play_failed",
            {
              trigger,
              message:
                acknowledgementError instanceof Error
                  ? acknowledgementError.message
                  : String(acknowledgementError),
            },
            sessionId,
          ),
        );
    },
    [markPerformanceMilestone, recordDiagnostic],
  );

  const resolveVoiceIntentTranscript = useCallback(
    (text: string, sessionId: string) => {
      markPerformanceMilestone(
        "input_transcript_final",
        { final: true },
        sessionId,
      );
      const canvasGrounded = requiresCanvasGrounding(text);
      suppressCanvasPreamble(text, "voice", sessionId);
      if (voiceIntentGateTimerRef.current !== null) {
        window.clearTimeout(voiceIntentGateTimerRef.current);
        voiceIntentGateTimerRef.current = null;
      }
      const resolution = voiceIntentGateRef.current.resolve();
      if (!resolution.armed) return;
      if (
        !canvasGrounded &&
        !canvasPreambleSuppressionRef.current &&
        audioRef.current
      ) {
        audioRef.current.muted = false;
      }
      recordDiagnostic(
        "client.voice_intent_gate_resolved",
        {
          turnId: performanceTurnRef.current?.id ?? null,
          canvasGrounded,
          suppressedCharacterCount: resolution.suppressedText.length,
        },
        sessionId,
      );
    },
    [markPerformanceMilestone, recordDiagnostic, suppressCanvasPreamble],
  );

  const armVoiceIntentGate = useCallback(
    (sessionId: string) => {
      if (!voiceIntentGateRef.current.arm()) return;
      if (audioRef.current) audioRef.current.muted = true;
      if (voiceIntentGateTimerRef.current !== null) {
        window.clearTimeout(voiceIntentGateTimerRef.current);
      }
      voiceIntentGateTimerRef.current = window.setTimeout(() => {
        voiceIntentGateTimerRef.current = null;
        const resolution = voiceIntentGateRef.current.resolve();
        if (!resolution.armed) return;
        if (!canvasPreambleSuppressionRef.current && audioRef.current) {
          audioRef.current.muted = false;
        }
        recordDiagnostic(
          "client.voice_intent_gate_timed_out",
          {
            turnId: performanceTurnRef.current?.id ?? null,
            timeoutMs: VOICE_INTENT_GATE_TIMEOUT_MS,
            suppressedCharacterCount: resolution.suppressedText.length,
          },
          sessionId,
        );
      }, VOICE_INTENT_GATE_TIMEOUT_MS);
      recordDiagnostic(
        "client.voice_intent_gate_armed",
        {
          turnId: performanceTurnRef.current?.id ?? null,
          timeoutMs: VOICE_INTENT_GATE_TIMEOUT_MS,
        },
        sessionId,
      );
    },
    [recordDiagnostic],
  );

  const releaseLocalResources = useCallback(() => {
    if (statsTimerRef.current !== null) window.clearInterval(statsTimerRef.current);
    statsTimerRef.current = null;
    if (remoteAudioTimerRef.current !== null) {
      window.clearInterval(remoteAudioTimerRef.current);
    }
    remoteAudioTimerRef.current = null;
    if (microphoneTimerRef.current !== null) {
      window.clearInterval(microphoneTimerRef.current);
    }
    microphoneTimerRef.current = null;
    if (microphoneVadTimerRef.current !== null) {
      window.clearInterval(microphoneVadTimerRef.current);
    }
    microphoneVadTimerRef.current = null;
    if (voiceIntentGateTimerRef.current !== null) {
      window.clearTimeout(voiceIntentGateTimerRef.current);
    }
    voiceIntentGateTimerRef.current = null;
    voiceIntentGateRef.current.reset();
    webRtcStreamRef.current?.getTracks().forEach((track) => track.stop());
    webRtcStreamRef.current = null;
    resumeOutputOnNextTurnRef.current = false;
    canvasPreambleSuppressionRef.current = false;
    canvasToolResultObservedRef.current = false;
    canvasTranscriptBufferRef.current = "";
    canvasGroundingRequirementRef.current = null;
    latestFactReceiptRef.current = null;
    realtimeTurnActiveRef.current = false;
    performanceTurnRef.current = null;
    activeTutorCueRef.current = null;
    for (const resolve of turnIdleWaitersRef.current) {
      resolve();
    }
    turnIdleWaitersRef.current.clear();
    void microphoneContextRef.current?.close().catch(() => undefined);
    microphoneContextRef.current = null;
    void remoteAudioContextRef.current?.close().catch(() => undefined);
    remoteAudioContextRef.current = null;
    eventsRef.current?.close();
    eventsRef.current = null;
    lastEventIdRef.current = 0;
    dataChannelRef.current?.close();
    dataChannelRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.srcObject = null;
    }
    audioRef.current = null;
    acknowledgementAudioRef.current?.pause();
    acknowledgementAudioRef.current = null;
  }, []);

  const startMicrophoneDiagnostics = useCallback(
    (stream: MediaStream, sessionId: string) => {
      const tracks = stream.getAudioTracks();
      for (const track of tracks) {
        const settings = track.getSettings();
        recordDiagnostic(
          "microphone.track_ready",
          {
            label: track.label,
            enabled: track.enabled,
            muted: track.muted,
            readyState: track.readyState,
            settings: {
              autoGainControl: settings.autoGainControl,
              channelCount: settings.channelCount,
              echoCancellation: settings.echoCancellation,
              noiseSuppression: settings.noiseSuppression,
              sampleRate: settings.sampleRate,
              sampleSize: settings.sampleSize,
            },
          },
          sessionId,
        );
        track.addEventListener("mute", () =>
          recordDiagnostic("microphone.track_muted", { label: track.label }, sessionId),
        );
        track.addEventListener("unmute", () =>
          recordDiagnostic("microphone.track_unmuted", { label: track.label }, sessionId),
        );
        track.addEventListener("ended", () =>
          recordDiagnostic("microphone.track_ended", { label: track.label }, sessionId),
        );
      }
      try {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        const destination = audioContext.createMediaStreamDestination();
        destination.channelCount = 1;
        destination.channelCountMode = "explicit";
        microphoneContextRef.current = audioContext;
        analyser.fftSize = 2_048;
        source.connect(analyser);
        source.connect(destination);
        recordDiagnostic(
          "microphone.webrtc_pipeline_ready",
          {
            sampleRate: audioContext.sampleRate,
            channelCount: destination.channelCount,
            outputTrackCount: destination.stream.getAudioTracks().length,
          },
          sessionId,
        );
        const samples = new Float32Array(analyser.fftSize);
        const vad = new CalibratedEnergyVad();
        void audioContext.resume();
        microphoneVadTimerRef.current = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let squareSum = 0;
          for (const sample of samples) squareSum += sample * sample;
          const rms = Math.sqrt(squareSum / samples.length);
          for (const transition of vad.sample(rms, Date.now())) {
            if (transition.type === "calibrated") {
              recordDiagnostic(
                "microphone.noise_calibrated",
                {
                  sampleCount: transition.sampleCount,
                  noiseFloor: Number(transition.noiseFloor.toFixed(6)),
                  threshold: Number(transition.threshold.toFixed(6)),
                },
                sessionId,
              );
            } else if (transition.type === "speech_started") {
              recordDiagnostic(
                "microphone.speech_started",
                {
                  rms: Number(transition.rms.toFixed(6)),
                  noiseFloor: Number(transition.noiseFloor.toFixed(6)),
                  threshold: Number(transition.threshold.toFixed(6)),
                },
                sessionId,
              );
            } else {
              beginPerformanceTurn(
                "voice",
                transition.speechEndedAtMs,
                REALTIME_PERFORMANCE_POLICY.voiceT0,
                sessionId,
              );
              armVoiceIntentGate(sessionId);
              recordDiagnostic(
                "microphone.speech_stopped",
                {
                  speechEndedAt: new Date(transition.speechEndedAtMs).toISOString(),
                  detectedAfterSilenceMs:
                    transition.atMs - transition.speechEndedAtMs,
                  speechDurationMs: transition.speechDurationMs,
                  noiseFloor: Number(transition.noiseFloor.toFixed(6)),
                  threshold: Number(transition.threshold.toFixed(6)),
                },
                sessionId,
              );
            }
          }
        }, VAD_SAMPLE_INTERVAL_MS);
        microphoneTimerRef.current = window.setInterval(() => {
          analyser.getFloatTimeDomainData(samples);
          let squareSum = 0;
          let peak = 0;
          for (const sample of samples) {
            squareSum += sample * sample;
            peak = Math.max(peak, Math.abs(sample));
          }
          recordDiagnostic(
            "microphone.level",
            {
              rms: Number(Math.sqrt(squareSum / samples.length).toFixed(6)),
              peak: Number(peak.toFixed(6)),
              audioContextState: audioContext.state,
            },
            sessionId,
          );
        }, MICROPHONE_LEVEL_INTERVAL_MS);
        return destination.stream;
      } catch (audioError) {
        recordDiagnostic(
          "microphone.level_unavailable",
          { message: audioError instanceof Error ? audioError.message : String(audioError) },
          sessionId,
        );
        return null;
      }
    },
    [armVoiceIntentGate, beginPerformanceTurn, recordDiagnostic],
  );

  const startPeerDiagnostics = useCallback(
    (peer: RTCPeerConnection, sessionId: string) => {
      const logState = (event: string) =>
        recordDiagnostic(
          event,
          {
            connectionState: peer.connectionState,
            iceConnectionState: peer.iceConnectionState,
            iceGatheringState: peer.iceGatheringState,
            signalingState: peer.signalingState,
          },
          sessionId,
        );
      peer.addEventListener("connectionstatechange", () =>
        logState("webrtc.connection_state"),
      );
      peer.addEventListener("iceconnectionstatechange", () =>
        logState("webrtc.ice_connection_state"),
      );
      peer.addEventListener("icegatheringstatechange", () =>
        logState("webrtc.ice_gathering_state"),
      );
      peer.addEventListener("signalingstatechange", () =>
        logState("webrtc.signaling_state"),
      );
      logState("webrtc.peer_created");
      statsTimerRef.current = window.setInterval(() => {
        void peer
          .getStats()
          .then((report) => {
            const audioStats: Record<string, unknown>[] = [];
            report.forEach((rawStat) => {
              const stat = rawStat as RTCStats & Record<string, unknown>;
              const kind = stat.kind ?? stat.mediaType;
              if (
                !(
                  (stat.type === "outbound-rtp" && kind === "audio") ||
                  (stat.type === "media-source" && kind === "audio")
                )
              ) {
                return;
              }
              const selected: Record<string, unknown> = {
                id: stat.id,
                type: stat.type,
                timestamp: stat.timestamp,
              };
              for (const key of [
                "audioLevel",
                "bytesSent",
                "codecId",
                "packetsSent",
                "remoteId",
                "totalAudioEnergy",
                "totalSamplesDuration",
                "trackIdentifier",
                "transportId",
              ]) {
                if (stat[key] !== undefined) selected[key] = stat[key];
              }
              audioStats.push(selected);
            });
            recordDiagnostic("webrtc.outbound_audio_stats", { reports: audioStats }, sessionId);
          })
          .catch((statsError) =>
            recordDiagnostic(
              "webrtc.stats_failed",
              { message: statsError instanceof Error ? statsError.message : String(statsError) },
              sessionId,
            ),
          );
      }, WEBRTC_STATS_INTERVAL_MS);
    },
    [recordDiagnostic],
  );

  const emitLearningAudit = useCallback(
    (event: LearningAuditEventInput) => {
      const learningId = boundLearningSessionIdRef.current;
      if (!learningId || !onLearningAuditRef.current) return;
      try {
        onLearningAuditRef.current(learningId, event);
      } catch (auditError) {
        recordDiagnostic(
          "learning.timeline_event_rejected",
          {
            type: event.type,
            message:
              auditError instanceof Error ? auditError.message : String(auditError),
          },
          sessionIdRef.current ?? undefined,
        );
      }
    },
    [recordDiagnostic],
  );

  const recordTutorStatus = useCallback(
    (
      nextStatus: Exclude<RealtimeTutorStatus, "idle">,
      detail: string | null = null,
      realtimeSessionId = sessionIdRef.current,
    ) => {
      const mode = activeModeRef.current;
      if (!mode || !realtimeSessionId) return;
      const statusKey = `${realtimeSessionId}:${nextStatus}`;
      if (lastRecordedTutorStatusRef.current === statusKey) return;
      lastRecordedTutorStatusRef.current = statusKey;
      const normalizedDetail = detail?.trim().slice(0, 500) || null;
      emitLearningAudit({
        type: "audit-tutor-session",
        actorType: "system",
        at: new Date().toISOString(),
        mode,
        realtimeSessionId,
        status: nextStatus,
        detail: normalizedDetail,
      });
    },
    [emitLearningAudit],
  );

  const stop = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    const sessionEstablished = sessionEstablishedRef.current;
    startAbortRef.current?.abort();
    startAbortRef.current = null;
    if (sessionId && sessionEstablished) {
      recordDiagnostic("client.stop_requested", {}, sessionId);
    } else if (sessionId) {
      diagnosticQueueRef.current = diagnosticQueueRef.current.filter(
        (item) => item.sessionId !== sessionId,
      );
    }
    releaseLocalResources();
    if (sessionId && sessionEstablished) {
      recordDiagnostic("client.local_resources_released", {}, sessionId);
      await flushDiagnostics(true);
    }
    mutedRef.current = false;
    pushToTalkActiveRef.current = false;
    setMuted(false);
    setPushToTalkActiveState(false);
    setStatus("stopped");
    if (sessionId) recordTutorStatus("stopped", null, sessionId);
    sessionEstablishedRef.current = false;
    if (sessionId && sessionEstablished) {
      await fetch(`/api/realtime/session/${sessionId}`, {
        method: "DELETE",
      }).catch(() => null);
      diagnosticQueueRef.current = diagnosticQueueRef.current.filter(
        (item) => item.sessionId !== sessionId,
      );
    }
    sessionIdRef.current = null;
  }, [flushDiagnostics, recordDiagnostic, recordTutorStatus, releaseLocalResources]);

  useEffect(() => {
    return () => {
      const sessionId = sessionIdRef.current;
      const sessionEstablished = sessionEstablishedRef.current;
      startAbortRef.current?.abort();
      startAbortRef.current = null;
      if (sessionId && sessionEstablished) {
        recordDiagnostic("client.unmounted", {}, sessionId);
      }
      releaseLocalResources();
      const finalDiagnosticFlush =
        sessionId && sessionEstablished ? flushDiagnostics(true) : null;
      sessionEstablishedRef.current = false;
      sessionIdRef.current = null;
      if (sessionId && finalDiagnosticFlush) {
        void finalDiagnosticFlush.finally(() => {
          diagnosticQueueRef.current = diagnosticQueueRef.current.filter(
            (item) => item.sessionId !== sessionId,
          );
          void fetch(`/api/realtime/session/${sessionId}`, {
            method: "DELETE",
            keepalive: true,
          });
        });
      }
    };
  }, [flushDiagnostics, recordDiagnostic, releaseLocalResources]);

  const addTranscript = useCallback(
    (role: string, text: string, final: boolean) => {
      if (!text) return;
      const normalizedRole =
        role === "user" || role === "assistant" || role === "system"
          ? role
          : null;
      const mode = activeModeRef.current;
      const realtimeSessionId = sessionIdRef.current;
      if (final && normalizedRole && mode && realtimeSessionId) {
        const contentStored = saveLearningRecordRef.current;
        emitLearningAudit({
          type: "audit-tutor-message",
          actorType:
            normalizedRole === "user"
              ? "user"
              : normalizedRole === "assistant"
                ? "ai"
                : "system",
          at: new Date().toISOString(),
          mode,
          realtimeSessionId,
          role: normalizedRole,
          contentStored,
          text: contentStored ? text.slice(0, 2_000) : null,
          characterCount: Math.min(20_000, Math.max(1, Array.from(text).length)),
        });
      }
      setTranscripts((current) => {
        const entries = [...current];
        const last = entries.at(-1);
        if (last && last.role === role && !last.final) {
          entries[entries.length - 1] = {
            ...last,
            text: final ? text : `${last.text}${text}`,
            final,
          };
        } else {
          entries.push({
            id: crypto.randomUUID(),
            role,
            text,
            final,
          });
        }
        return entries.slice(-14);
      });
    },
    [emitLearningAudit],
  );

  const openEventStream = useCallback(
    (sessionId: string) => {
      eventsRef.current?.close();
      const cursor = lastEventIdRef.current;
      const source = new EventSource(
        `/api/realtime/session/${sessionId}/events${
          cursor > 0 ? `?cursor=${cursor}` : ""
        }`,
      );
      eventsRef.current = source;
      source.onopen = () => {
        recordDiagnostic("sse.open", { readyState: source.readyState }, sessionId);
        setStatus((current) => (current === "reconnecting" ? "connected" : current));
      };
      source.onmessage = (message) => {
        const eventId = Number(message.lastEventId);
        if (Number.isSafeInteger(eventId) && eventId > 0) {
          if (eventId <= lastEventIdRef.current) {
            recordDiagnostic(
              "sse.duplicate_ignored",
              { eventId, lastEventId: lastEventIdRef.current },
              sessionId,
            );
            return;
          }
          lastEventIdRef.current = eventId;
        }
        let raw: unknown;
        try {
          raw = JSON.parse(message.data);
        } catch {
          recordDiagnostic(
            "sse.parse_failed",
            { messageLength: message.data.length },
            sessionId,
          );
          return;
        }
        const parsed = realtimePublicEventSchema.safeParse(raw);
        if (!parsed.success) {
          recordDiagnostic(
            "sse.validation_failed",
            { issues: parsed.error.issues },
            sessionId,
          );
          return;
        }
        const event = parsed.data;
        recordDiagnostic(
          "sse.event_received",
          { type: event.type, at: event.at, eventId: eventId || null },
          sessionId,
        );
        if (event.type === "status") {
          setStatus(event.state);
          recordTutorStatus(event.state, null, sessionId);
          return;
        }
        if (event.type === "transcript") {
          if (event.role === "user" && event.final) {
            resolveVoiceIntentTranscript(event.text, sessionId);
          }
          if (
            event.role === "assistant" &&
            voiceIntentGateRef.current.captureAssistantTranscript(
              event.text,
              event.final,
            )
          ) {
            if (event.final) {
              recordDiagnostic(
                "client.voice_intent_output_held",
                {
                  suppressedCharacterCount:
                    voiceIntentGateRef.current.suppressedCharacterCount,
                },
                sessionId,
              );
            }
            return;
          }
          let transcriptText = event.text;
          if (
            event.role === "assistant" &&
            canvasPreambleSuppressionRef.current
          ) {
            const bufferedText = event.final
              ? event.text
              : `${canvasTranscriptBufferRef.current}${event.text}`;
            canvasTranscriptBufferRef.current = bufferedText;
            const causalRequirement =
              canvasGroundingRequirementRef.current === "causal-assertion";
            const causalReceipt = latestFactReceiptRef.current;
            if (causalRequirement && causalReceipt?.allowed !== true) {
              if (!event.final) return;
              transcriptText =
                causalReceipt?.uncertainty ??
                "我还没有拿到能对应当前页面和版本的完整证据，所以先不判断原因。请先保存变化并重新核对页面。";
              canvasTranscriptBufferRef.current = "";
              canvasPreambleSuppressionRef.current = false;
              canvasToolResultObservedRef.current = false;
              canvasGroundingRequirementRef.current = null;
              resumeOutputOnNextTurnRef.current = true;
              recordDiagnostic(
                "client.causal_assertion_blocked",
                {
                  final: true,
                  receipt: causalReceipt
                    ? causalReceipt.allowed
                      ? "allowed"
                      : "insufficient"
                    : "missing",
                },
                sessionId,
              );
            } else {
            const decision = classifyCanvasAssistantSegment(
              bufferedText,
              canvasToolResultObservedRef.current,
              event.final,
            );
            if (decision !== "reveal") {
              if (event.final) {
                recordDiagnostic(
                  "client.canvas_preamble_transcript_suppressed",
                  { final: true, reason: decision },
                  sessionId,
                );
                canvasTranscriptBufferRef.current = "";
              }
              return;
            }
            transcriptText = bufferedText;
            canvasTranscriptBufferRef.current = "";
            canvasPreambleSuppressionRef.current = false;
            canvasToolResultObservedRef.current = false;
            canvasGroundingRequirementRef.current = null;
            resumeOutputOnNextTurnRef.current = false;
            if (audioRef.current) audioRef.current.muted = false;
            recordDiagnostic(
              "client.canvas_result_audio_resumed",
              { trigger: "assistant-result-transcript" },
              sessionId,
            );
            }
          }
          if (event.role === "assistant") {
            const turn = performanceTurnRef.current;
            if (turn && !turn.recorded.has("first_meaningful_caption")) {
              turn.captionText += transcriptText;
              if (turn.captionText.replace(/\s+/g, "").length >= 2) {
                markPerformanceMilestone(
                  "first_meaningful_caption",
                  { final: event.final, source: "assistant-transcript" },
                  sessionId,
                );
              }
            }
          }
          addTranscript(event.role, transcriptText, event.final);
          return;
        }
        if (event.type === "error") {
          setError(event.message);
          setStatus("error");
          recordTutorStatus("error", event.message, sessionId);
          return;
        }
        if (event.type === "closed") {
          setStatus("stopped");
          recordTutorStatus("stopped", null, sessionId);
          return;
        }
        if (event.type === "tool_call") {
          void (async () => {
            const startedAt = performance.now();
            let result: RealtimeToolResult;
            try {
              if (sessionIdRef.current !== sessionId) {
                throw new Error("学习会话已结束，画布操作未执行。");
              }
              result = await onToolCallRef.current(
                event.tool,
                event.arguments,
              );
              if (
                result.success &&
                event.tool === "read_teaching_assertion_evidence"
              ) {
                const receipt = parseTutorFactReceipt(result.message);
                latestFactReceiptRef.current = receipt;
                setLatestFactReceipt(receipt);
                const mode = activeModeRef.current;
                if (receipt && mode) {
                  emitLearningAudit({
                    type: "audit-fact-receipt",
                    actorType: "system",
                    at: new Date().toISOString(),
                    mode,
                    realtimeSessionId: sessionId,
                    requestId: event.requestId,
                    allowed: receipt.allowed,
                    target: auditReference(receipt.target),
                    property: auditReference(receipt.property),
                    beforeValue: auditReference(receipt.beforeValue),
                    afterValue: auditReference(receipt.afterValue),
                    selector: auditReference(receipt.selector),
                    source: auditReference(receipt.source),
                    ruleValue: auditReference(receipt.ruleValue),
                    uncertainty: receipt.uncertainty?.trim().slice(0, 500) || null,
                  });
                }
              }
              if (
                result.success &&
                MUTATING_TUTOR_TOOLS.has(event.tool) &&
                sessionIdRef.current === sessionId
              ) {
                await new Promise<void>((resolve) =>
                  window.requestAnimationFrame(() => resolve()),
                );
                markPerformanceMilestone(
                  "canvas_visible_t1",
                  { tool: event.tool, requestId: event.requestId },
                  sessionId,
                );
                const performanceTurn = performanceTurnRef.current;
                if (
                  performanceTurn &&
                  !performanceTurn.recorded.has("first_meaningful_caption")
                ) {
                  addTranscript("assistant", CANVAS_VISIBLE_CONFIRMATION, true);
                  await new Promise<void>((resolve) =>
                    window.requestAnimationFrame(() => resolve()),
                  );
                  markPerformanceMilestone(
                    "first_meaningful_caption",
                    {
                      final: true,
                      source: "canvas-visible-confirmation",
                      tool: event.tool,
                    },
                    sessionId,
                  );
                  recordDiagnostic(
                    "client.canvas_visible_confirmation_shown",
                    {
                      turnId: performanceTurn.id,
                      tool: event.tool,
                      requestId: event.requestId,
                    },
                    sessionId,
                  );
                }
              }
            } catch (toolError) {
              result = {
                success: false,
                message:
                  toolError instanceof Error
                    ? toolError.message
                    : "教学工具执行失败。",
              };
            }
            const mode = activeModeRef.current;
            if (mode) {
              const mutatesCanvas = MUTATING_TUTOR_TOOLS.has(event.tool);
              emitLearningAudit({
                type: "audit-tutor-tool",
                actorType: "ai",
                at: new Date().toISOString(),
                mode,
                realtimeSessionId: sessionId,
                requestId: event.requestId,
                tool: event.tool,
                success: result.success,
                mutatesCanvas,
              });
              if (mutatesCanvas) {
                emitLearningAudit({
                  type: "audit-canvas-action",
                  actorType: "ai",
                  at: new Date().toISOString(),
                  source: "tutor",
                  action: result.success
                    ? "学习搭档完成页面操作"
                    : "学习搭档的页面操作未完成",
                  blockId: null,
                  revisionId: null,
                  detail: null,
                });
              }
            }
            try {
              const response = await fetch(
                `/api/realtime/session/${sessionId}/tools/${event.requestId}`,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(result),
                },
              );
              recordDiagnostic(
                response.ok ? "tool.result_submitted" : "tool.result_submit_failed",
                {
                  requestId: event.requestId,
                  tool: event.tool,
                  success: result.success,
                  httpStatus: response.status,
                  durationMs: Number((performance.now() - startedAt).toFixed(2)),
                },
                sessionId,
              );
              if (
                response.ok &&
                result.success &&
                canvasPreambleSuppressionRef.current &&
                (canvasGroundingRequirementRef.current !== "causal-assertion" ||
                  (event.tool === "read_teaching_assertion_evidence" &&
                    latestFactReceiptRef.current !== null))
              ) {
                canvasToolResultObservedRef.current = true;
              }
            } catch (submitError) {
              recordDiagnostic(
                "tool.result_submit_failed",
                {
                  requestId: event.requestId,
                  tool: event.tool,
                  message:
                    submitError instanceof Error ? submitError.message : String(submitError),
                },
                sessionId,
              );
            }
          })();
        }
      };
      source.onerror = () => {
        recordDiagnostic(
          "sse.error",
          { readyState: source.readyState },
          sessionId,
        );
        if (sessionIdRef.current === sessionId) {
          setStatus("reconnecting");
          recordTutorStatus("reconnecting", null, sessionId);
        }
      };
    },
    [
      addTranscript,
      emitLearningAudit,
      markPerformanceMilestone,
      recordTutorStatus,
      recordDiagnostic,
      resolveVoiceIntentTranscript,
    ],
  );

  useEffect(() => {
    const handleOffline = () => {
      const sessionId = sessionIdRef.current;
      if (!sessionId || !sessionEstablishedRef.current) return;
      eventsRef.current?.close();
      eventsRef.current = null;
      setStatus("reconnecting");
      recordDiagnostic(
        "sse.browser_offline",
        { lastEventId: lastEventIdRef.current },
        sessionId,
      );
    };
    const handleOnline = () => {
      const sessionId = sessionIdRef.current;
      if (
        !sessionId ||
        !sessionEstablishedRef.current ||
        eventsRef.current
      ) {
        return;
      }
      recordDiagnostic(
        "sse.browser_online",
        { resumeAfterEventId: lastEventIdRef.current },
        sessionId,
      );
      openEventStream(sessionId);
    };
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [openEventStream, recordDiagnostic]);

  const startText = useCallback(async () => {
    if (["checking", "connecting", "requesting-microphone"].includes(status)) return;
    await stop();
    const startController = new AbortController();
    startAbortRef.current = startController;
    const attemptSessionId = crypto.randomUUID();
    const attemptLearningSessionId = learningSessionId ?? null;
    boundLearningSessionIdRef.current = attemptLearningSessionId;
    startupKindRef.current = sessionStartsRef.current === 0 ? "cold" : "warm";
    sessionIdRef.current = attemptSessionId;
    sessionEstablishedRef.current = false;
    setLogSessionId(attemptSessionId);
    setRecordAvailable(false);
    setActiveMode("text");
    activeModeRef.current = "text";
    setError(null);
    setTranscripts([]);
    latestFactReceiptRef.current = null;
    setLatestFactReceipt(null);
    setStatus("connecting");
    recordTutorStatus("connecting", null, attemptSessionId);
    recordDiagnostic(
      "client.start_requested",
      {
        mode: "text",
        topic,
        startupKind: startupKindRef.current,
        userAgent: navigator.userAgent,
      },
      attemptSessionId,
    );
    try {
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: startController.signal,
        body: JSON.stringify({
          mode: "text",
          clientSessionId: attemptSessionId,
          ...(attemptLearningSessionId
            ? { learningSessionId: attemptLearningSessionId }
            : {}),
          topic,
          language: realtimeSessionLanguage(),
          saveLearningRecord,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      throwIfAborted(startController.signal);
      if (!response.ok) {
        throw new Error(responseMessage(payload, "文字问答启动失败。"));
      }
      const session = createRealtimeSessionResponseSchema.parse(payload);
      if (session.mode !== "text") {
        throw new Error("服务端没有建立文字问答会话。");
      }
      if (session.sessionId !== attemptSessionId) {
        await flushDiagnostics();
        setLogSessionId(session.sessionId);
      }
      sessionIdRef.current = session.sessionId;
      sessionEstablishedRef.current = true;
      sessionStartsRef.current += 1;
      setModel(session.model);
      setLearningRecordEnabled(session.learningRecordEnabled);
      setRecordAvailable(true);
      openEventStream(session.sessionId);
      setStatus("connected");
      recordTutorStatus("connected", null, session.sessionId);
      recordDiagnostic(
        "client.text_session_ready",
        { model: session.model, protocolVersion: session.protocolVersion },
        session.sessionId,
      );
      await flushDiagnostics();
      if (startAbortRef.current === startController) startAbortRef.current = null;
    } catch (startError) {
      const cancelled = isAbortError(startError);
      recordDiagnostic(
        cancelled ? "client.start_cancelled" : "client.start_failed",
        {
          mode: "text",
          message: startError instanceof Error ? startError.message : String(startError),
        },
        attemptSessionId,
      );
      if (sessionEstablishedRef.current) await flushDiagnostics(true);
      releaseLocalResources();
      if (sessionEstablishedRef.current) {
        void fetch(`/api/realtime/session/${attemptSessionId}`, {
          method: "DELETE",
          keepalive: true,
        });
      } else {
        diagnosticQueueRef.current = diagnosticQueueRef.current.filter(
          (item) => item.sessionId !== attemptSessionId,
        );
      }
      sessionIdRef.current = null;
      sessionEstablishedRef.current = false;
      if (startAbortRef.current === startController) startAbortRef.current = null;
      setError(
        cancelled
          ? null
          : startError instanceof Error
            ? startError.message
            : "文字问答启动失败。",
      );
      setStatus(cancelled ? "stopped" : "error");
      recordTutorStatus(
        cancelled ? "stopped" : "error",
        cancelled
          ? null
          : startError instanceof Error
            ? startError.message
            : "文字问答启动失败。",
        attemptSessionId,
      );
    }
  }, [
    flushDiagnostics,
    openEventStream,
    recordDiagnostic,
    recordTutorStatus,
    releaseLocalResources,
    status,
    stop,
    topic,
    saveLearningRecord,
    learningSessionId,
  ]);

  const startVoice = useCallback(async () => {
    if (["checking", "connecting", "requesting-microphone"].includes(status)) return;
    if (voicePreferences.inputMode === null) {
      setError("请先选择按住说话或持续聆听。");
      setStatus("error");
      return;
    }
    await stop();
    const startController = new AbortController();
    startAbortRef.current = startController;
    const attemptSessionId = crypto.randomUUID();
    const attemptLearningSessionId = learningSessionId ?? null;
    boundLearningSessionIdRef.current = attemptLearningSessionId;
    startupKindRef.current = sessionStartsRef.current === 0 ? "cold" : "warm";
    sessionIdRef.current = attemptSessionId;
    sessionEstablishedRef.current = false;
    setLogSessionId(attemptSessionId);
    setRecordAvailable(false);
    setActiveMode("voice");
    activeModeRef.current = "voice";
    setError(null);
    setTranscripts([]);
    latestFactReceiptRef.current = null;
    setLatestFactReceipt(null);
    setStatus("checking");
    recordTutorStatus("checking", null, attemptSessionId);
    recordDiagnostic(
      "client.start_requested",
      {
        mode: "voice",
        topic,
        startupKind: startupKindRef.current,
        inputMode: voicePreferences.inputMode,
        microphoneSelected: Boolean(voicePreferences.deviceId),
        outputMuted: voicePreferences.outputMuted,
        outputVolume: voicePreferences.outputVolume,
        playbackRate: voicePreferences.playbackRate,
        captionsEnabled: voicePreferences.captionsEnabled,
        userAgent: navigator.userAgent,
      },
      attemptSessionId,
    );
    try {
      const capabilityResponse = await fetch("/api/realtime/capabilities", {
        method: "GET",
        cache: "no-store",
        signal: startController.signal,
      });
      const capabilityPayload: unknown = await capabilityResponse
        .json()
        .catch(() => null);
      throwIfAborted(startController.signal);
      if (!capabilityResponse.ok) {
        throw new Error(
          responseMessage(capabilityPayload, "暂时无法连接语音服务。"),
        );
      }
      const capability = realtimeCapabilityResponseSchema.parse(capabilityPayload);
      recordDiagnostic(
        "client.capability_check_ready",
        { checkedAt: capability.checkedAt, voiceAvailable: capability.voiceAvailable },
        attemptSessionId,
      );
      setStatus("requesting-microphone");
      recordTutorStatus("requesting-microphone", null, attemptSessionId);
      recordDiagnostic("microphone.permission_requested", {}, attemptSessionId);
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            ...(voicePreferences.deviceId
              ? { deviceId: { exact: voicePreferences.deviceId } }
              : {}),
          },
        });
      } catch (microphoneError) {
        if (
          voicePreferences.deviceId &&
          microphoneError instanceof DOMException &&
          ["NotFoundError", "OverconstrainedError"].includes(
            microphoneError.name,
          )
        ) {
          throw new Error(
            "找不到你选择的麦克风。请打开语音设置，重新选择后再试。",
          );
        }
        throw microphoneError;
      }
      if (startController.signal.aborted) {
        stream.getTracks().forEach((track) => track.stop());
        throwIfAborted(startController.signal);
      }
      const microphoneEnabled = shouldEnableMicrophoneTrack(
        voicePreferences,
        mutedRef.current,
        pushToTalkActiveRef.current,
      );
      stream
        .getAudioTracks()
        .forEach((track) => (track.enabled = microphoneEnabled));
      streamRef.current = stream;
      recordDiagnostic(
        "microphone.permission_granted",
        { audioTrackCount: stream.getAudioTracks().length },
        attemptSessionId,
      );
      const webRtcStream = startMicrophoneDiagnostics(stream, attemptSessionId) ?? stream;
      webRtcStreamRef.current = webRtcStream;
      webRtcStream
        .getAudioTracks()
        .forEach((track) => (track.enabled = microphoneEnabled));
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      startPeerDiagnostics(peer, attemptSessionId);
      const audio = new Audio();
      audio.autoplay = true;
      audio.volume = voicePreferences.outputMuted
        ? 0
        : voicePreferences.outputVolume;
      audio.playbackRate = voicePreferences.playbackRate;
      audioRef.current = audio;
      audio.addEventListener("playing", () =>
        markPerformanceMilestone(
          "first_model_audio",
          { source: "remote-audio-playing" },
          attemptSessionId,
        ),
      );
      peer.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remoteStream;
        event.track.addEventListener("unmute", () => {
          recordDiagnostic(
            "webrtc.remote_track_unmuted",
            { kind: event.track.kind, label: event.track.label },
            attemptSessionId,
          );
        });
        if (event.track.kind === "audio" && !remoteAudioContextRef.current) {
          try {
            const remoteAudioContext = new AudioContext();
            const remoteSource = remoteAudioContext.createMediaStreamSource(remoteStream);
            const remoteAnalyser = remoteAudioContext.createAnalyser();
            remoteAnalyser.fftSize = 256;
            remoteSource.connect(remoteAnalyser);
            remoteAudioContextRef.current = remoteAudioContext;
            const remoteSamples = new Float32Array(remoteAnalyser.fftSize);
            void remoteAudioContext.resume();
            remoteAudioTimerRef.current = window.setInterval(() => {
              const performanceTurn = performanceTurnRef.current;
              const activeTutorCue = activeTutorCueRef.current;
              if (!performanceTurn?.modelOutputObserved && !activeTutorCue) return;
              remoteAnalyser.getFloatTimeDomainData(remoteSamples);
              const rms = remoteAudioRms(remoteSamples);
              if (rms < REMOTE_AUDIO_RMS_THRESHOLD) return;
              const roundedRms = Number(rms.toFixed(6));
              if (activeTutorCue) {
                activeTutorCueRef.current = null;
                recordDiagnostic(
                  "lesson.cue_audio_started",
                  {
                    cue: activeTutorCue,
                    source: "remote-audio-energy",
                    rms: roundedRms,
                  },
                  attemptSessionId,
                );
              }
              if (performanceTurn?.modelOutputObserved) {
                markPerformanceMilestone(
                  "first_model_audio",
                  { source: "remote-audio-energy", rms: roundedRms },
                  attemptSessionId,
                );
              }
            }, REMOTE_AUDIO_SAMPLE_INTERVAL_MS);
          } catch (remoteAudioError) {
            recordDiagnostic(
              "webrtc.remote_audio_meter_unavailable",
              {
                message:
                  remoteAudioError instanceof Error
                    ? remoteAudioError.message
                    : String(remoteAudioError),
              },
              attemptSessionId,
            );
          }
        }
        recordDiagnostic(
          "webrtc.remote_track",
          {
            kind: event.track.kind,
            label: event.track.label,
            muted: event.track.muted,
            readyState: event.track.readyState,
            streamCount: event.streams.length,
          },
          attemptSessionId,
        );
        void audio.play().catch((playError) =>
          recordDiagnostic(
            "webrtc.remote_audio_play_failed",
            { message: playError instanceof Error ? playError.message : String(playError) },
            attemptSessionId,
          ),
        );
      };
      webRtcStream.getAudioTracks().forEach((track) => {
        peer.addTrack(track, webRtcStream);
        recordDiagnostic(
          "webrtc.local_track_added",
          { kind: track.kind, label: track.label, enabled: track.enabled, processed: true },
          attemptSessionId,
        );
      });
      const dataChannel = peer.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onopen = () =>
        recordDiagnostic(
          "webrtc.data_channel_open",
          { label: dataChannel.label, readyState: dataChannel.readyState },
          attemptSessionId,
        );
      dataChannel.onclose = () =>
        recordDiagnostic(
          "webrtc.data_channel_closed",
          { label: dataChannel.label, readyState: dataChannel.readyState },
          attemptSessionId,
        );
      dataChannel.onerror = () =>
        recordDiagnostic(
          "webrtc.data_channel_error",
          { label: dataChannel.label, readyState: dataChannel.readyState },
          attemptSessionId,
        );
      dataChannel.onmessage = (event) => {
        if (typeof event.data !== "string") {
          recordDiagnostic(
            "webrtc.data_message_ignored",
            { dataType: typeof event.data },
            attemptSessionId,
          );
          return;
        }
        try {
          const raw = JSON.parse(event.data) as Record<string, unknown>;
          const eventType = typeof raw.type === "string" ? raw.type : "unknown";
          if (eventType === "output_transcript.added" && performanceTurnRef.current) {
            performanceTurnRef.current.modelOutputObserved = true;
          }
          if (
            /audio.*delta|delta.*audio/i.test(eventType) &&
            !/input/i.test(eventType)
          ) {
            const activeTutorCue = activeTutorCueRef.current;
            if (activeTutorCue) {
              activeTutorCueRef.current = null;
              recordDiagnostic(
                "lesson.cue_audio_started",
                { cue: activeTutorCue, source: "data-channel", eventType },
                attemptSessionId,
              );
            }
            markPerformanceMilestone(
              "first_model_audio",
              { source: "data-channel", eventType },
              attemptSessionId,
            );
          }
          if (eventType === "turn.created") {
            realtimeTurnActiveRef.current = true;
          }
          if (eventType === "turn.done") {
            realtimeTurnActiveRef.current = false;
            for (const resolve of turnIdleWaitersRef.current) resolve();
            turnIdleWaitersRef.current.clear();
          }

          if (
            eventType === "turn.created" &&
            resumeOutputOnNextTurnRef.current &&
            !canvasPreambleSuppressionRef.current
          ) {
            resumeOutputOnNextTurnRef.current = false;
            audio.muted = false;
            recordDiagnostic(
              "client.output_audio_resumed",
              { trigger: eventType },
              attemptSessionId,
            );
          }
          if (
            eventType === "conversation.item.input_audio_transcription.completed" &&
            typeof raw.transcript === "string"
          ) {
            resolveVoiceIntentTranscript(raw.transcript, attemptSessionId);
            addTranscript("user", raw.transcript, true);
            recordDiagnostic(
              "webrtc.input_audio_transcription",
              { type: eventType, transcript: raw.transcript },
              attemptSessionId,
            );
          } else {
            recordDiagnostic(
              "webrtc.data_message",
              {
                type: eventType,
                itemId: typeof raw.item_id === "string" ? raw.item_id : null,
                responseId: typeof raw.response_id === "string" ? raw.response_id : null,
                text: typeof raw.text === "string" ? raw.text : null,
              },
              attemptSessionId,
            );
          }
        } catch (dataError) {
          recordDiagnostic(
            "webrtc.data_parse_failed",
            {
              message: dataError instanceof Error ? dataError.message : String(dataError),
              messageLength: event.data.length,
            },
            attemptSessionId,
          );
        }
      };

      setStatus("connecting");
      recordTutorStatus("connecting", null, attemptSessionId);
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer);
      const localSdp = peer.localDescription?.sdp;
      if (!localSdp) throw new Error("浏览器没有生成有效的 WebRTC SDP。");
      recordDiagnostic(
        "webrtc.local_description_ready",
        { sdpLength: localSdp.length, iceGatheringState: peer.iceGatheringState },
        attemptSessionId,
      );
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: startController.signal,
        body: JSON.stringify({
          mode: "voice",
          sdp: localSdp,
          clientSessionId: attemptSessionId,
          ...(attemptLearningSessionId
            ? { learningSessionId: attemptLearningSessionId }
            : {}),
          topic,
          voice: "juniper",
          language: realtimeSessionLanguage(),
          saveLearningRecord,
        }),
      });
      const payload: unknown = await response.json().catch(() => null);
      throwIfAborted(startController.signal);
      if (!response.ok) {
        throw new Error(responseMessage(payload, "Realtime 会话启动失败。"));
      }
      const session = createRealtimeSessionResponseSchema.parse(payload);
      if (session.mode !== "voice" || !session.sdp) {
        throw new Error("服务端没有返回有效的语音连接信息。");
      }
      if (session.sessionId !== attemptSessionId) {
        recordDiagnostic(
          "session.id_mismatch",
          {
            clientSessionId: attemptSessionId,
            serverSessionId: session.sessionId,
            message: "服务端会话 ID 与客户端预分配 ID 不同，已切换到服务端 ID。",
          },
          attemptSessionId,
        );
        await flushDiagnostics();
        setLogSessionId(session.sessionId);
        recordDiagnostic(
          "client.session_id_adopted",
          { clientSessionId: attemptSessionId, serverSessionId: session.sessionId },
          session.sessionId,
        );
      }
      sessionIdRef.current = session.sessionId;
      sessionEstablishedRef.current = true;
      sessionStartsRef.current += 1;
      setModel(session.model);
      setLearningRecordEnabled(session.learningRecordEnabled);
      setRecordAvailable(true);
      openEventStream(session.sessionId);
      await peer.setRemoteDescription({ type: "answer", sdp: session.sdp });
      recordDiagnostic(
        "webrtc.remote_description_ready",
        {
          remoteSdpLength: session.sdp.length,
          model: session.model,
          protocolVersion: session.protocolVersion,
        },
        session.sessionId,
      );
      setStatus("connected");
      recordTutorStatus("connected", null, session.sessionId);
      await flushDiagnostics();
      if (startAbortRef.current === startController) startAbortRef.current = null;
    } catch (startError) {
      const cancelled = isAbortError(startError);
      recordDiagnostic(
        cancelled ? "client.start_cancelled" : "client.start_failed",
        { message: startError instanceof Error ? startError.message : String(startError) },
        attemptSessionId,
      );
      if (sessionEstablishedRef.current) await flushDiagnostics(true);
      releaseLocalResources();
      if (sessionEstablishedRef.current) {
        void fetch(`/api/realtime/session/${attemptSessionId}`, {
          method: "DELETE",
          keepalive: true,
        });
      } else {
        diagnosticQueueRef.current = diagnosticQueueRef.current.filter(
          (item) => item.sessionId !== attemptSessionId,
        );
      }
      sessionIdRef.current = null;
      sessionEstablishedRef.current = false;
      if (startAbortRef.current === startController) startAbortRef.current = null;
      setError(
        cancelled
          ? null
          : startError instanceof Error
            ? startError.message
            : "Realtime 会话启动失败。",
      );
      setStatus(cancelled ? "stopped" : "error");
      recordTutorStatus(
        cancelled ? "stopped" : "error",
        cancelled
          ? null
          : startError instanceof Error
            ? startError.message
            : "Realtime 会话启动失败。",
        attemptSessionId,
      );
    }
  }, [
    addTranscript,
    flushDiagnostics,
    markPerformanceMilestone,
    openEventStream,
    recordDiagnostic,
    recordTutorStatus,
    releaseLocalResources,
    resolveVoiceIntentTranscript,
    startMicrophoneDiagnostics,
    startPeerDiagnostics,
    status,
    stop,
    topic,
    saveLearningRecord,
    learningSessionId,
    voicePreferences,
  ]);

  useEffect(() => {
    const nextLearningSessionId = learningSessionId ?? null;
    if (!sessionIdRef.current) {
      boundLearningSessionIdRef.current = nextLearningSessionId;
      return;
    }
    if (boundLearningSessionIdRef.current === nextLearningSessionId) return;

    boundLearningSessionIdRef.current = nextLearningSessionId;
    void stop().then(() => {
      addTranscript(
        "system",
        "课程已经切换。为确保学习步骤正确，请重新开始学习搭档。",
        true,
      );
    });
  }, [addTranscript, learningSessionId, stop]);

  const deleteLearningRecord = useCallback(async () => {
    const sessionId = sessionIdRef.current ?? logSessionId;
    if (!sessionId) return;
    const response = await fetch(`/api/realtime/session/${sessionId}/log`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const payload: unknown = await response.json().catch(() => null);
      throw new Error(responseMessage(payload, "学习记录删除失败。"));
    }
    setLearningRecordEnabled(false);
    setRecordAvailable(false);
  }, [logSessionId]);

  const toggleMute = useCallback(() => {
    const nextMuted = !mutedRef.current;
    mutedRef.current = nextMuted;
    setMicrophoneTracksEnabled(
      shouldEnableMicrophoneTrack(
        voicePreferencesRef.current,
        nextMuted,
        pushToTalkActiveRef.current,
      ),
    );
    setMuted(nextMuted);
    recordDiagnostic(
      nextMuted ? "microphone.user_muted" : "microphone.user_unmuted",
      {
        tracks: streamRef.current?.getAudioTracks().map((track) => ({
          label: track.label,
          enabled: track.enabled,
          readyState: track.readyState,
        })) ?? [],
      },
    );
  }, [recordDiagnostic, setMicrophoneTracksEnabled]);

  const setPushToTalkActive = useCallback(
    (nextActive: boolean) => {
      if (voicePreferencesRef.current.inputMode !== "push-to-talk") return;
      if (pushToTalkActiveRef.current === nextActive) return;
      pushToTalkActiveRef.current = nextActive;
      setPushToTalkActiveState(nextActive);
      const enabled = shouldEnableMicrophoneTrack(
        voicePreferencesRef.current,
        mutedRef.current,
        nextActive,
      );
      setMicrophoneTracksEnabled(enabled);
      recordDiagnostic(
        nextActive
          ? "microphone.push_to_talk_started"
          : "microphone.push_to_talk_stopped",
        { enabled },
      );
    },
    [recordDiagnostic, setMicrophoneTracksEnabled],
  );

  const interrupt = useCallback(async () => {
    recordDiagnostic("client.response_stop_requested", {
      mode: activeMode,
      channelState: dataChannelRef.current?.readyState ?? "missing",
    });
    await stop();
  }, [activeMode, recordDiagnostic, stop]);

  const sendText = useCallback(async (text: string) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) throw new Error("请先开始文字问答或语音讲解。");
    if (realtimeTurnActiveRef.current) {
      recordDiagnostic("text.input_barge_in_requested", { text });
    }

    beginPerformanceTurn(
      "text",
      Date.now(),
      REALTIME_PERFORMANCE_POLICY.textT0,
      sessionId,
    );
    suppressCanvasPreamble(text, "text", sessionId);
    const response = await fetch(`/api/realtime/session/${sessionId}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      if (canvasPreambleSuppressionRef.current) {
        canvasPreambleSuppressionRef.current = false;
        canvasToolResultObservedRef.current = false;
        if (audioRef.current) audioRef.current.muted = false;
      }
      const payload: unknown = await response.json().catch(() => null);
      recordDiagnostic("text.input_submit_failed", { text, httpStatus: response.status });
      throw new Error(responseMessage(payload, "文字问题发送失败。"));
    }
    recordDiagnostic("text.input_submitted", { text, httpStatus: response.status });
    addTranscript("user", text, true);
  }, [
    addTranscript,
    beginPerformanceTurn,
    recordDiagnostic,
    suppressCanvasPreamble,
  ]);

  const sendTutorCue = useCallback(async (cue: RealtimeTutorCue) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) throw new Error("请先开始文字问答或语音讲解。");
    if (realtimeTurnActiveRef.current) {
      recordDiagnostic("lesson.cue_queued_until_turn_idle", { cue });
      await new Promise<void>((resolve) => {
        let settled = false;
        let waiter = () => undefined;
        const finish = () => {
          if (settled) return;
          settled = true;
          turnIdleWaitersRef.current.delete(waiter);
          resolve();
        };
        const timeout = window.setTimeout(finish, 20_000);
        waiter = () => {
          window.clearTimeout(timeout);
          finish();
        };
        turnIdleWaitersRef.current.add(waiter);
      });
      recordDiagnostic("lesson.cue_queue_released", { cue });
    }

    performanceTurnRef.current = null;
    if (activeMode === "voice") activeTutorCueRef.current = cue;
    const response = await fetch(`/api/realtime/session/${sessionId}/cue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cue }),
    });
    if (!response.ok) {
      if (activeTutorCueRef.current === cue) activeTutorCueRef.current = null;
      const payload: unknown = await response.json().catch(() => null);
      recordDiagnostic("lesson.cue_submit_failed", {
        cue,
        httpStatus: response.status,
      });
      throw new Error(responseMessage(payload, "刚才的追问没有发出。"));
    }
    recordDiagnostic("lesson.cue_submitted", {
      cue,
      httpStatus: response.status,
    });
  }, [activeMode, recordDiagnostic]);

  return {
    status,
    error,
    muted,
    pushToTalkActive,
    activeMode,
    model,
    logSessionId,
    learningRecordEnabled,
    recordAvailable,
    transcripts,
    latestFactReceipt,
    startText,
    startVoice,
    stop,
    toggleMute,
    setPushToTalkActive,
    interrupt,
    sendText,
    sendTutorCue,
    deleteLearningRecord,
  };
}
