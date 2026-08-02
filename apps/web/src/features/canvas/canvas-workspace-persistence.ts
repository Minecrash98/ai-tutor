export const WORKSPACE_DATABASE_NAME = "ai-tutor-workspace";
export const WORKSPACE_DATABASE_VERSION = 1;
export const WORKSPACE_STORE_NAME = "workspace-state";
export const WORKSPACE_LATEST_KEY = "latest";
export const WORKSPACE_STATE_VERSION = 2;

export interface WorkspaceStateV2 {
  readonly version: typeof WORKSPACE_STATE_VERSION;
  readonly revisionId: string;
  readonly savedAt: string;
  readonly writerId: string;
  readonly canvasSnapshot: unknown;
  readonly semanticState: string;
  readonly checksum: string;
}

export type WorkspaceLoadResult =
  | { readonly status: "empty" }
  | { readonly status: "ready"; readonly state: WorkspaceStateV2 }
  | {
      readonly status: "rescue";
      readonly reason: "corrupted" | "unsupported";
      readonly raw: string;
    };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]),
  );
}

function checksumSource(
  state: Omit<WorkspaceStateV2, "checksum">,
): string {
  return JSON.stringify(
    stableValue([
      state.version,
      state.revisionId,
      state.savedAt,
      state.writerId,
      state.canvasSnapshot,
      state.semanticState,
    ]),
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function rescueText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export async function createWorkspaceState(input: {
  readonly canvasSnapshot: unknown;
  readonly semanticState: string;
  readonly writerId: string;
  readonly revisionId?: string;
  readonly savedAt?: string;
}): Promise<WorkspaceStateV2> {
  const unsigned = {
    version: WORKSPACE_STATE_VERSION,
    revisionId: input.revisionId ?? crypto.randomUUID(),
    savedAt: input.savedAt ?? new Date().toISOString(),
    writerId: input.writerId,
    canvasSnapshot: input.canvasSnapshot,
    semanticState: input.semanticState,
  } as const;
  return Object.freeze({
    ...unsigned,
    checksum: await sha256(checksumSource(unsigned)),
  });
}

export async function inspectWorkspaceState(
  value: unknown,
): Promise<WorkspaceLoadResult> {
  if (value === undefined || value === null) return { status: "empty" };
  if (
    !value ||
    typeof value !== "object" ||
    (value as { version?: unknown }).version !== WORKSPACE_STATE_VERSION
  ) {
    return {
      status: "rescue",
      reason: "unsupported",
      raw: rescueText(value),
    };
  }
  const candidate = value as Partial<WorkspaceStateV2>;
  if (
    typeof candidate.revisionId !== "string" ||
    typeof candidate.savedAt !== "string" ||
    typeof candidate.writerId !== "string" ||
    typeof candidate.semanticState !== "string" ||
    typeof candidate.checksum !== "string" ||
    !candidate.canvasSnapshot
  ) {
    return {
      status: "rescue",
      reason: "corrupted",
      raw: rescueText(value),
    };
  }
  const unsigned = {
    version: WORKSPACE_STATE_VERSION,
    revisionId: candidate.revisionId,
    savedAt: candidate.savedAt,
    writerId: candidate.writerId,
    canvasSnapshot: candidate.canvasSnapshot,
    semanticState: candidate.semanticState,
  } as const;
  if ((await sha256(checksumSource(unsigned))) !== candidate.checksum) {
    return {
      status: "rescue",
      reason: "corrupted",
      raw: rescueText(value),
    };
  }
  return {
    status: "ready",
    state: Object.freeze({ ...unsigned, checksum: candidate.checksum }),
  };
}

function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      WORKSPACE_DATABASE_NAME,
      WORKSPACE_DATABASE_VERSION,
    );
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(WORKSPACE_STORE_NAME)) {
        database.createObjectStore(WORKSPACE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("无法打开设备上的工作区存储。"));
    request.onblocked = () =>
      reject(new Error("工作区存储正在被另一个页面升级，请关闭旧页面后重试。"));
  });
}

export async function loadWorkspaceState(): Promise<WorkspaceLoadResult> {
  const database = await openWorkspaceDatabase();
  try {
    const value = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(
        WORKSPACE_STORE_NAME,
        "readonly",
      );
      const request = transaction
        .objectStore(WORKSPACE_STORE_NAME)
        .get(WORKSPACE_LATEST_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error("无法读取设备上的工作区记录。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("读取工作区记录时事务中止。"));
    });
    return inspectWorkspaceState(value);
  } finally {
    database.close();
  }
}

export async function saveWorkspaceState(input: {
  readonly canvasSnapshot: unknown;
  readonly semanticState: string;
  readonly writerId: string;
}): Promise<WorkspaceStateV2> {
  const state = await createWorkspaceState(input);
  const database = await openWorkspaceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        WORKSPACE_STORE_NAME,
        "readwrite",
      );
      transaction
        .objectStore(WORKSPACE_STORE_NAME)
        .put(state, WORKSPACE_LATEST_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("无法保存设备工作区。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("保存工作区时事务中止。"));
    });
    return state;
  } finally {
    database.close();
  }
}

export async function clearWorkspaceState(): Promise<void> {
  const database = await openWorkspaceDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(
        WORKSPACE_STORE_NAME,
        "readwrite",
      );
      transaction
        .objectStore(WORKSPACE_STORE_NAME)
        .delete(WORKSPACE_LATEST_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("无法清理旧工作区记录。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("清理工作区记录时事务中止。"));
    });
  } finally {
    database.close();
  }
}
