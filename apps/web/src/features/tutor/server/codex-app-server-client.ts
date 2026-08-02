import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

type JsonRpcId = number;
const execFileAsync = promisify(execFile);
const PROCESS_EXIT_GRACE_MS = 2_000;

function processExited(child: ChildProcessWithoutNullStreams): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForProcessExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number,
): Promise<boolean> {
  if (processExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (exited: boolean) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timeout = setTimeout(() => finish(processExited(child)), timeoutMs);
    timeout.unref?.();
  });
}

async function signalProcessTree(
  child: ChildProcessWithoutNullStreams,
  force: boolean,
): Promise<void> {
  if (processExited(child)) return;
  const pid = child.pid;
  if (!pid) return;
  if (process.platform === "win32") {
    await execFileAsync(
      "taskkill.exe",
      ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])],
      { windowsHide: true },
    ).catch(() => undefined);
    return;
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch {
    try {
      child.kill(force ? "SIGKILL" : "SIGTERM");
    } catch {
      // The process may have exited between the status check and signal.
    }
  }
}

export async function terminateChildProcessTree(
  child: ChildProcessWithoutNullStreams,
  graceMs = PROCESS_EXIT_GRACE_MS,
): Promise<void> {
  if (processExited(child)) return;
  await signalProcessTree(child, false);
  if (await waitForProcessExit(child, graceMs)) return;
  await signalProcessTree(child, true);
  if (await waitForProcessExit(child, graceMs)) return;
  throw new CodexAppServerError(
    "Codex app-server 进程树未能在关闭时限内退出。",
    "CODEX_APP_SERVER_CLOSE_TIMEOUT",
  );
}

export const TUTOR_PROCESS_DISABLED_FEATURES = [
  "apps",
  "hooks",
  "memories",
  "multi_agent",
  "remote_plugin",
  "shell_tool",
] as const;

export const TUTOR_APP_SERVER_ARGS = [
  "app-server",
  "--stdio",
  "--enable",
  "realtime_conversation",
  ...TUTOR_PROCESS_DISABLED_FEATURES.flatMap((feature) => ["--disable", feature]),
  "-c",
  'agents.enabled=false',
  "-c",
  'apps._default.enabled=false',
  "-c",
  'tools.view_image=false',
  "-c",
  'tools.web_search=false',
  "-c",
  'web_search="disabled"',
] as const;

interface JsonRpcResponse {
  readonly id: JsonRpcId;
  readonly result?: unknown;
  readonly error?: { readonly code?: number; readonly message?: string };
}

export interface CodexServerMessage {
  readonly method: string;
  readonly id?: JsonRpcId;
  readonly params?: unknown;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

export class CodexAppServerError extends Error {
  constructor(
    message: string,
    readonly code = "CODEX_APP_SERVER_ERROR",
  ) {
    super(message);
    this.name = "CodexAppServerError";
  }
}

async function resolveDesktopCodexBinary(): Promise<string> {
  const configured = process.env.CODEX_APP_SERVER_BINARY?.trim();
  if (configured) return configured;

  if (process.platform !== "win32") return "codex";
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return "codex";

  const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
  try {
    const directories = await readdir(binRoot, { withFileTypes: true });
    const candidates = await Promise.all(
      directories
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          const binary = path.join(binRoot, entry.name, "codex.exe");
          try {
            return { binary, modifiedAt: (await stat(binary)).mtimeMs };
          } catch {
            return null;
          }
        }),
    );
    const newest = candidates
      .filter((candidate): candidate is NonNullable<typeof candidate> =>
        Boolean(candidate),
      )
      .sort((left, right) => right.modifiedAt - left.modifiedAt)[0];
    return newest?.binary ?? "codex";
  } catch {
    return "codex";
  }
}

