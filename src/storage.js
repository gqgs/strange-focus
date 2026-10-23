import { createState, normalizeUrl, validMinutes, VERSION } from './model.js';

export const STORAGE_KEY = 'strange-focus:v1';
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const timestamp = value => Number.isFinite(value) && value >= 0;

export function isValidState(state) {
  if (!object(state) || state.version !== VERSION || !Array.isArray(state.attractors) || !Array.isArray(state.tasks)) return false;
  if (!object(state.settings) || !validMinutes(state.settings.focusMinutes) || !validMinutes(state.settings.breakMinutes)) return false;
  if (!['focus', 'break'].includes(state.mode)) return false;
  if (state.theme !== undefined && !['light', 'dark'].includes(state.theme)) return false;
  if (state.sidebarCollapsed !== undefined && typeof state.sidebarCollapsed !== 'boolean') return false;
  if (state.priorityAlpha !== undefined && (!Number.isFinite(state.priorityAlpha) || state.priorityAlpha < 0 || state.priorityAlpha > 100)) return false;
  const domains = new Set();
  for (const item of state.attractors) {
    if (!object(item) || typeof item.hostname !== 'string' || item.id !== item.hostname || domains.has(item.id) || !/^#[\da-f]{6}$/i.test(item.color)) return false;
    if (item.faviconChecked !== undefined && typeof item.faviconChecked !== 'boolean') return false;
    if (item.customColor != null && !/^#[\da-f]{6}$/i.test(item.customColor)) return false;
    try { if (normalizeUrl(`https://${item.hostname}`).hostname !== item.hostname) return false; } catch { return false; }
    domains.add(item.id);
  }
  const ids = new Set();
  const urls = new Set();
  for (const task of state.tasks) {
    if (!object(task) || typeof task.id !== 'string' || !task.id || ids.has(task.id) || typeof task.url !== 'string' || urls.has(task.url) || !domains.has(task.attractorId)) return false;
    if (!['pending', 'done'].includes(task.status) || !timestamp(task.createdAt)) return false;
    if (task.lifecycle !== undefined && !['attracted', 'reopened', 'completed'].includes(task.lifecycle)) return false;
    if (task.capturePending !== undefined && typeof task.capturePending !== 'boolean') return false;
    if (task.lifecycle && ((task.status === 'done') !== (task.lifecycle === 'completed'))) return false;
    if (task.reopenCount !== undefined && (!Number.isSafeInteger(task.reopenCount) || task.reopenCount < 0)) return false;
    if (task.history !== undefined && (!Array.isArray(task.history) || task.history.some(event => !object(event) || !timestamp(event.at) || typeof event.type !== 'string'))) return false;
    if (task.title !== undefined && typeof task.title !== 'string') return false;
    if (task.favIconUrl !== undefined && typeof task.favIconUrl !== 'string') return false;
    if (task.status === 'pending' ? task.completedAt !== null : !timestamp(task.completedAt)) return false;
    try {
      const normalized = normalizeUrl(task.url);
      if (normalized.url !== task.url || normalized.hostname !== task.attractorId) return false;
    } catch { return false; }
    ids.add(task.id);
    urls.add(task.url);
  }
  if (state.selectedAttractorId !== null && !domains.has(state.selectedAttractorId)) return false;
  if (state.selectedTaskId !== null && !state.tasks.some(task => task.id === state.selectedTaskId && task.status === 'pending')) return false;
  if (state.timer !== null) {
    const timer = state.timer;
    if (!object(timer) || timer.phase !== state.mode || !['running', 'paused', 'finished'].includes(timer.status)) return false;
    if (!Number.isFinite(timer.durationMs) || timer.durationMs <= 0 || !timestamp(timer.remainingMs) || timer.remainingMs > timer.durationMs) return false;
    if (timer.taskId !== state.selectedTaskId || (timer.phase === 'focus' && timer.taskId === null)) return false;
    if (timer.status === 'running' ? !timestamp(timer.endAt) : timer.endAt !== null) return false;
    if (timer.status === 'finished' && timer.remainingMs !== 0) return false;
  }
  return true;
}

// A failed read blocks writes until an explicit reset, preserving the original data.
export function createStorage(getStorage = () => window.localStorage) {
  let blocked = false;
  let issue = null;
  const unavailable = 'Browser storage is unavailable. You can keep working, but changes will not survive a reload.';
  return {
    load() {
      let raw;
      try { raw = getStorage().getItem(STORAGE_KEY); }
      catch { blocked = true; issue = unavailable; return { state: createState(), issue }; }
      if (raw === null) return { state: createState(), issue: null };
      try {
        const state = JSON.parse(raw);
        if (!isValidState(state)) throw new Error('Invalid saved state');
        return { state, issue: null };
      } catch {
        blocked = true;
        issue = 'Saved data could not be read. It has been preserved. This session is temporary until you reset saved data.';
        return { state: createState(), issue };
      }
    },
    save(state) {
      if (blocked) return issue;
      try { getStorage().setItem(STORAGE_KEY, JSON.stringify(state)); return null; }
      catch { blocked = true; issue = unavailable; return issue; }
    },
    reset() {
      try { getStorage().removeItem(STORAGE_KEY); blocked = false; issue = null; return null; }
      catch { issue = unavailable; return issue; }
    },
  };
}
