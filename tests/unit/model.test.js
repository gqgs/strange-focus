import test from 'node:test';
import assert from 'node:assert/strict';
import { addTask, changeMode, completeTask, createState, deleteTask, drawTask, endTimer, formatTime, isSessionActive, normalizeUrl, pauseTimer, remainingTime, reopenTask, resumeTimer, selectAttractor, setSettings, startTimer, tasksFor, tickTimer } from '../../src/model.js';
import { createStorage, isValidState, STORAGE_KEY } from '../../src/storage.js';

function workspace() {
  const state = createState();
  addTask(state, 'https://github.com/acme/project/issues/1', 'a', 1000);
  addTask(state, 'https://github.com/acme/project/issues/2', 'b', 1001);
  addTask(state, 'https://docs.google.com/document/d/abc', 'c', 1002);
  selectAttractor(state, 'github.com');
  return state;
}
function memoryStorage(initial = null) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]]);
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}

test('canonical URLs preserve path, query and fragment while normalizing hostname and ports', () => {
  assert.deepEqual(normalizeUrl('  HTTPS://WWW.Example.COM:443/a?b=2#here  '), { url: 'https://www.example.com/a?b=2#here', hostname: 'example.com' });
  assert.equal(normalizeUrl('example.com/work').url, 'https://example.com/work');
  assert.equal(normalizeUrl('localhost:5173/work').hostname, 'localhost');
  assert.equal(normalizeUrl('https://example.com:8080/work').hostname, 'example.com');
});

test('reject malformed and non-web URLs', () => {
  for (const value of ['', 'not a link', 'https://', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/task', 'ftp://example.com', 'https://user:password@example.com']) assert.throws(() => normalizeUrl(value));
});

test('subdomains remain separate, www collapses, duplicate task is not added', () => {
  const state = createState();
  addTask(state, 'www.google.com', 'a');
  const duplicate = addTask(state, 'https://WWW.GOOGLE.com:443/', 'b');
  addTask(state, 'google.com/work', 'e');
  addTask(state, 'docs.google.com', 'c');
  addTask(state, 'drive.google.com', 'd');
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.task.id, 'a');
  assert.equal(state.tasks.length, 4);
  assert.deepEqual(state.attractors.map(item => item.hostname), ['google.com', 'docs.google.com', 'drive.google.com']);
  assert.equal(new Set(state.attractors.map(item => item.color)).size, 3);
});

test('uniform draw partitions random range across pending tasks in chosen attractor', () => {
  const state = workspace();
  assert.equal(drawTask(state, () => 0).id, 'a');
  assert.equal(drawTask(state, () => 0.499999).id, 'a');
  assert.equal(drawTask(state, () => 0.5).id, 'b');
  assert.equal(drawTask(state, () => 0.999999).id, 'b');
  completeTask(state, 'a');
  assert.equal(drawTask(state, () => 0).id, 'b');
  completeTask(state, 'b');
  assert.equal(drawTask(state), null);
  assert.equal(state.tasks.find(task => task.id === 'c').status, 'pending');
});

test('completed tasks are retained, deduplicated and can be reopened', () => {
  const state = workspace();
  completeTask(state, 'a', 12345);
  assert.equal(tasksFor(state, 'github.com', 'done')[0].completedAt, 12345);
  assert.equal(addTask(state, 'github.com/acme/project/issues/1').duplicate, true);
  reopenTask(state, 'a');
  assert.equal(tasksFor(state).length, 2);
  assert.equal(state.tasks[0].completedAt, null);
});

test('focus requires a selected task; breaks can start independently', () => {
  const state = createState();
  assert.equal(startTimer(state, 1000), false);
  changeMode(state, 'break');
  assert.equal(startTimer(state, 1000), true);
  assert.equal(state.timer.taskId, null);
  assert.equal(isValidState(state), true);
});

test('active and paused sessions pin task even when browsing another attractor', () => {
  const state = workspace();
  drawTask(state, () => 0);
  startTimer(state, 1000);
  selectAttractor(state, 'docs.google.com');
  assert.equal(state.selectedTaskId, 'a');
  assert.equal(drawTask(state), null);
  assert.equal(changeMode(state, 'break'), false);
  assert.equal(deleteTask(state, 'a'), false);
  pauseTimer(state, 2000);
  assert.equal(drawTask(state), null);
  assert.equal(isValidState(state), true);
  endTimer(state);
  assert.equal(drawTask(state).id, 'c');
  assert.equal(state.tasks.find(task => task.id === 'a').status, 'pending');
});

test('pause/resume preserve elapsed time; clock jumps finish once without completing task', () => {
  const state = workspace();
  drawTask(state, () => 0);
  setSettings(state, 1, 2);
  startTimer(state, 1000);
  assert.equal(remainingTime(state, 16_000), 45_000);
  pauseTimer(state, 16_000);
  assert.equal(remainingTime(state, 999_999), 45_000);
  resumeTimer(state, 100_000);
  assert.equal(state.timer.endAt, 145_000);
  assert.equal(tickTimer(state, 144_999), false);
  assert.equal(tickTimer(state, 145_000), true);
  assert.equal(tickTimer(state, 999_999), false);
  assert.equal(state.timer.status, 'finished');
  assert.equal(state.timer.phase, 'focus');
  assert.equal(state.tasks[0].status, 'pending');
  assert.equal(isSessionActive(state), false);
  assert.equal(isValidState(state), true);
});

test('duration changes apply only to the next session', () => {
  const state = workspace();
  drawTask(state, () => 0);
  startTimer(state, 0);
  setSettings(state, 10, 3);
  assert.equal(remainingTime(state, 1000), 25 * 60_000 - 1000);
  endTimer(state);
  startTimer(state, 1000);
  assert.equal(state.timer.durationMs, 10 * 60_000);
  for (const value of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) assert.throws(() => setSettings(state, value, 5));
});

test('completing the pinned task ends its session; other task completion does not', () => {
  const state = workspace();
  drawTask(state, () => 0);
  startTimer(state, 1000);
  completeTask(state, 'b');
  assert.equal(isSessionActive(state), true);
  completeTask(state, 'a');
  assert.equal(state.timer, null);
  assert.equal(state.selectedTaskId, null);
  assert.equal(isValidState(state), true);
});

test('task deletion clears its selection and retains empty domain/color', () => {
  const state = workspace();
  selectAttractor(state, 'docs.google.com');
  drawTask(state);
  const color = state.attractors[1].color;
  assert.equal(deleteTask(state, 'c'), true);
  assert.equal(state.selectedTaskId, null);
  assert.equal(tasksFor(state).length, 0);
  assert.equal(state.attractors[1].color, color);
  assert.equal(isValidState(state), true);
});

test('clock formatting rounds up without showing negative or early zero seconds', () => {
  assert.equal(formatTime(60_000), '01:00');
  assert.equal(formatTime(1), '00:01');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(90 * 60_000), '90:00');
});