function friendlySpawnError(error: unknown): CodexAppServerError {
  const message = error instanceof Error ? error.message : String(error);
  if (/ENOENT|not found|cannot find/i.test(message)) {
    return new CodexAppServerError(
      "未找到 Codex app-server。请安装或启动 Codex Desktop，或设置 CODEX_APP_SERVER_BINARY。",
      "CODEX_APP_SERVER_NOT_FOUND",
    );
  }
  return new CodexAppServerError(
    `无法启动 Codex app-server：${message}`,
    "CODEX_APP_SERVER_START_FAILED",
  );
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private closePromise: Promise<void> | null = null;
  private nextId = 1;
  private readonly recentMethods: string[] = [];
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<
    (message: CodexServerMessage) => void
  >();
  private readonly requestListeners = new Set<
    (message: Required<Pick<CodexServerMessage, "method" | "id">> &
      Pick<CodexServerMessage, "params">) => void
  >();
  private readonly stderrListeners = new Set<(line: string) => void>();

  async start(): Promise<void> {
    if (this.closePromise) await this.closePromise;
    if (this.child) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    const binary = await resolveDesktopCodexBinary();
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        binary,
        [...TUTOR_APP_SERVER_ARGS],
        {
          env: process.env,
          detached: process.platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
    } catch (error) {
      throw friendlySpawnError(error);
    }
    this.child = child;

    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on("line", (line) => this.handleLine(line));
    const errorLines = createInterface({ input: child.stderr, crlfDelay: Infinity });
    errorLines.on("line", (line) => {
      if (!line.trim()) return;
      this.stderrListeners.forEach((listener) => listener(line));
    });
    child.once("error", (error) =>
      this.handleExit(friendlySpawnError(error), child),
    );
    child.once("exit", (code) => {
      this.handleExit(
        new CodexAppServerError(
          `Codex app-server 已退出（code ${code ?? "unknown"}）。`,
          "CODEX_APP_SERVER_EXITED",
        ),
        child,
      );
    });

    await this.request("initialize", {
      clientInfo: {
        name: "ai_tutor_local",
        title: "AI Tutor Local Canvas",
        version: "0.1.0",
      },
      capabilities: {
        experimentalApi: true,
        requestAttestation: false,
        optOutNotificationMethods: ["thread/tokenUsage/updated"],
      },
    });
    this.notify("initialized");
  }

  onNotification(listener: (message: CodexServerMessage) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  onServerRequest(
    listener: (
      message: Required<Pick<CodexServerMessage, "method" | "id">> &
        Pick<CodexServerMessage, "params">,
    ) => void,
  ): () => void {
    this.requestListeners.add(listener);
    return () => this.requestListeners.delete(listener);
  }

  onStderr(listener: (line: string) => void): () => void {
    this.stderrListeners.add(listener);
    return () => this.stderrListeners.delete(listener);
  }

  getRecentMethods(): readonly string[] {
    return this.recentMethods;
  }

  async request<T>(
    method: string,
    params?: unknown,
    timeoutMs = 25_000,
  ): Promise<T> {
    if (!this.child && method !== "initialize") await this.start();
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new CodexAppServerError(
            `Codex app-server 请求超时：${method}`,
            "CODEX_APP_SERVER_TIMEOUT",
          ),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.write({ method, id, ...(params === undefined ? {} : { params }) });
      } catch (error) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respondResult(id: JsonRpcId, result: unknown): void {
    this.write({ id, result });
  }

  respondError(id: JsonRpcId, code: number, message: string): void {
    this.write({ id, error: { code, message } });
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const child = this.child;
    this.child = null;
    if (!child) return;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(
        new CodexAppServerError(
          "Codex app-server 已按会话生命周期关闭。",
          "CODEX_APP_SERVER_CLOSED",
        ),
      );
    }
    this.pending.clear();
    this.closePromise = terminateChildProcessTree(child).finally(() => {
      this.closePromise = null;
    });
    return this.closePromise;
  }

  private write(value: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new CodexAppServerError(
        "Codex app-server 尚未运行。",
        "CODEX_APP_SERVER_NOT_RUNNING",
      );
    }
    this.child.stdin.write(`${JSON.stringify(value)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.id === "number" && ("result" in record || "error" in record)) {
      this.handleResponse(record as unknown as JsonRpcResponse);
      return;
    }
    if (typeof record.method !== "string") return;
    this.recentMethods.push(record.method);
    if (this.recentMethods.length > 20) this.recentMethods.shift();
    const message = {
      method: record.method,
      ...(typeof record.id === "number" ? { id: record.id } : {}),
      ...(record.params === undefined ? {} : { params: record.params }),
    } satisfies CodexServerMessage;
    if (message.id !== undefined) {
      if (this.requestListeners.size === 0) {
        this.respondError(message.id, -32601, "Unsupported client request");
        return;
      }
      this.requestListeners.forEach((listener) =>
        listener({ method: message.method, id: message.id!, params: message.params }),
      );
      return;
    }
    this.notificationListeners.forEach((listener) => listener(message));
  }

  private handleResponse(response: JsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    clearTimeout(pending.timeout);
    if (response.error) {
      pending.reject(
        new CodexAppServerError(
          response.error.message ?? "Codex app-server 请求失败。",
          `CODEX_RPC_${response.error.code ?? "ERROR"}`,
        ),
      );
      return;
    }
    pending.resolve(response.result);
  }

  private handleExit(
    error: Error,
    child: ChildProcessWithoutNullStreams,
  ): void {
    if (this.child !== child) return;
    this.child = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
    this.notificationListeners.forEach((listener) =>
      listener({ method: "client/error", params: { message: error.message } }),
    );
  }
}
