/**
 * 草稿/对话 autosave 的串行队列 + 状态中枢（审查 #3/#4/#5；R4b 按 key 记错）。
 *
 * 旧实现只存单个 `inFlight` 指针、后发请求覆盖旧指针、drain 只等最后登记的一笔，网络乱序时较旧 PUT 可能
 * 最后落定覆盖新稿；且失败被 `catch(()=>{})` 静默吞掉，用户以为已保存、重启才发现丢内容。
 *
 * 现在：
 *  - **按 key 串行、last-write-wins**：同一章节的写盘排成队列，一笔在写时新请求只覆盖「待写槽」，
 *    当前写完再跑最新的那笔——旧稿永远不会盖新稿，突发编辑自动合并成「最后一次写」。
 *  - **状态可见**：saving / saved / error + lastError + lastSavedAt，React 侧订阅后能显示「保存中/已保存/
 *    保存失败」，绝不再静默。按 key 记最近一次结果；**任一 key 仍失败则全局 error 优先**（B 章成功
 *    不会抹掉 A 章的失败提示）。
 *  - **可 drain**：撤销前 suspend + drain 等掉所有在途，保证 restore 落在写盘之后、被一并回退。
 * 模块态随整页 reload 重置（reload 后是全新 JS 上下文）。
 */

export type AutosaveStatus = "idle" | "saving" | "saved" | "error";

export interface AutosaveSnapshot {
  readonly status: AutosaveStatus;
  /** 是否还有未落盘的改动（在写或待写）——退出/返回前据此决定要不要 flush + 等待。 */
  readonly hasPending: boolean;
  readonly lastError: string | null;
  readonly lastSavedAt: number | null;
}

export type AutosaveFlushResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: string };

/**
 * 保存失败后保留当时的完整 payload；重试只能重放该对象，绝不重新读取已经切换过的全局 store。
 */
export function createExactPayloadAutosaveRunner<T>(
  persist: (payload: T) => Promise<AutosaveFlushResult>,
  options: {
    /** 同一保存身份的较新成功 payload 可废弃旧失败，防自动重试把旧消息反向覆盖新消息。 */
    readonly supersedes?: (newer: T, failed: T) => boolean;
  } = {},
): {
  readonly run: (payload: T) => Promise<AutosaveFlushResult>;
  readonly retry: () => Promise<AutosaveFlushResult>;
  readonly getFailedPayload: () => T | null;
} {
  let failedPayload: T | null = null;

  const run = async (payload: T): Promise<AutosaveFlushResult> => {
    let result: AutosaveFlushResult;
    try {
      result = await persist(payload);
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    if (result.ok) {
      if (failedPayload === payload || (failedPayload !== null && options.supersedes?.(payload, failedPayload))) {
        failedPayload = null;
      }
    } else {
      failedPayload = payload;
    }
    return result;
  };

  return {
    run,
    retry: () => failedPayload ? run(failedPayload) : Promise.resolve({ ok: true }),
    getFailedPayload: () => failedPayload,
  };
}

let suspended = false;

interface Slot {
  running: boolean;
  pending: (() => Promise<void>) | null;
  drain: Promise<AutosaveFlushResult> | null;
  /** 该 key 最近一次写盘结果：失败信息；成功或开跑前清空。 */
  lastError: string | null;
  lastErrorAt: number | null;
}
const slots = new Map<string, Slot>();

let lastSavedAt: number | null = null;
let snapshot: AutosaveSnapshot = { status: "idle", hasPending: false, lastError: null, lastSavedAt: null };
const listeners = new Set<(s: AutosaveSnapshot) => void>();

function anyPending(): boolean {
  for (const slot of slots.values()) {
    if (slot.running || slot.pending) return true;
  }
  return false;
}

/** 派生全局快照：错误优先于 saving；lastError 取各 slot 中最近一次失败。 */
function deriveSnapshot(): AutosaveSnapshot {
  let newestError: string | null = null;
  let newestAt = -1;
  for (const slot of slots.values()) {
    if (slot.lastError && (slot.lastErrorAt ?? 0) >= newestAt) {
      newestError = slot.lastError;
      newestAt = slot.lastErrorAt ?? 0;
    }
  }
  const pending = anyPending();
  if (newestError) {
    return { status: "error", hasPending: pending, lastError: newestError, lastSavedAt };
  }
  if (pending) {
    return { status: "saving", hasPending: true, lastError: null, lastSavedAt };
  }
  if (lastSavedAt !== null) {
    return { status: "saved", hasPending: false, lastError: null, lastSavedAt };
  }
  return { status: "idle", hasPending: false, lastError: null, lastSavedAt: null };
}

function emitDerived(): void {
  snapshot = deriveSnapshot();
  for (const listener of listeners) listener(snapshot);
}

export function subscribeAutosave(listener: (s: AutosaveSnapshot) => void): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}

