"use client";

import type {
  LearningAuditEventInput,
  RealtimeTutorCue,
  RealtimeToolResult,
  TutorTopic,
} from "@ai-tutor/contracts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";

import { useRealtimeTutor } from "./use-realtime-tutor";
import {
  DEFAULT_VOICE_PREFERENCES,
  loadVoicePreferences,
  saveVoicePreferences,
  type VoicePreferences,
} from "./voice-preferences";

interface RealtimeTutorPanelProps {
  readonly onToolCall: (
    tool: string,
    argumentsValue: unknown,
  ) => Promise<RealtimeToolResult>;
  readonly adaptiveCue?: RealtimeTutorAdaptiveCue | null;
  readonly learningSessionId?: string | null;
  readonly onLearningAudit?: (
    learningSessionId: string,
    event: LearningAuditEventInput,
  ) => void;
  readonly demoReady: boolean;
  readonly onStartDemo: (topic: TutorTopic) => Promise<void>;
}

export interface RealtimeTutorAdaptiveCue {
  readonly id: string;
  readonly cue: RealtimeTutorCue;
  readonly question: string;
}

const STATUS_LABELS = {
  idle: "可以开始",
  checking: "正在检查连接",
  "requesting-microphone": "准备语音",
  connecting: "马上就好",
  connected: "正在陪你学",
  listening: "正在听你说",
  thinking: "正在想",
  doing: "正在调整画布",
  speaking: "正在讲解",
  reconnecting: "正在恢复",
  stopped: "本次已结束",
  error: "暂时不可用",
} as const;

const TOPIC_LABELS: Readonly<Record<TutorTopic, string>> = {
  "box-model": "内容周围的空隙",
  flex: "横向排列与间距",
  positioning: "把元素放到指定位置",
  "css-variables": "全局颜色变量",
};

