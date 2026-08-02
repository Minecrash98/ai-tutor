import type {
  RealtimeCourseSummaryMaterial,
  RealtimeLogLevel,
  RealtimeLogRecord,
  RealtimeLogSource,
  RealtimeSessionLogExport,
  RealtimeToolResult,
} from "@ai-tutor/contracts";
import {
  access,
  appendFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const LOG_VERSION = 1 as const;
const SESSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN =
  /authorization|cookie|oauth|access.?token|refresh.?token|secret|api.?key/i;
const MAX_VALUE_DEPTH = 8;
const MAX_ARRAY_ITEMS = 200;
const MAX_STRING_LENGTH = 20_000;
const MAX_SESSION_LOG_BYTES = 5 * 1_024 * 1_024;
const MAX_SESSION_RECORDS = 5_000;
const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_OPERATIONAL_LOG_BYTES = 512 * 1_024;
const MAX_OPERATIONAL_RECORDS = 1_000;
const OPERATIONAL_LOG_RETENTION_MS = 24 * 60 * 60 * 1_000;
const OPERATIONAL_SAFE_STRING_KEYS = new Set([
  "code",
  "eventType",
  "mode",
  "protocolVersion",
  "source",
  "startupKind",
  "state",
  "t0Source",
  "tool",
]);

type RealtimeRecordKind = "learning" | "operational";
type RealtimeRecordPreference = RealtimeRecordKind | "disabled";

interface SessionWriteState {
  sequence: number;
  queue: Promise<void>;
  readonly recordKind: RealtimeRecordKind;
}

function defaultLogRoot(): string {
  const configured = process.env.AI_TUTOR_LOG_DIR?.trim();
  if (configured) return path.resolve(configured);
  const launchRoot = process.env.INIT_CWD?.trim() || process.cwd();
  return path.resolve(launchRoot, ".ai-tutor", "logs", "realtime");
}

function valueString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function sanitizeString(value: string): string {
  if (/^v=0(?:\r?\n|$)/.test(value)) return "[REDACTED SDP]";
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{10,}\b/g, "[REDACTED API KEY]")
    .replace(
      /("(?:access_token|refresh_token|api_key|authorization)"\s*:\s*")[^"]+("?)/gi,
      "$1[REDACTED]$2",
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED EMAIL]")
    .replace(/\b1[3-9]\d{9}\b/g, "[REDACTED PHONE]")
    .replace(/C:\\Users\\[^\\\s]+/gi, "C:\\Users\\[REDACTED]");
}

function sanitizeValue(
  value: unknown,
  key: string,
  depth: number,
  seen: WeakSet<object>,
): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key) || /^sdp$/i.test(key)) return "[REDACTED]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const sanitized = sanitizeString(value);
    return sanitized.length > MAX_STRING_LENGTH
      ? `${sanitized.slice(0, MAX_STRING_LENGTH)}…[TRUNCATED]`
      : sanitized;
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "undefined") return null;
  if (typeof value !== "object") return String(value);
  if (depth >= MAX_VALUE_DEPTH) return "[MAX_DEPTH]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(item, key, depth + 1, seen));
    if (value.length > MAX_ARRAY_ITEMS) items.push("[TRUNCATED]");
    return items;
  }
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, childKey, depth + 1, seen);
  }
  return result;
}

export function sanitizeRealtimeLogPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return sanitizeValue(payload, "payload", 0, new WeakSet()) as Readonly<
    Record<string, unknown>
  >;
}

export function sanitizeOperationalLogPayload(
  payload: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "boolean") {
      result[key] = value;
      continue;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      result[key] = value;
      continue;
    }
    if (
      typeof value === "string" &&
      OPERATIONAL_SAFE_STRING_KEYS.has(key) &&
      /^[a-z0-9_.:-]{1,120}$/i.test(value)
    ) {
      result[key] = value;
    }
  }
  return result;
}

