import {
  CodexAppServerClient,
  CodexAppServerError,
} from "./codex-app-server-client";

interface AccountReadResult {
  readonly account?: unknown;
  readonly requiresOpenaiAuth?: boolean;
}

interface ModelListResult {
  readonly data?: readonly unknown[];
}

interface VoiceListResult {
  readonly voices?: Readonly<Record<string, unknown>>;
}

export interface TutorRealtimeCapabilityResult {
  readonly ready: true;
  readonly checkedAt: string;
  readonly textAvailable: true;
  readonly voiceAvailable: true;
}

interface TutorRealtimeCapabilityClient {
  start(): Promise<void>;
  request<T>(method: string, params?: unknown, timeoutMs?: number): Promise<T>;
  close(): Promise<void>;
}

export interface TutorRealtimeCapabilityCheckOptions {
  readonly createClient?: () => TutorRealtimeCapabilityClient;
  readonly retryDelayMs?: number;
}

const RETRYABLE_PREFLIGHT_CODES = new Set(["CODEX_APP_SERVER_EXITED"]);

function isCapabilityClient(
  value: TutorRealtimeCapabilityCheckOptions | TutorRealtimeCapabilityClient,
): value is TutorRealtimeCapabilityClient {
  return (
    typeof (value as TutorRealtimeCapabilityClient).start === "function" &&
    typeof (value as TutorRealtimeCapabilityClient).request === "function" &&
    typeof (value as TutorRealtimeCapabilityClient).close === "function"
  );
}

function isRetryablePreflightError(error: unknown): boolean {
  return (
    error instanceof CodexAppServerError &&
    RETRYABLE_PREFLIGHT_CODES.has(error.code)
  );
}

async function checkWithClient(
  client: TutorRealtimeCapabilityClient,
): Promise<TutorRealtimeCapabilityResult> {
  await client.start();
  const account = await client.request<AccountReadResult>(
    "account/read",
    { refreshToken: true },
    15_000,
  );
  if (account.requiresOpenaiAuth !== false && !account.account) {
    throw new CodexAppServerError(
      "Codex account is not available.",
      "CODEX_AUTH_REQUIRED",
    );
  }

  const models = await client.request<ModelListResult>(
    "model/list",
    { limit: 5, includeHidden: false },
    15_000,
  );
  if (!Array.isArray(models.data) || models.data.length === 0) {
    throw new CodexAppServerError(
      "Codex model provider returned no available models.",
      "CODEX_PROVIDER_UNAVAILABLE",
    );
  }

  const voiceList = await client.request<VoiceListResult>(
    "thread/realtime/listVoices",
    {},
    10_000,
  );
  if (!voiceList.voices || Object.keys(voiceList.voices).length === 0) {
    throw new CodexAppServerError(
      "Codex realtime voice list is unavailable.",
      "CODEX_VOICE_NOT_AVAILABLE",
    );
  }

  return {
    ready: true,
    checkedAt: new Date().toISOString(),
    textAvailable: true,
    voiceAvailable: true,
  };
}

export async function checkTutorRealtimeCapabilities(
  optionsOrClient:
    | TutorRealtimeCapabilityCheckOptions
    | TutorRealtimeCapabilityClient = {},
): Promise<TutorRealtimeCapabilityResult> {
  const directClient = isCapabilityClient(optionsOrClient)
    ? optionsOrClient
    : null;
  const options: TutorRealtimeCapabilityCheckOptions = directClient
    ? {}
    : (optionsOrClient as TutorRealtimeCapabilityCheckOptions);
  const createClient =
    options.createClient ?? (() => new CodexAppServerClient());
  const retryDelayMs = options.retryDelayMs ?? 100;
  const attempts = directClient ? 1 : 2;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const client = directClient ?? createClient();
    try {
      return await checkWithClient(client);
    } catch (error) {
      if (attempt + 1 >= attempts || !isRetryablePreflightError(error)) {
        throw error;
      }
    } finally {
      await client.close();
    }
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new CodexAppServerError(
    "Codex realtime capability check did not complete.",
    "CODEX_PROVIDER_UNAVAILABLE",
  );
}