export function RealtimeTutorPanel({
  onToolCall,
  adaptiveCue = null,
  learningSessionId = null,
  onLearningAudit,
  demoReady,
  onStartDemo,
}: RealtimeTutorPanelProps) {
  const [topic, setTopic] = useState<TutorTopic>("box-model");
  const [text, setText] = useState("");
  const [textError, setTextError] = useState<string | null>(null);
  const [saveLearningRecord, setSaveLearningRecord] = useState(false);
  const [voicePreferences, setVoicePreferences] = useState<VoicePreferences>(
    DEFAULT_VOICE_PREFERENCES,
  );
  const [voicePreferencesReady, setVoicePreferencesReady] = useState(false);
  const [voiceSettingsOpen, setVoiceSettingsOpen] = useState(false);
  const [audioInputs, setAudioInputs] = useState<readonly MediaDeviceInfo[]>([]);
  const [deviceListState, setDeviceListState] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [demoStatus, setDemoStatus] = useState<
    "idle" | "running" | "ready" | "error"
  >("idle");
  const [demoMessage, setDemoMessage] = useState<string | null>(null);
  const submittedAdaptiveCuesRef = useRef(new Set<string>());
  const tutor = useRealtimeTutor({
    topic,
    saveLearningRecord,
    voicePreferences,
    learningSessionId,
    onToolCall,
    ...(onLearningAudit ? { onLearningAudit } : {}),
  });

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.get("lang") !== "en" || query.get("demo") !== "css-vars") return;
    const timer = window.setTimeout(() => {
      setTopic("css-variables");
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  const sendTutorCue = tutor.sendTutorCue;
  const active = [
    "connected",
    "listening",
    "thinking",
    "doing",
    "speaking",
    "reconnecting",
  ].includes(tutor.status);
  const busy = ["checking", "requesting-microphone", "connecting"].includes(
    tutor.status,
  );
  const retry = () =>
    tutor.activeMode === "voice" ? tutor.startVoice() : tutor.startText();

  const updateVoicePreferences = useCallback(
    (update: Partial<VoicePreferences>) => {
      setVoicePreferences((current) => ({ ...current, ...update }));
    },
    [],
  );

  const refreshAudioInputs = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceListState("error");
      return;
    }
    setDeviceListState("loading");
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioInputs(devices.filter((device) => device.kind === "audioinput"));
      setDeviceListState("ready");
    } catch {
      setDeviceListState("error");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setVoicePreferences(loadVoicePreferences(window.localStorage));
      setVoicePreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!voicePreferencesReady) return;
    try {
      saveVoicePreferences(window.localStorage, voicePreferences);
    } catch {
      // Preferences are optional; voice remains usable when storage is blocked.
    }
  }, [voicePreferences, voicePreferencesReady]);

  useEffect(() => {
    if (!voiceSettingsOpen) return;
    const mediaDevices = navigator.mediaDevices;
    mediaDevices?.addEventListener?.("devicechange", refreshAudioInputs);
    return () => {
      mediaDevices?.removeEventListener?.("devicechange", refreshAudioInputs);
    };
  }, [refreshAudioInputs, voiceSettingsOpen]);

  useEffect(() => {
    if (!adaptiveCue || !active || busy) return;
    if (submittedAdaptiveCuesRef.current.has(adaptiveCue.id)) return;
    submittedAdaptiveCuesRef.current.add(adaptiveCue.id);
    void sendTutorCue(adaptiveCue.cue).catch((error) => {
      setTextError(
        error instanceof Error
          ? error.message
          : "刚才的追问没有发出，请用文字继续。",
      );
    });
  }, [active, adaptiveCue, busy, sendTutorCue]);

  const submitText = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = text.trim();
    if (!message) return;
    setTextError(null);
    try {
      await tutor.sendText(message);
      setText("");
    } catch (error) {
      setTextError(error instanceof Error ? error.message : "发送失败。");
    }
  };

  const startDemo = async () => {
    setDemoStatus("running");
    setDemoMessage(null);
    try {
      await onStartDemo(topic);
      setDemoStatus("ready");
      setDemoMessage(`${TOPIC_LABELS[topic]}演示已放到画布上。`);
    } catch (error) {
      setDemoStatus("error");
      setDemoMessage(
        error instanceof Error
          ? error.message
          : "演示没有准备好，请再试一次。",
      );
    }
  };

  return (
    <section className="realtime-tutor" aria-label="AI 学习搭档">
      <header className="realtime-tutor__header">
        <div>
          <span>随时问我</span>
          <strong>AI 学习搭档</strong>
        </div>
        <em data-realtime-status={tutor.status}>
          {STATUS_LABELS[tutor.status]}
        </em>
      </header>

      <label className="realtime-tutor__topic">
        <span>想学什么</span>
        <select
          aria-label="教学主题"
          value={topic}
          disabled={active || busy}
          onChange={(event) => setTopic(event.currentTarget.value as TutorTopic)}
        >
          {Object.entries(TOPIC_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <label className="realtime-tutor__privacy">
        <input
          type="checkbox"
          checked={saveLearningRecord}
          disabled={active || busy}
          onChange={(event) => setSaveLearningRecord(event.currentTarget.checked)}
        />
        <span>
          保存本次对话和操作
          <small>仅保存在这台电脑，7 天后自动删除</small>
        </span>
      </label>

      <fieldset
        className="realtime-tutor__voice-mode"
        disabled={active || busy}
      >
        <legend>先选择语音怎么听你说</legend>
        <label>
          <input
            type="radio"
            name="voice-input-mode"
            value="push-to-talk"
            checked={voicePreferences.inputMode === "push-to-talk"}
            onChange={() =>
              updateVoicePreferences({ inputMode: "push-to-talk" })
            }
          />
          <span>
            按住说话（推荐）
            <small>松开就关闭麦克风，更适合共享设备</small>
          </span>
        </label>
        <label>
          <input
            type="radio"
            name="voice-input-mode"
            value="continuous"
            checked={voicePreferences.inputMode === "continuous"}
            onChange={() =>
              updateVoicePreferences({ inputMode: "continuous" })
            }
          />
          <span>
            持续聆听
            <small>适合连续对话，随时可以关闭麦克风</small>
          </span>
        </label>
      </fieldset>

      <details
        className="realtime-tutor__voice-settings"
        onToggle={(event) => {
          const open = event.currentTarget.open;
          setVoiceSettingsOpen(open);
          if (open) void refreshAudioInputs();
        }}
      >
        <summary>语音设置</summary>
        <div className="realtime-tutor__voice-settings-grid">
          <label>
            <span>使用哪个麦克风</span>
            <select
              aria-label="选择麦克风"
              value={voicePreferences.deviceId ?? ""}
              disabled={active || busy || deviceListState === "loading"}
              onChange={(event) =>
                updateVoicePreferences({
                  deviceId: event.currentTarget.value || null,
                })
              }
            >
              <option value="">跟随系统选择</option>
              {voicePreferences.deviceId &&
              !audioInputs.some(
                (device) => device.deviceId === voicePreferences.deviceId,
              ) ? (
                <option value={voicePreferences.deviceId}>
                  已保存的麦克风
                </option>
              ) : null}
              {audioInputs.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `麦克风 ${index + 1}`}
                </option>
              ))}
            </select>
            <small>
              {deviceListState === "loading"
                ? "正在查找设备…"
                : deviceListState === "error"
                  ? "暂时无法读取设备列表，仍可跟随系统选择。"
                  : "这里只列出设备；开始语音前不会打开麦克风。"}
            </small>
          </label>

          <label className="realtime-tutor__range">
            <span>讲解音量</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              aria-label="讲解音量"
              value={Math.round(voicePreferences.outputVolume * 100)}
              onChange={(event) =>
                updateVoicePreferences({
                  outputVolume: Number(event.currentTarget.value) / 100,
                })
              }
            />
            <output>{Math.round(voicePreferences.outputVolume * 100)}%</output>
          </label>

          <label>
            <span>讲解语速</span>
            <select
              aria-label="讲解语速"
              value={String(voicePreferences.playbackRate)}
              onChange={(event) =>
                updateVoicePreferences({
                  playbackRate: Number(event.currentTarget.value),
                })
              }
            >
              <option value="0.8">慢一些</option>
              <option value="1">正常</option>
              <option value="1.2">快一些</option>
            </select>
          </label>

          <label className="realtime-tutor__switch">
            <input
              type="checkbox"
              checked={voicePreferences.outputMuted}
              onChange={(event) =>
                updateVoicePreferences({
                  outputMuted: event.currentTarget.checked,
                  ...(event.currentTarget.checked
                    ? { captionsEnabled: true }
                    : {}),
                })
              }
            />
            <span>关闭讲解声音（字幕仍保留）</span>
          </label>

          <label className="realtime-tutor__switch">
            <input
              type="checkbox"
              checked={voicePreferences.captionsEnabled}
              disabled={voicePreferences.outputMuted}
              onChange={(event) =>
                updateVoicePreferences({
                  captionsEnabled: event.currentTarget.checked,
                })
              }
            />
            <span>
              显示同步字幕
              {voicePreferences.outputMuted ? (
                <small>声音关闭时会保留字幕</small>
              ) : null}
            </span>
          </label>

          <div className="realtime-tutor__voice-reset">
            <small>
              这些选择只保存在这台设备，不会自动打开麦克风。
            </small>
            <button
              type="button"
              disabled={active || busy}
              onClick={() =>
                setVoicePreferences({ ...DEFAULT_VOICE_PREFERENCES })
              }
            >
              恢复默认并忘记设备
            </button>
          </div>
        </div>
      </details>

      <div className="realtime-tutor__controls">
        {!active && !busy ? (
          <>
            <button type="button" onClick={() => void tutor.startText()}>
              开始文字问答
            </button>
            <button
              type="button"
              disabled={voicePreferences.inputMode === null}
              title={
                voicePreferences.inputMode === null
                  ? "请先选择按住说话或持续聆听"
                  : undefined
              }
              onClick={() => void tutor.startVoice()}
            >
              开始语音讲解
            </button>
          </>
        ) : (
          <button
            type="button"
            className="is-danger"
            onClick={() => void tutor.interrupt()}
          >
            {busy ? "取消连接" : "立即停止"}
          </button>
        )}
        {active &&
        tutor.activeMode === "voice" &&
        voicePreferences.inputMode === "continuous" ? (
          <button
            type="button"
            aria-pressed={tutor.muted}
            onClick={tutor.toggleMute}
          >
            {tutor.muted ? "打开麦克风" : "关闭麦克风"}
          </button>
        ) : null}
        {active &&
        tutor.activeMode === "voice" &&
        voicePreferences.inputMode === "push-to-talk" ? (
          <button
            type="button"
            className="is-push-to-talk"
            aria-pressed={tutor.pushToTalkActive}
            onPointerDown={(event) => {
              event.preventDefault();
              try {
                event.currentTarget.setPointerCapture(event.pointerId);
              } catch {
                // Synthetic assistive pointer events may not support capture.
              }
              tutor.setPushToTalkActive(true);
            }}
            onPointerUp={(event) => {
              try {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                  event.currentTarget.releasePointerCapture(event.pointerId);
                }
              } catch {
                // The microphone still closes when capture is unavailable.
              }
              tutor.setPushToTalkActive(false);
            }}
            onPointerCancel={() => tutor.setPushToTalkActive(false)}
            onLostPointerCapture={() => tutor.setPushToTalkActive(false)}
            onKeyDown={(event) => {
              if (event.repeat || !["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              tutor.setPushToTalkActive(true);
            }}
            onKeyUp={(event) => {
              if (!["Enter", " "].includes(event.key)) return;
              event.preventDefault();
              tutor.setPushToTalkActive(false);
            }}
            onBlur={() => tutor.setPushToTalkActive(false)}
          >
            {tutor.pushToTalkActive ? "正在听，松开结束" : "按住说话"}
          </button>
        ) : null}
      </div>

      {!active && !busy ? (
        <p className="realtime-tutor__choice-note">
          文字问答不会使用麦克风；语音讲解会先检查连接，再由浏览器请求麦克风权限。
          {voicePreferences.inputMode === null
            ? " 请先选择按住说话或持续聆听；推荐按住说话。"
            : voicePreferences.inputMode === "push-to-talk"
            ? " 默认只有按住说话时才会传送声音。"
            : " 你已选择持续聆听，进入后可随时关闭麦克风。"}
        </p>
      ) : null}

      <div
        className="realtime-tutor__demo"
        data-demo-mode={demoStatus}
        aria-live="polite"
      >
        <div>
          <strong>演示模式</strong>
          <span>不用登录、联网或麦克风，也能继续看和动手试。</span>
        </div>
        <button
          type="button"
          className="is-demo"
          disabled={!demoReady || active || busy || demoStatus === "running"}
          onClick={() => void startDemo()}
        >
          {!demoReady
            ? "正在准备画布…"
            : demoStatus === "running"
            ? "正在准备…"
            : `打开${TOPIC_LABELS[topic]}演示`}
        </button>
        {demoMessage ? (
          <small role={demoStatus === "error" ? "alert" : "status"}>
            {demoMessage}
          </small>
        ) : null}
      </div>

      {adaptiveCue ? (
        <div className="realtime-tutor__adaptive" aria-live="polite">
          <strong>接着想一想</strong>
          <span>{adaptiveCue.question}</span>
          <small>
            {active
              ? "AI 会接着这一步陪你想。"
              : "选择文字或语音后，AI 会从这一步接着问。"}
          </small>
        </div>
      ) : null}

      {tutor.logSessionId && tutor.recordAvailable ? (
        <div className="realtime-tutor__log">
          <a
            href={`/api/realtime/session/${tutor.logSessionId}/log`}
            download={`ai-tutor-${tutor.logSessionId}.json`}
          >
            {tutor.learningRecordEnabled
              ? "保存本次学习记录"
              : "下载本次连接记录"}
          </a>
          <button
            type="button"
            onClick={() => void tutor.deleteLearningRecord().catch((error) =>
              setTextError(error instanceof Error ? error.message : "本次记录删除失败。"),
            )}
          >
            立即删除
          </button>
          {!tutor.learningRecordEnabled ? (
            <small>不含对话和页面内容，24 小时后自动删除</small>
          ) : null}
        </div>
      ) : null}

      {busy ? (
        <p className="realtime-tutor__hint">
          {tutor.status === "checking"
            ? "先确认语音服务可用，不会读取麦克风…"
            : tutor.activeMode === "voice"
              ? "正在准备语音…"
              : "正在连接文字问答…"}
        </p>
      ) : null}
      {tutor.error ? (
        <div className="realtime-tutor__error" role="alert">
          <strong>刚才没有改动你的内容</strong>
          <span>{tutor.error}</span>
          <button type="button" onClick={() => void retry()}>
            重试
          </button>
        </div>
      ) : null}

      {tutor.activeMode === "voice" &&
      !voicePreferences.captionsEnabled ? (
        <div className="realtime-tutor__transcript is-captions-off">
          <p>字幕已关闭，可在语音设置中重新打开。</p>
        </div>
      ) : (
        <div className="realtime-tutor__transcript" aria-live="polite">
          {tutor.transcripts.length === 0 ? (
            <p>试着问：“怎么让卡片里面更宽松？”</p>
          ) : (
            tutor.transcripts.map((entry) => (
              <article
                key={entry.id}
                data-role={entry.role}
                data-final={entry.final ? "true" : "false"}
              >
                <b>{entry.role === "user" ? "你" : "AI"}</b>
                <span>{entry.text}</span>
              </article>
            ))
          )}
        </div>
      )}

      {tutor.latestFactReceipt ? (
        <details className="realtime-tutor__fact-receipt">
          <summary>
            {tutor.latestFactReceipt.allowed
              ? "查看这句话为什么成立"
              : "查看还缺少什么"}
          </summary>
          {tutor.latestFactReceipt.allowed ? (
            <dl>
              <div>
                <dt>页面里的位置</dt>
                <dd>{tutor.latestFactReceipt.target}</dd>
              </div>
              <div>
                <dt>刚才的变化</dt>
                <dd>
                  {tutor.latestFactReceipt.property ?? "样式"}：
                  {tutor.latestFactReceipt.beforeValue ?? "未记录"} → {tutor.latestFactReceipt.afterValue ?? "未记录"}
                </dd>
              </div>
              <div>
                <dt>页面命中的样式</dt>
                <dd>
                  {tutor.latestFactReceipt.selector ?? "当前目标"} · {tutor.latestFactReceipt.ruleValue ?? "已核对"}
                </dd>
              </div>
              <div>
                <dt>从哪里找到</dt>
                <dd>{tutor.latestFactReceipt.source ?? "当前页面的样式规则"}</dd>
              </div>
            </dl>
          ) : (
            <p>
              当前记录还不能把前后变化、目标和样式规则同时对上。先做一个最小变化并保存，再重新检查。
            </p>
          )}
        </details>
      ) : null}

      <form className="realtime-tutor__text" onSubmit={(event) => void submitText(event)}>
        <input
          value={text}
          disabled={!active}
          aria-label="文字询问 CSS 问题"
          placeholder="也可以输入问题…"
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <button type="submit" disabled={!active || !text.trim()}>
          发送
        </button>
      </form>
      {textError ? <small className="realtime-tutor__text-error">{textError}</small> : null}

    </section>
  );
}
