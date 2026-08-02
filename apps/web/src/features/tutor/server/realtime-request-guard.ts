import { createHash, randomBytes } from "node:crypto";

const OWNER_COOKIE = "ai_tutor_owner";
const OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const REALTIME_OWNER_TTL_MS = 60 * 60 * 1_000;
const OWNER_COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_ACTIVE_SESSIONS_PER_OWNER = 2;

interface OwnerRecord {
  readonly ownerId: string;
  expiresAt: number;
  active: boolean;
}

interface GuardState {
  readonly ownersBySession: Map<string, OwnerRecord>;
  readonly pendingStarts: Map<string, number>;
  readonly rateWindows: Map<string, number[]>;
}

const guardGlobal = globalThis as typeof globalThis & {
  __aiTutorRealtimeGuard?: GuardState;
};

function guardState(): GuardState {
  guardGlobal.__aiTutorRealtimeGuard ??= {
    ownersBySession: new Map(),
    pendingStarts: new Map(),
    rateWindows: new Map(),
  };
  return guardGlobal.__aiTutorRealtimeGuard;
}

export class RealtimeRequestBoundaryError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RealtimeRequestBoundaryError";
  }
}

function fail(code: string, status: number, message: string): never {
  throw new RealtimeRequestBoundaryError(code, status, message);
}

function isLoopback(hostname: string): boolean {
  return ["127.0.0.1", "::1", "localhost"].includes(
    hostname.toLowerCase().replace(/^\[|\]$/g, ""),
  );
}

export function assertLoopbackSameOrigin(request: Request): void {
  const requestUrl = new URL(request.url);
  const hostHeader = request.headers.get("host") ?? requestUrl.host;
  let hostUrl: URL;
  try {
    hostUrl = new URL(`${requestUrl.protocol}//${hostHeader}`);
  } catch {
    fail("REALTIME_LOOPBACK_ONLY", 403, "学习会话只能从本机页面使用。");
  }
  if (!isLoopback(hostUrl.hostname)) {
    fail("REALTIME_LOOPBACK_ONLY", 403, "学习会话只能从本机页面使用。");
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== hostUrl.origin) {
    fail("REALTIME_CROSS_SITE_BLOCKED", 403, "跨站请求已被拒绝。");
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    fail("REALTIME_CROSS_SITE_BLOCKED", 403, "跨站请求已被拒绝。");
  }
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return null;
}

function ownerIdForToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface RealtimeOwnerContext {
  readonly ownerId: string;
  readonly setCookie: string | null;
}

export function establishRealtimeOwner(request: Request): RealtimeOwnerContext {
  assertLoopbackSameOrigin(request);
  const existing = cookieValue(request, OWNER_COOKIE);
  if (existing && !OWNER_TOKEN_PATTERN.test(existing)) {
    fail("REALTIME_OWNER_INVALID", 401, "本机学习会话凭据无效，请刷新页面。");
  }
  const token = existing ?? randomBytes(32).toString("base64url");
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return {
    ownerId: ownerIdForToken(token),
    setCookie: existing
      ? null
      : `${OWNER_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${
          OWNER_COOKIE_TTL_MS / 1_000
        }${secure}`,
  };
}

export function requireRealtimeOwner(request: Request): RealtimeOwnerContext {
  assertLoopbackSameOrigin(request);
  const token = cookieValue(request, OWNER_COOKIE);
  if (!token || !OWNER_TOKEN_PATTERN.test(token)) {
    fail("REALTIME_OWNER_REQUIRED", 401, "请从当前本机页面重新开始学习会话。");
  }
  return { ownerId: ownerIdForToken(token), setCookie: null };
}

function pruneOwners(now = Date.now()): void {
  for (const [sessionId, record] of guardState().ownersBySession) {
    if (record.expiresAt <= now) guardState().ownersBySession.delete(sessionId);
  }
}