function parseRecord(line: string): RealtimeLogRecord | null {
  try {
    const value = JSON.parse(line) as Partial<RealtimeLogRecord>;
    if (
      value.version !== LOG_VERSION ||
      typeof value.sequence !== "number" ||
      typeof value.at !== "string" ||
      typeof value.sessionId !== "string" ||
      typeof value.source !== "string" ||
      typeof value.level !== "string" ||
      typeof value.event !== "string" ||
      !value.payload ||
      typeof value.payload !== "object"
    ) {
      return null;
    }
    return value as RealtimeLogRecord;
  } catch {
    return null;
  }
}

function buildCourseSummaryMaterial(
  records: readonly RealtimeLogRecord[],
): RealtimeCourseSummaryMaterial {
  const transcript: RealtimeCourseSummaryMaterial["transcript"][number][] = [];
  const lastTranscriptAt = new Map<string, number>();
  const actions = new Map<
    string,
    RealtimeCourseSummaryMaterial["teachingActions"][number]
  >();
  const issues: RealtimeCourseSummaryMaterial["issues"][number][] = [];

  const addTranscript = (
    record: RealtimeLogRecord,
    role: string,
    text: string,
    source: "voice" | "text" | "realtime",
  ) => {
    const key = `${role}\u0000${text}`;
    const timestamp = Date.parse(record.at);
    const previous = lastTranscriptAt.get(key);
    if (previous !== undefined && Number.isFinite(timestamp) && timestamp - previous < 10_000) {
      return;
    }
    lastTranscriptAt.set(key, timestamp);
    transcript.push({ at: record.at, role, text, source });
  };

  for (const record of records) {
    if (record.event === "realtime.transcript" && record.payload.final === true) {
      const role = valueString(record.payload.role);
      const text = valueString(record.payload.text);
      if (role && text) addTranscript(record, role, text, "realtime");
    }
    if (record.event === "text.input.accepted") {
      const text = valueString(record.payload.text);
      if (text) addTranscript(record, "user", text, "text");
    }
    if (record.event === "webrtc.input_audio_transcription") {
      const text = valueString(record.payload.transcript);
      if (text) addTranscript(record, "user", text, "voice");
    }
    if (record.event === "tool.call") {
      const requestId = valueString(record.payload.requestId);
      const tool = valueString(record.payload.tool);
      if (requestId && tool) {
        actions.set(requestId, {
          at: record.at,
          requestId,
          tool,
          arguments: record.payload.arguments ?? null,
          result: null,
        });
      }
    }
    if (record.event === "tool.result") {
      const requestId = valueString(record.payload.requestId);
      const result = record.payload.result;
      const action = requestId ? actions.get(requestId) : null;
      if (action && result && typeof result === "object") {
        actions.set(requestId!, {
          ...action,
          result: result as RealtimeToolResult,
        });
      }
    }
    if (
      record.level === "error" ||
      record.level === "warn" ||
      /error|failed|rejected|validation/.test(record.event)
    ) {
      const message =
        valueString(record.payload.message) ??
        valueString(record.payload.error) ??
        valueString(record.payload.reason) ??
        record.event;
      issues.push({ at: record.at, event: record.event, message });
    }
  }

  return {
    transcript,
    teachingActions: [...actions.values()],
    issues,
  };
}

export interface RealtimeSessionLogger {
  setConsent(sessionId: string, enabled: boolean): Promise<void>;
  delete(sessionId: string): Promise<void>;
  record(
    sessionId: string,
    source: RealtimeLogSource,
    event: string,
    payload?: Readonly<Record<string, unknown>>,
    level?: RealtimeLogLevel,
    at?: string,
  ): Promise<void>;
  flush(sessionId: string): Promise<void>;
}

export class RealtimeSessionLog implements RealtimeSessionLogger {
  private readonly states = new Map<string, SessionWriteState>();
  private readonly recordPreferences = new Map<
    string,
    RealtimeRecordPreference
  >();

  constructor(readonly rootDirectory = defaultLogRoot()) {}

  getFilePath(sessionId: string): string {
    if (!SESSION_ID_PATTERN.test(sessionId)) {
      throw new Error("Invalid realtime log session id");
    }
    return path.join(this.rootDirectory, `${sessionId}.ndjson`);
  }

