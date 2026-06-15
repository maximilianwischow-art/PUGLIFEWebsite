/**
 * lib/sync/runner.mjs
 *
 * Background sync framework for the canonical user database. Each task is a
 * pure async function `() => Promise<{ rowsChanged?: number }>` registered
 * by `server.js` at startup. The runner schedules them, enforces single-
 * flight, persists status to `sync_state`, and exposes a manual trigger.
 *
 * Tasks should be idempotent — re-running is always safe. On error, the
 * previous materialised rows stay in place; the next read still sees the
 * last good data.
 *
 * Read access throughout the app is from the materialised tables; the
 * sync workers are the *only* writers. The compute that produces those
 * rows continues to live in `server.js` / `lib/compute/` so live and
 * background paths share one implementation.
 */

import {
  syncStateGet,
  syncStateGetAll,
  syncStateMarkRunning,
  syncStateMarkComplete,
  syncStateMarkFailed,
} from "../item-needs-db.mjs";

/** @typedef {{ rowsChanged?: number }} SyncResult */
/** @typedef {() => Promise<SyncResult|void>} SyncTaskFn */

/**
 * @typedef {{
 *   id: string,
 *   intervalMs: number,
 *   description?: string,
 *   /** When false, task is manual-only (admin trigger); excluded from scheduler and sync-all. */
 *   autoSchedule?: boolean,
 *   run: SyncTaskFn,
 * }} SyncTaskDefinition
 */

/** @type {Map<string, SyncTaskDefinition>} */
const tasks = new Map();
/** @type {Map<string, Promise<SyncResult>>} */
const inflight = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const timers = new Map();
let started = false;

/** Register a sync task. Idempotent on `taskId`. */
export function registerSyncTask(definition) {
  const id = String(definition?.id || "").trim();
  if (!id) throw new Error("registerSyncTask: id is required");
  if (typeof definition?.run !== "function") {
    throw new Error(`registerSyncTask(${id}): run must be a function`);
  }
  const intervalMs = Math.max(60_000, Math.floor(Number(definition.intervalMs) || 0));
  tasks.set(id, {
    id,
    intervalMs,
    description: definition.description ? String(definition.description) : "",
    autoSchedule: definition.autoSchedule !== false,
    run: definition.run,
  });
}

/** True when a task is currently running. */
export function isSyncTaskRunning(taskId) {
  return inflight.has(String(taskId || "").trim());
}

/**
 * Run one task NOW. Single-flight: concurrent calls return the in-progress
 * promise. Use `force: true` to bypass the 5s "just started" guard if the
 * task wedged.
 */
export async function runSyncTaskNow(taskId, { force = false } = {}) {
  const id = String(taskId || "").trim();
  const def = tasks.get(id);
  if (!def) throw new Error(`runSyncTaskNow: unknown task '${id}'`);
  const existing = inflight.get(id);
  if (existing && !force) return existing;

  const runPromise = (async () => {
    const startedAt = Date.now();
    try {
      syncStateMarkRunning(id);
      const result = (await def.run()) || {};
      const durationMs = Date.now() - startedAt;
      const rowsChanged = Math.max(0, Math.floor(Number(result?.rowsChanged) || 0));
      const nextDueAt = Date.now() + def.intervalMs;
      syncStateMarkComplete({ taskId: id, durationMs, rowsChanged, nextDueAt });
      return { rowsChanged, durationMs };
    } catch (error) {
      const nextDueAt = Date.now() + Math.max(60_000, def.intervalMs / 2);
      syncStateMarkFailed({
        taskId: id,
        error: error?.stack || error?.message || String(error),
        nextDueAt,
      });
      throw error;
    } finally {
      inflight.delete(id);
    }
  })();

  inflight.set(id, runPromise);
  return runPromise;
}

/**
 * Decide whether a task is overdue based on its `last_completed_at` and
 * configured interval. Used for cold-boot kick and the periodic check.
 */
function isTaskOverdue(taskId, intervalMs) {
  const state = syncStateGet(taskId);
  if (!state) return true;
  if (state.status === "running") return false;
  if (!state.lastCompletedAt) return true;
  const elapsed = Date.now() - Number(state.lastCompletedAt || 0);
  return elapsed >= intervalMs;
}

/**
 * Start the scheduler. Each task gets a `setInterval` at its configured
 * cadence and a one-shot kick if it's overdue at startup. Safe to call
 * multiple times — only the first call starts timers.
 */
export function startSyncRunner({ staggerMs = 5000 } = {}) {
  if (started) return;
  started = true;

  const taskList = [...tasks.values()].filter((def) => def.autoSchedule !== false);
  taskList.forEach((def, idx) => {
    const tick = () => {
      if (inflight.has(def.id)) return; // single-flight; next tick will retry
      if (!isTaskOverdue(def.id, def.intervalMs)) return;
      runSyncTaskNow(def.id).catch((error) => {
        console.warn(`[sync] task '${def.id}' failed:`, error?.message || error);
      });
    };

    const handle = setInterval(tick, Math.min(def.intervalMs, 5 * 60_000));
    if (handle && typeof handle.unref === "function") handle.unref();
    timers.set(def.id, handle);

    setTimeout(() => {
      tick();
    }, idx * staggerMs).unref?.();
  });
}

/** Stop all timers (used by tests / hot-reload). */
export function stopSyncRunner() {
  for (const handle of timers.values()) clearInterval(handle);
  timers.clear();
  started = false;
}

/** List configured tasks (for the admin UI). */
export function listSyncTasks({ includeManualOnly = true } = {}) {
  return [...tasks.values()]
    .filter((def) => includeManualOnly || def.autoSchedule !== false)
    .map((def) => ({
      id: def.id,
      intervalMs: def.intervalMs,
      description: def.description,
      autoSchedule: def.autoSchedule !== false,
    }));
}

/** Snapshot of every task's runtime state for the admin observability view. */
export function syncRunnerSnapshot() {
  const states = new Map(syncStateGetAll().map((row) => [row.taskId, row]));
  return [...tasks.values()].map((def) => {
    const state = states.get(def.id) || null;
    return {
      id: def.id,
      description: def.description,
      intervalMs: def.intervalMs,
      autoSchedule: def.autoSchedule !== false,
      running: inflight.has(def.id),
      status: state?.status || "idle",
      lastStartedAt: state?.lastStartedAt || null,
      lastCompletedAt: state?.lastCompletedAt || null,
      lastDurationMs: state?.lastDurationMs || null,
      lastError: state?.lastError || null,
      nextDueAt: state?.nextDueAt || null,
      rowsChanged: state?.rowsChanged || 0,
    };
  });
}