export function reserveRealtimeSession(ownerId: string): () => void {
  pruneOwners();
  const state = guardState();
  const active = [...state.ownersBySession.values()].filter(
    (record) => record.ownerId === ownerId && record.active,
  ).length;
  const pending = state.pendingStarts.get(ownerId) ?? 0;
  if (active + pending >= MAX_ACTIVE_SESSIONS_PER_OWNER) {
    fail("REALTIME_CONCURRENCY_LIMIT", 429, "请先结束正在进行的学习会话。");
  }
  state.pendingStarts.set(ownerId, pending + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = state.pendingStarts.get(ownerId) ?? 1;
    if (current <= 1) state.pendingStarts.delete(ownerId);
    else state.pendingStarts.set(ownerId, current - 1);
  };
}

export function bindRealtimeSessionOwner(sessionId: string, ownerId: string): void {
  guardState().ownersBySession.set(sessionId, {
    ownerId,
    active: true,
    expiresAt: Date.now() + REALTIME_OWNER_TTL_MS,
  });
}

export function requireRealtimeSessionOwner(
  sessionId: string,
  ownerId: string,
): void {
  pruneOwners();
  const record = guardState().ownersBySession.get(sessionId);
  if (!record || record.ownerId !== ownerId) {
    fail("REALTIME_SESSION_FORBIDDEN", 403, "这个学习会话不属于当前页面。");
  }
  record.expiresAt = Date.now() + REALTIME_OWNER_TTL_MS;
}

export function releaseRealtimeSessionOwner(sessionId: string): void {
  const record = guardState().ownersBySession.get(sessionId);
  if (!record) return;
  record.active = false;
  record.expiresAt = Date.now() + REALTIME_OWNER_TTL_MS;
}

export function consumeRealtimeRate(
  ownerId: string,
  scope: string,
  limit: number,
  windowMs = 60_000,
): void {
  const state = guardState();
  const key = `${ownerId}:${scope}`;
  const cutoff = Date.now() - windowMs;
  const recent = (state.rateWindows.get(key) ?? []).filter((at) => at > cutoff);
  if (recent.length >= limit) {
    fail("REALTIME_RATE_LIMIT", 429, "操作太快了，请稍等片刻再试。");
  }
  recent.push(Date.now());
  state.rateWindows.set(key, recent);
}

function inspectJsonShape(value: unknown, maxDepth: number, maxKeys: number): void {
  const stack: { readonly value: unknown; readonly depth: number }[] = [
    { value, depth: 0 },
  ];
  let keys = 0;
  while (stack.length > 0) {
    const item = stack.pop()!;
    if (!item.value || typeof item.value !== "object") continue;
    if (item.depth >= maxDepth) {
      fail("REALTIME_JSON_TOO_DEEP", 400, "请求内容层级过深。");
    }
    const values = Array.isArray(item.value)
      ? item.value
      : Object.values(item.value as Record<string, unknown>);
    keys += Array.isArray(item.value)
      ? item.value.length
      : Object.keys(item.value as Record<string, unknown>).length;
    if (keys > maxKeys) {
      fail("REALTIME_JSON_TOO_COMPLEX", 400, "请求内容过于复杂。");
    }
    for (const child of values) stack.push({ value: child, depth: item.depth + 1 });
  }
}

export async function readBoundedJson(
  request: Request,
  options: { readonly maxBytes: number; readonly maxDepth: number; readonly maxKeys: number },
): Promise<unknown> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > options.maxBytes) {
    fail("REALTIME_BODY_TOO_LARGE", 413, "请求内容过大。");
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > options.maxBytes) {
    fail("REALTIME_BODY_TOO_LARGE", 413, "请求内容过大。");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    fail("REALTIME_JSON_INVALID", 400, "请求内容不是有效 JSON。");
  }
  inspectJsonShape(value, options.maxDepth, options.maxKeys);
  return value;
}

export function realtimeBoundaryResponse(error: unknown): Response | null {
  if (!(error instanceof RealtimeRequestBoundaryError)) return null;
  return Response.json(
    { code: error.code, message: error.message },
    { status: error.status, headers: { "Cache-Control": "no-store" } },
  );
}

export function resetRealtimeRequestGuardForTests(): void {
  delete guardGlobal.__aiTutorRealtimeGuard;
}