  private getOperationalFilePath(sessionId: string): string {
    this.getFilePath(sessionId);
    return path.join(this.rootDirectory, `${sessionId}.ops.ndjson`);
  }

  private getMetadataPath(
    sessionId: string,
    recordKind: RealtimeRecordKind,
  ): string {
    return path.join(
      this.rootDirectory,
      recordKind === "learning"
        ? `${sessionId}.meta.json`
        : `${sessionId}.ops.meta.json`,
    );
  }

  private getRecordFilePath(
    sessionId: string,
    recordKind: RealtimeRecordKind,
  ): string {
    return recordKind === "learning"
      ? this.getFilePath(sessionId)
      : this.getOperationalFilePath(sessionId);
  }

  async setConsent(sessionId: string, enabled: boolean): Promise<void> {
    this.getFilePath(sessionId);
    const recordKind: RealtimeRecordKind = enabled
      ? "learning"
      : "operational";
    this.recordPreferences.set(sessionId, recordKind);
    await this.pruneExpiredLogs();
    await mkdir(this.rootDirectory, { recursive: true });
    await writeFile(
      this.getMetadataPath(sessionId, recordKind),
      JSON.stringify({
        version: 1,
        sessionId,
        recordKind,
        expiresAt: new Date(
          Date.now() +
            (recordKind === "learning"
              ? LOG_RETENTION_MS
              : OPERATIONAL_LOG_RETENTION_MS),
        ).toISOString(),
      }),
      "utf8",
    );
  }

  async delete(sessionId: string): Promise<void> {
    this.getFilePath(sessionId);
    await this.flush(sessionId).catch(() => undefined);
    this.states.delete(sessionId);
    this.recordPreferences.set(sessionId, "disabled");
    await Promise.all([
      rm(this.getFilePath(sessionId), { force: true }),
      rm(this.getOperationalFilePath(sessionId), { force: true }),
      rm(this.getMetadataPath(sessionId, "learning"), { force: true }),
      rm(this.getMetadataPath(sessionId, "operational"), { force: true }),
    ]);
  }

