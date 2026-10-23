export const VERSION = 1;
export const PALETTE = ['#7254c8', '#126d96', '#9e511b', '#126f60', '#9a567e', '#627936'];
export const DEFAULT_SETTINGS = { focusMinutes: 25, breakMinutes: 5 };

export function createState() {
  return { version: VERSION, attractors: [], tasks: [], settings: { ...DEFAULT_SETTINGS }, selectedAttractorId: null, selectedTaskId: null, mode: 'focus', timer: null };
}

export function normalizeUrl(input) {
  const text = input.trim();
  if (!text || /\s/.test(text)) throw new Error('Enter a valid task link, without spaces.');
  // Recognize host:port without treating its hostname as a URI scheme.
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(text) && !/^[^/:]+:\d+(?:[/?#]|$)/.test(text);
  let url;
  try { url = new URL(hasScheme ? text : `https://${text}`); }
  catch { throw new Error('That link does not look quite right. Try a complete web address.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Use an http:// or https:// link.');
  if (!url.hostname || url.username || url.password) throw new Error('Use a web address without embedded login details.');
  // Ignore www only for grouping; removing it from the task link can break sites
  // that serve their content exclusively on that hostname.
  return { url: url.href, hostname: url.hostname.toLowerCase().replace(/^www\./, '') };
}

function createId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  // getRandomValues also works on a phone using a local HTTP development server.
  return [...crypto.getRandomValues(new Uint32Array(4))].map(value => value.toString(16).padStart(8, '0')).join('');
}

export function addTask(state, input, id = createId(), now = Date.now()) {
  const normalized = normalizeUrl(input);
  const existing = state.tasks.find(task => equivalentUrl(task.url) === equivalentUrl(normalized.url));
  if (existing) return { task: existing, duplicate: true };
  let attractor = state.attractors.find(item => item.hostname === normalized.hostname);
  if (!attractor) {
    attractor = { id: normalized.hostname, hostname: normalized.hostname, color: PALETTE[state.attractors.length % PALETTE.length] };
    state.attractors.push(attractor);
  }
  const task = { id, url: normalized.url, attractorId: attractor.id, status: 'pending', createdAt: now, completedAt: null };
  state.tasks.push(task);
  return { task, duplicate: false };
}

export function tasksFor(state, attractorId = state.selectedAttractorId, status = 'pending') {
  return state.tasks.filter(task => task.attractorId === attractorId && task.status === status);
}

export function isSessionActive(state) {
  return ['running', 'paused'].includes(state.timer?.status);
}

export function selectAttractor(state, id) {
  if (!state.attractors.some(item => item.id === id)) return false;
  state.selectedAttractorId = id;
  if (!isSessionActive(state)) {
    state.selectedTaskId = null;
    state.timer = null;
    state.mode = 'focus';
  }
  return true;
}

export function drawTask(state, random = Math.random) {
  if (isSessionActive(state)) return null;
  const candidates = tasksFor(state).filter(task => task.lifecycle !== 'reopened' && !task.capturePending);
  if (!candidates.length) return null;
  const weights = candidates.map(task => taskWeight(task, state.priorityAlpha ?? 1));
  let remaining = random() * weights.reduce((sum, weight) => sum + weight, 0);
  const task = candidates.find((_, index) => (remaining -= weights[index]) < 0) ?? candidates.at(-1);
  state.selectedTaskId = task.id;
  state.timer = null;
  state.mode = 'focus';
  return task;
}

export function completeTask(state, id, now = Date.now()) {
  const task = state.tasks.find(item => item.id === id);
  if (!task || task.status === 'done') return false;
  task.status = 'done';
  task.completedAt = now;
  if (task.lifecycle) task.lifecycle = 'completed';
  clearTaskSelection(state, id);
  return true;
}

function clearTaskSelection(state, id) {
  if (state.timer?.taskId === id) state.timer = null;
  if (state.selectedTaskId === id) {
    state.selectedTaskId = null;
    state.mode = 'focus';
  }
}

export function reopenTask(state, id) {
  const task = state.tasks.find(item => item.id === id);
  if (!task) return false;
  task.status = 'pending';
  task.completedAt = null;
  if (task.lifecycle) task.lifecycle = 'attracted';
  return true;
}

export function deleteTask(state, id) {
  if (isSessionActive(state) && state.timer.taskId === id) return false;
  const index = state.tasks.findIndex(item => item.id === id);
  if (index === -1) return false;
  clearTaskSelection(state, id);
  state.tasks.splice(index, 1);
  return true;
}

export function deleteAttractor(state, id) {
  if (!state.attractors.some(item => item.id === id)) return false;
  const ids = new Set(state.tasks.filter(task => task.attractorId === id).map(task => task.id));
  if (ids.has(state.timer?.taskId)) state.timer = null;
  if (ids.has(state.selectedTaskId)) { state.selectedTaskId = null; state.mode = 'focus'; }
  state.tasks = state.tasks.filter(task => task.attractorId !== id);
  state.attractors = state.attractors.filter(item => item.id !== id);
  if (state.selectedAttractorId === id) state.selectedAttractorId = state.attractors[0]?.id ?? null;
  return true;
}

export function validMinutes(value) {
  return Number.isSafeInteger(value) && value > 0 && Number.isSafeInteger(value * 60_000 + Date.now());
}

export function setSettings(state, focusMinutes, breakMinutes) {
  if (!validMinutes(focusMinutes) || !validMinutes(breakMinutes)) throw new Error('Use positive whole numbers for both durations.');
  state.settings = { focusMinutes, breakMinutes };
}

export function changeMode(state, mode) {
  if (isSessionActive(state) || !['focus', 'break'].includes(mode)) return false;
  state.mode = mode;
  state.timer = null;
  return true;
}

export function startTimer(state, now = Date.now()) {
  if (isSessionActive(state)) return false;
  const task = state.tasks.find(item => item.id === state.selectedTaskId && item.status === 'pending');
  if (state.mode === 'focus' && !task) return false;
  const durationMs = state.settings[state.mode === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60_000;
  state.timer = { taskId: task?.id ?? null, phase: state.mode, status: 'running', durationMs, remainingMs: durationMs, endAt: now + durationMs };
  return true;
}

export function remainingTime(state, now = Date.now()) {
  if (!state.timer) return state.settings[state.mode === 'focus' ? 'focusMinutes' : 'breakMinutes'] * 60_000;
  return state.timer.status === 'running' ? Math.max(0, state.timer.endAt - now) : state.timer.remainingMs;
}

export function tickTimer(state, now = Date.now()) {
  if (state.timer?.status !== 'running' || remainingTime(state, now) > 0) return false;
  state.timer.status = 'finished';
  state.timer.remainingMs = 0;
  state.timer.endAt = null;
  return true;
}

export function pauseTimer(state, now = Date.now()) {
  if (state.timer?.status !== 'running') return false;
  if (tickTimer(state, now)) return true;
  state.timer.remainingMs = remainingTime(state, now);
  state.timer.endAt = null;
  state.timer.status = 'paused';
  return true;
}

export function resumeTimer(state, now = Date.now()) {
  if (state.timer?.status !== 'paused') return false;
  state.timer.endAt = now + state.timer.remainingMs;
  state.timer.status = 'running';
  return true;
}

export function endTimer(state) { state.timer = null; }

export function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

export function taskLabel(url) {
  const parsed = new URL(url);
  if (parsed.pathname === '/' && !parsed.search && !parsed.hash) return parsed.hostname;
  let label = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  try { label = decodeURI(label); } catch { /* A URL can contain a literal percent sign. */ }
  return label.replace(/^\//, '') || parsed.hostname;
}

// Strip only known tracking parameters; keep fragments, ordering, and content IDs.
export function equivalentUrl(input) {
  const url = new URL(normalizeUrl(input).url);
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ['fbclid', 'gclid'].includes(key)) url.searchParams.delete(key);
  }
  return url.href;
}

export function taskWeight(task, alpha = 1) {
  return 1 + Math.max(0, alpha) * Math.log2(1 + Math.max(0, task.reopenCount ?? 0));
}