export function getAutosaveSnapshot(): AutosaveSnapshot {
  return snapshot;
}

/** restore 前调用：冻结 autosave，后续 schedule 一律跳过（调用方负责在 fire 前查 isAutosaveSuspended）。 */
export function suspendAutosave(): void {
  suspended = true;
}

/** 撤销失败、没走到 reload 时调用：解冻，让本页 autosave 恢复正常。 */
export function resumeAutosave(): void {
  suspended = false;
}

export function isAutosaveSuspended(): boolean {
  return suspended;
}

/** 是否还有未落盘改动（退出/返回前据此决定 flush + 等待）。 */
export function hasPendingAutosave(): boolean {
  return anyPending();
}

// App 注册的「立即把当前编辑刷盘」回调（切章/切书/回首页前，导航侧调用，绕过 350ms 防抖）。
let flusher: (() => Promise<AutosaveFlushResult>) | null = null;
export function setAutosaveFlusher(fn: (() => Promise<AutosaveFlushResult>) | null): void {
  flusher = fn;
}
/** 立刻把「当前未落盘的编辑」刷盘（导航离开前调用）；冻结期内不动。 */
export async function flushAutosaveNow(): Promise<AutosaveFlushResult> {
  if (suspended || !flusher) return { ok: true };
  try {
    return await flusher();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * 调度一次 autosave（按 key 串行、last-write-wins）。task 是「实际写盘」的异步函数（含 fetch PUT）。
 * 返回 resolve 于本 key 串行链排空的 promise。同一 key 在写时，新 task 覆盖待写槽（旧待写被丢弃）。
 */
export function scheduleAutosave(key: string, task: () => Promise<void>): Promise<AutosaveFlushResult> {
  let slot = slots.get(key);
  if (!slot) {
    slot = { running: false, pending: null, drain: null, lastError: null, lastErrorAt: null };
    slots.set(key, slot);
  }
  const s = slot;
  if (s.running) {
    s.pending = task; // last-write-wins：只保留最新一笔
    emitDerived();
    return s.drain ?? Promise.resolve({ ok: true });
  }
  s.drain = (async (): Promise<AutosaveFlushResult> => {
    s.running = true;
    try {
      let next: (() => Promise<void>) | null = task;
      while (next) {
        const current = next;
        next = null;
        // 开跑前清本 key 错误 → 若无其它 key 仍失败，状态回到 saving，供 Pill 退避链路再次触发
        s.lastError = null;
        s.lastErrorAt = null;
        emitDerived();
        try {
          await current();
          s.lastError = null;
          s.lastErrorAt = null;
          lastSavedAt = Date.now();
        } catch (error) {
          s.lastError = error instanceof Error ? error.message : String(error);
          s.lastErrorAt = Date.now();
        }
        emitDerived();
        next = s.pending;
        s.pending = null;
      }
      return s.lastError ? { ok: false, error: s.lastError } : { ok: true };
    } finally {
      s.running = false;
      s.drain = null;
      emitDerived();
    }
  })();
  return s.drain;
}

/** restore 前 await：等掉所有 key 的在途串行链（无则立即返回）；吞错（落盘失败不该阻断撤销）。 */
export function drainAutosave(): Promise<unknown> {
  const drains: Promise<AutosaveFlushResult>[] = [];
  for (const slot of slots.values()) {
    if (slot.drain) drains.push(slot.drain);
  }
  if (drains.length === 0) return Promise.resolve();
  return Promise.all(drains.map((d) => d.catch(() => undefined))).then(() => undefined, () => undefined);
}

/** 仅供单测：重置模块态。 */
export function __resetAutosaveControlForTest(): void {
  suspended = false;
  slots.clear();
  lastSavedAt = null;
  snapshot = { status: "idle", hasPending: false, lastError: null, lastSavedAt: null };
  listeners.clear();
  flusher = null;
}