  async record(
    sessionId: string,
    source: RealtimeLogSource,
    event: string,
    payload: Readonly<Record<string, unknown>> = {},
    level: RealtimeLogLevel = "info",
    at = new Date().toISOString(),
  ): Promise<void> {
    const recordPreference = this.recordPreferences.get(sessionId);
    if (!recordPreference || recordPreference === "disabled") return;
    const recordKind = recordPreference;
    const filePath = this.getRecordFilePath(sessionId, recordKind);
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        sequence: 0,
        recordKind,
        queue: this.readLastSequence(filePath).then((sequence) => {
          state!.sequence = sequence;
        }),
      };
      this.states.set(sessionId, state);
    }
    const previous = state.queue.catch(() => undefined);
    const task = previous.then(async () => {
      const recordLimit =
        state!.recordKind === "learning"
          ? MAX_SESSION_RECORDS
          : MAX_OPERATIONAL_RECORDS;
      const byteLimit =
        state!.recordKind === "learning"
          ? MAX_SESSION_LOG_BYTES
          : MAX_OPERATIONAL_LOG_BYTES;
      if (state!.sequence >= recordLimit) return;
      const existingBytes = await stat(filePath)
        .then((details) => details.size)
        .catch((error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return 0;
          throw error;
        });
      if (existingBytes >= byteLimit) return;
      const record: RealtimeLogRecord = {
        version: LOG_VERSION,
        sequence: ++state!.sequence,
        at,
        sessionId,
        source,
        level,
        event,
        payload:
          state!.recordKind === "learning"
            ? sanitizeRealtimeLogPayload(payload)
            : sanitizeOperationalLogPayload(payload),
      };
      await mkdir(this.rootDirectory, { recursive: true });
      await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
    });
    state.queue = task;
    return task;
  }

  async recordBrowserEvents(
    sessionId: string,
    events: readonly {
      readonly event: string;
      readonly at: string;
      readonly payload: Readonly<Record<string, unknown>>;
    }[],
  ): Promise<void> {
    for (const event of events) {
      await this.record(sessionId, "browser", event.event, event.payload, "debug", event.at);
    }
  }

  async flush(sessionId: string): Promise<void> {
    await this.states.get(sessionId)?.queue;
  }

  async hasLog(sessionId: string): Promise<boolean> {
    await this.flush(sessionId);
    return Promise.any([
      access(this.getFilePath(sessionId)).then(() => true),
      access(this.getOperationalFilePath(sessionId)).then(() => true),
    ]).catch(() => false);
  }

  async export(sessionId: string): Promise<RealtimeSessionLogExport> {
    await this.flush(sessionId);
    let recordKind: RealtimeRecordKind = "learning";
    let filePath = this.getFilePath(sessionId);
    try {
      await access(filePath);
    } catch {
      recordKind = "operational";
      filePath = this.getOperationalFilePath(sessionId);
    }
    const content = await readFile(filePath, "utf8");
    const records = content
      .split(/\r?\n/)
      .filter(Boolean)
      .map(parseRecord)
      .filter((record): record is RealtimeLogRecord => Boolean(record));
    return {
      version: LOG_VERSION,
      sessionId,
      exportedAt: new Date().toISOString(),
      recordKind,
      records,
      courseSummaryMaterial: buildCourseSummaryMaterial(records),
    };
  }

  private async readLastSequence(filePath: string): Promise<number> {
    try {
      const content = await readFile(filePath, "utf8");
      let maximum = 0;
      for (const line of content.split(/\r?\n/)) {
        const record = line ? parseRecord(line) : null;
        if (record) maximum = Math.max(maximum, record.sequence);
      }
      return maximum;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  private async pruneExpiredLogs(): Promise<void> {
    const files = await readdir(this.rootDirectory).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    const now = Date.now();
    await Promise.all(
      files
        .filter((file) => file.endsWith(".meta.json"))
        .map(async (file) => {
          const metadataPath = path.join(this.rootDirectory, file);
          const operational = file.endsWith(".ops.meta.json");
          const inferredSessionId = file.replace(
            operational ? /\.ops\.meta\.json$/ : /\.meta\.json$/,
            "",
          );
          let sessionId: string | null = SESSION_ID_PATTERN.test(
            inferredSessionId,
          )
            ? inferredSessionId
            : null;
          let expiresAt = Number.POSITIVE_INFINITY;
          try {
            const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as {
              sessionId?: unknown;
              expiresAt?: unknown;
            };
            sessionId =
              typeof metadata.sessionId === "string" ? metadata.sessionId : null;
            expiresAt =
              typeof metadata.expiresAt === "string"
                ? Date.parse(metadata.expiresAt)
                : Number.NaN;
          } catch {
            expiresAt = Number.NaN;
          }
          if (Number.isFinite(expiresAt) && expiresAt > now) return;
          await rm(metadataPath, { force: true });
          if (sessionId && SESSION_ID_PATTERN.test(sessionId)) {
            await rm(
              operational
                ? this.getOperationalFilePath(sessionId)
                : this.getFilePath(sessionId),
              { force: true },
            );
          }
        }),
    );
  }
}

const logGlobal = globalThis as typeof globalThis & {
  __aiTutorRealtimeSessionLog?: RealtimeSessionLog;
  __aiTutorRealtimeSessionLogVersion?: number;
};

const REALTIME_SESSION_LOG_INSTANCE_VERSION = 2;

export function getRealtimeSessionLog(): RealtimeSessionLog {
  if (
    !logGlobal.__aiTutorRealtimeSessionLog ||
    logGlobal.__aiTutorRealtimeSessionLogVersion !==
      REALTIME_SESSION_LOG_INSTANCE_VERSION
  ) {
    logGlobal.__aiTutorRealtimeSessionLog = new RealtimeSessionLog();
    logGlobal.__aiTutorRealtimeSessionLogVersion =
      REALTIME_SESSION_LOG_INSTANCE_VERSION;
  }
  return logGlobal.__aiTutorRealtimeSessionLog;
}