test('storage round trip restores domains, status, settings and a running deadline', () => {
  const state = workspace();
  completeTask(state, 'b');
  drawTask(state);
  setSettings(state, 17, 4);
  startTimer(state, 1000);
  const backend = memoryStorage();
  const storage = createStorage(() => backend);
  assert.equal(storage.save(state), null);
  const restored = createStorage(() => backend).load();
  assert.equal(restored.issue, null);
  assert.deepEqual(restored.state, state);
  assert.equal(remainingTime(restored.state, 11_000), 17 * 60_000 - 10_000);
  assert.equal(tickTimer(restored.state, 2_000_000), true);
  assert.equal(restored.state.tasks[0].status, 'pending');
});

test('paused session restores with frozen remaining time', () => {
  const state = workspace();
  drawTask(state);
  startTimer(state, 1000);
  pauseTimer(state, 31_000);
  const restored = createStorage(() => memoryStorage(JSON.stringify(state))).load();
  assert.equal(restored.issue, null);
  assert.equal(remainingTime(restored.state, 9_000_000), 24.5 * 60_000);
});

test('corrupt or incompatible saved data is preserved until explicit reset', () => {
  for (const raw of ['{bad', 'null', JSON.stringify({ ...createState(), version: 999 })]) {
    const backend = memoryStorage(raw);
    const storage = createStorage(() => backend);
    assert.ok(storage.load().issue);
    assert.ok(storage.save(workspace()));
    assert.equal(backend.getItem(STORAGE_KEY), raw);
    assert.equal(storage.reset(), null);
    assert.equal(storage.save(workspace()), null);
    assert.equal(JSON.parse(backend.getItem(STORAGE_KEY)).tasks.length, 3);
  }
});

test('unavailable and full storage return warnings without losing memory state', () => {
  const denied = createStorage(() => { throw new Error('denied'); });
  assert.ok(denied.load().issue);
  assert.ok(denied.save(workspace()));
  assert.ok(denied.reset());
  const full = createStorage(() => ({ getItem: () => null, setItem: () => { throw new Error('quota'); } }));
  assert.equal(full.load().issue, null);
  assert.ok(full.save(workspace()));
});

test('saved state rejects unsafe URLs, dangling IDs, duplicate tasks and invalid timers', () => {
  const cases = [
    state => { state.tasks[0].url = 'javascript:alert(1)'; },
    state => { state.selectedAttractorId = 'missing'; },
    state => { state.selectedTaskId = 'missing'; },
    state => { state.tasks.push({ ...state.tasks[0] }); },
    state => { state.tasks[0].attractorId = 'docs.google.com'; },
    state => { state.attractors[0].color = 'url(https://example.com)'; },
    state => { state.settings.focusMinutes = -1; },
    state => { state.timer = { phase: 'focus', status: 'running', durationMs: 1000, remainingMs: 1000, endAt: 1000, taskId: null }; },
  ];
  for (const mutate of cases) { const state = workspace(); mutate(state); assert.equal(isValidState(state), false); }
});
