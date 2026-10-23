import { PALETTE, addTask, changeMode, completeTask, createState, deleteTask, drawTask, endTimer, formatTime, isSessionActive, pauseTimer, remainingTime, reopenTask, resumeTimer, selectAttractor, setSettings, startTimer, taskLabel, tasksFor, tickTimer } from './model.js';
import { createStorage } from './storage.js';
import { createAttractor, clearAttractorAnimations } from './attractor.js';
import { deleteAttractor } from './model.js';
import { faviconColor, readableColor } from './colors.js';

const $ = id => document.getElementById(id);
const extension = location.protocol === 'chrome-extension:' ? await import('../extension/client.js') : null;
const storage = extension ? extension.extensionStorage() : createStorage();
const loaded = await storage.load();
let state = loaded.state;
let tab = 'pending';
let duplicateId = null;
let toastTimeout;
const colorRequests = new Set();
const systemTheme = matchMedia('(prefers-color-scheme: dark)');
let editingAttractorId = null;
const activeTheme = () => state.theme ?? (systemTheme.matches ? 'dark' : 'light');
const accentColor = attractor => readableColor(attractor?.customColor ?? attractor?.color ?? PALETTE[0], activeTheme());

function renderTheme() {
  const dark = activeTheme() === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#141722' : '#fafbfc';
  $('theme-toggle').setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  $('theme-label').textContent = dark ? 'Light' : 'Dark';
  $('theme-icon').textContent = dark ? '☀' : '☾';
}
$('theme-toggle').addEventListener('click', () => { state.theme = activeTheme() === 'dark' ? 'light' : 'dark'; commit(); });
systemTheme.addEventListener('change', () => { if (!state.theme) render(); });

function scheduleFaviconColors() {
  for (const attractor of state.attractors) {
    if (colorRequests.size >= 2) break;
    if (attractor.faviconChecked || colorRequests.has(attractor)) continue;
    const task = state.tasks.find(item => item.attractorId === attractor.id);
    if (!task) continue;
    colorRequests.add(attractor);
    faviconColor(task.url).then(color => {
      if (!state.attractors.includes(attractor) || attractor.faviconChecked) return;
      attractor.faviconChecked = true;
      if (color) attractor.color = color;
      persist();
      render();
    }).finally(() => { colorRequests.delete(attractor); scheduleFaviconColors(); });
  }
}

function announce(message) {
  $('announcement').textContent = '';
  window.setTimeout(() => { $('announcement').textContent = message; }, 30);
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => { $('toast').hidden = true; }, 4000);
}

function showStorageIssue(issue) {
  $('storage-warning').hidden = !issue;
  $('reset-storage').hidden = Boolean(extension);
  $('storage-message').textContent = issue ?? '';
  document.querySelector('.local-badge').classList.toggle('unsaved', Boolean(issue));
  document.querySelector('.local-badge').lastChild.textContent = issue ? ' Temporary session' : ' Saved in this browser';
}

async function persist() { showStorageIssue(await storage.save(state)); }
function commit(message) { persist(); render(); if (message) announce(message); }

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderAttractors() {
  $('attractor-count').textContent = state.attractors.length;
  $('empty-attractors').hidden = state.attractors.length > 0;
  const cards = state.attractors.map(attractor => {
    const selected = attractor.id === state.selectedAttractorId;
    const button = el('button', `attractor-card${selected ? ' selected' : ''}`);
    button.type = 'button';
    button.style.setProperty('--attractor-color', accentColor(attractor));
    button.dataset.attractorId = attractor.id;
    button.dataset.focusKey = `attractor:${attractor.id}`;
    button.setAttribute('aria-pressed', String(selected));
    button.setAttribute('aria-label', `${attractor.hostname}, ${tasksFor(state, attractor.id).length} pending tasks`);
    const top = el('span', 'attractor-top');
    top.append(el('span', 'domain-dot'), el('span', 'attractor-domain', attractor.hostname));
    const art = el('span', 'attractor-art');
    art.append(createAttractor(accentColor(attractor), { tasks: tasksFor(state, attractor.id), selectedTaskId: state.selectedTaskId }));
    const meta = el('span', 'attractor-meta');
    meta.append(el('span', '', `${tasksFor(state, attractor.id).length} to do`), el('span', '', `${tasksFor(state, attractor.id, 'done').length} done`));
    button.append(top, art, meta);
    const wrapper = el('div', 'attractor-entry');
    const options = el('button', 'icon-button attractor-options', '⋯');
    options.type = 'button'; options.dataset.settingsId = attractor.id;
    options.dataset.focusKey = `settings:${attractor.id}`;
    options.setAttribute('aria-label', `Settings for ${attractor.hostname}`);
    options.setAttribute('aria-haspopup', 'dialog');
    options.title = 'Attractor settings';
    wrapper.append(button, options);
    return wrapper;
  });
  $('attractor-list').replaceChildren(...cards);
}

function renderFocus() {
  const task = state.tasks.find(item => item.id === state.selectedTaskId);
  const attractor = state.attractors.find(item => item.id === (task?.attractorId ?? state.selectedAttractorId));
  const candidates = tasksFor(state).filter(task => task.lifecycle !== 'reopened' && !task.capturePending);
  const active = isSessionActive(state);
  document.querySelector('.focus-card').classList.toggle('has-task', Boolean(task));
  document.querySelector('.focus-card').style.setProperty('--focus-color', accentColor(attractor));
  const orbitTasks = attractor ? tasksFor(state, attractor.id) : [];
  $('focus-art').replaceChildren(createAttractor(accentColor(attractor), { detail: true, tasks: orbitTasks, selectedTaskId: task?.id }), el('span', 'orbit-caption', orbitTasks.length > 60 ? `60 of ${orbitTasks.length} pending tasks shown` : orbitTasks.length ? 'One dot per pending task' : 'Your tasks will find their orbit here'));
  $('focus-tag').textContent = active ? 'Session in progress' : task ? 'A little serendipity' : attractor ? `${candidates.length} possibilities` : 'A moment of possibility';
  $('focus-domain').textContent = task ? attractor.hostname : attractor ? attractor.hostname : 'LET CHANCE TAKE THE LEAD';
  $('focus-title').textContent = task ? (task.title || taskLabel(task.url)) : candidates.length ? 'One less decision to make.' : attractor ? 'A little breathing room.' : 'Your next focus is waiting.';
  $('focus-description').textContent = task ? task.url : candidates.length ? 'Pick a task at random. Give one thing your attention.' : attractor ? 'No pending tasks here. Add a link or reopen a completed task.' : 'Add a task link, choose its attractor, and find a place to begin.';
  $('open-task').hidden = !task;
  if (task) $('open-task').href = task.url; else $('open-task').removeAttribute('href');
  $('complete-task').hidden = !task;
  $('draw-task').disabled = active || !candidates.length;
  $('draw-label').textContent = task ? 'Pick again' : 'Pick a task';
  $('draw-help').textContent = active ? 'End this session before picking another task.' : candidates.length ? `${extension ? 'Priority-weighted draw.' : 'Equal chances.'} ${candidates.length} pending ${candidates.length === 1 ? 'task' : 'tasks'}. No overthinking.` : 'One small step is all it takes.';
}

function renderTimer() {
  const timer = state.timer;
  const active = isSessionActive(state);
  const remaining = remainingTime(state);
  const isBreak = state.mode === 'break';
  const finished = timer?.status === 'finished';
  $('mode-focus').setAttribute('aria-pressed', String(!isBreak));
  $('mode-break').setAttribute('aria-pressed', String(isBreak));
  $('mode-focus').disabled = active;
  $('mode-break').disabled = active;
  $('timer-value').textContent = formatTime(remaining);
  $('timer-value').setAttribute('aria-label', `${Math.floor(Math.ceil(remaining / 1000) / 60)} minutes ${Math.ceil(remaining / 1000) % 60} seconds remaining`);
  $('timer-caption').textContent = timer?.status === 'running' ? isBreak ? 'TAKE A BREATH' : 'ONE THING AT A TIME' : timer?.status === 'paused' ? 'PAUSED · TAKE YOUR TIME' : finished ? isBreak ? 'READY FOR A FRESH START' : 'A LITTLE PROGRESS, MADE' : 'READY WHEN YOU ARE';
  $('timer-ring').style.strokeDashoffset = String(100 * (1 - remaining / ((timer?.durationMs ?? remaining) || 1)));
  document.querySelector('.timer-card').classList.toggle('is-break', isBreak);
  $('timer-toggle').disabled = !isBreak && !state.selectedTaskId;
  $('timer-toggle').textContent = timer?.status === 'running' ? 'Pause session' : timer?.status === 'paused' ? 'Resume session' : finished && !isBreak ? 'Start short break →' : finished && isBreak ? 'Back to focus →' : isBreak ? 'Start short break →' : 'Start focus →';
  $('timer-end').hidden = !active;
  $('timer-help').textContent = active ? (isBreak ? 'Step away. Your tasks can wait.' : 'Your task is held until this session ends.') : finished ? (isBreak ? 'Choose your next small step when you’re ready.' : 'Time is up. Mark your task done, or take a break.') : isBreak ? 'Rest is part of the rhythm.' : state.selectedTaskId ? 'A quiet window for your next small step.' : 'Pick a task to give it your full attention.';
  document.title = active ? `${formatTime(remaining)} · ${timer.status === 'paused' ? 'Paused' : isBreak ? 'Break' : 'Focus'} — Strange Focus` : 'Strange Focus — Find your flow';
}

function renderTasks() {
  const attractor = state.attractors.find(item => item.id === state.selectedAttractorId);
  const tasks = tasksFor(state, state.selectedAttractorId, tab);
  $('tasks-domain').textContent = attractor?.hostname ?? 'A HOME FOR YOUR TASKS';
  $('tasks-heading').textContent = attractor ? 'In this attractor' : 'Task collection';
  $('pending-count').textContent = tasksFor(state).length;
  $('done-count').textContent = tasksFor(state, state.selectedAttractorId, 'done').length;
  $('tab-pending').setAttribute('aria-pressed', String(tab === 'pending'));
  $('tab-done').setAttribute('aria-pressed', String(tab === 'done'));
  const rows = tasks.map(task => {
    const label = task.title || taskLabel(task.url);
    const row = el('div', `task-row${task.id === state.selectedTaskId ? ' current' : ''}`);
    row.dataset.taskId = task.id;
    const statusButton = el('button', `task-status icon-button${tab === 'done' ? ' completed' : ''}`, tab === 'done' ? '↶' : '✓');
    statusButton.type = 'button';
    statusButton.dataset.action = tab === 'done' ? 'reopen' : 'complete';
    statusButton.dataset.focusKey = `status:${task.id}`;
    statusButton.setAttribute('aria-label', `${tab === 'done' ? 'Reopen' : 'Complete'} ${label}`);
    statusButton.title = tab === 'done' ? 'Reopen task' : 'Mark done';
    const text = el('div', 'task-text');
    const link = el('a', 'task-link', label);
    link.href = task.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
    link.title = task.url;
    link.dataset.focusKey = `link:${task.id}`;
    text.append(link, el('span', 'task-url', task.url));
    const actions = el('div', 'task-row-actions');
    if (task.lifecycle === 'reopened') actions.append(el('span', 'current-badge', 'Open in browser'));
    if (task.id === state.selectedTaskId) actions.append(el('span', 'current-badge', 'In focus'));
    const remove = el('button', 'icon-button delete-task');
    remove.type = 'button'; remove.dataset.action = 'delete';
    remove.dataset.focusKey = `delete:${task.id}`;
    remove.setAttribute('aria-label', `Delete ${label}`);
    remove.title = isSessionActive(state) && state.timer.taskId === task.id ? 'End the session before deleting this task' : 'Delete task';
    remove.disabled = isSessionActive(state) && state.timer.taskId === task.id;
    // This SVG is a fixed application asset; task content only uses textContent.
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7M14 10v7"/></svg>';
    actions.append(remove);
    row.append(statusButton, text, actions);
    return row;
  });
  $('task-list').replaceChildren(...rows);
  $('empty-tasks').hidden = tasks.length > 0;
  $('empty-tasks-title').textContent = !attractor ? 'Turn your open tabs into a starting point.' : tab === 'done' ? 'Progress will find a home here.' : 'All clear in this attractor.';
  $('empty-tasks-description').textContent = !attractor ? 'An article to read, an issue to solve, a document to write. Just add the link.' : tab === 'done' ? 'Mark a task done when you finish. You can always reopen it.' : 'Add another link, reopen a done task, or explore a different attractor.';
}

function render() {
  const focused = document.activeElement?.dataset.focusKey;
  clearAttractorAnimations();
  renderTheme();
  const collapsed = Boolean(state.sidebarCollapsed);
  $('sidebar').hidden = collapsed;
  document.querySelector('.app-shell').classList.toggle('sidebar-collapsed', collapsed);
  $('sidebar-toggle').setAttribute('aria-expanded', String(!collapsed));
  $('sidebar-toggle').textContent = collapsed ? 'Show attractors' : 'Hide attractors';
  renderAttractors(); renderFocus(); renderTimer(); renderTasks();
  if (focused) {
    const replacement = [...document.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focused);
    (replacement ?? $(tab === 'pending' ? 'tab-pending' : 'tab-done')).focus({ preventScroll: true });
  }
  scheduleFaviconColors();
}

$('add-form').addEventListener('submit', event => {
  event.preventDefault();
  $('url-error').textContent = '';
  $('reopen-duplicate').hidden = true;
  duplicateId = null;
  try {
    const result = addTask(state, $('task-url').value);
    if (result.duplicate) {
      $('url-error').textContent = result.task.status === 'done' ? 'This task is already done. Want another go?' : 'This link is already in your task collection.';
      $('task-url').setAttribute('aria-invalid', 'true');
      if (result.task.status === 'done') { duplicateId = result.task.id; $('reopen-duplicate').hidden = false; }
      return;
    }
    if (state.selectedAttractorId !== result.task.attractorId) selectAttractor(state, result.task.attractorId);
    tab = 'pending';
    $('task-url').value = '';
    $('task-url').removeAttribute('aria-invalid');
    commit(`Task added to ${result.task.attractorId}.`);
  } catch (error) {
    $('url-error').textContent = error.message;
    $('task-url').setAttribute('aria-invalid', 'true');
    $('task-url').focus();
  }
});

$('task-url').addEventListener('input', () => { $('url-error').textContent = ''; $('task-url').removeAttribute('aria-invalid'); $('reopen-duplicate').hidden = true; duplicateId = null; });
$('reopen-duplicate').addEventListener('click', () => {
  const task = state.tasks.find(item => item.id === duplicateId);
  if (!task) return;
  reopenTask(state, task.id);
  selectAttractor(state, task.attractorId);
  tab = 'pending';
  $('task-url').value = ''; $('task-url').removeAttribute('aria-invalid'); $('url-error').textContent = ''; $('reopen-duplicate').hidden = true;
  commit('Task reopened. A fresh start.');
  $('task-url').focus();
});

$('attractor-list').addEventListener('click', event => {
  const options = event.target.closest('[data-settings-id]');
  if (options) { openAttractorSettings(options.dataset.settingsId); return; }
  const card = event.target.closest('[data-attractor-id]');
  if (!card || card.dataset.attractorId === state.selectedAttractorId) return;
  selectAttractor(state, card.dataset.attractorId);
  tab = 'pending';
  commit();
});
function focusAttractorSettings() {
  const target = [...document.querySelectorAll('[data-settings-id]')].find(node => node.dataset.settingsId === editingAttractorId);
  (target ?? $('task-url')).focus({ preventScroll: true });
}
function openAttractorSettings(id) {
  const attractor = state.attractors.find(item => item.id === id);
  if (!attractor) return;
  editingAttractorId = id;
  $('attractor-settings-domain').textContent = attractor.hostname;
  $('custom-color').value = attractor.customColor ?? attractor.color;
  $('custom-color-hex').value = $('custom-color').value;
  $('custom-color-hex').removeAttribute('aria-invalid');
  $('color-error').textContent = '';
  const count = state.tasks.filter(task => task.attractorId === id).length;
  $('attractor-delete-summary').textContent = `Permanently remove this attractor and its ${count} ${count === 1 ? 'task' : 'tasks'}.`;
  $('attractor-settings').showModal();
}
$('close-attractor-settings').addEventListener('click', () => $('attractor-settings').close());
$('attractor-settings').addEventListener('close', () => { if (!$('delete-attractor-dialog').open) focusAttractorSettings(); });
$('custom-color').addEventListener('input', () => { $('custom-color-hex').value = $('custom-color').value; $('color-error').textContent = ''; $('custom-color-hex').removeAttribute('aria-invalid'); });
$('custom-color-hex').addEventListener('input', () => {
  const hex = $('custom-color-hex').value.trim();
  if (/^#[\da-f]{6}$/i.test(hex)) $('custom-color').value = hex;
  $('color-error').textContent = ''; $('custom-color-hex').removeAttribute('aria-invalid');
});
$('attractor-color-form').addEventListener('submit', event => {
  event.preventDefault();
  const color = $('custom-color-hex').value.trim();
  if (!/^#[\da-f]{6}$/i.test(color)) {
    $('color-error').textContent = 'Enter a six-digit hex color, such as #7254c8.';
    $('custom-color-hex').setAttribute('aria-invalid', 'true'); $('custom-color-hex').focus(); return;
  }
  const attractor = state.attractors.find(item => item.id === editingAttractorId);
  if (!attractor) return;
  attractor.customColor = color.toLowerCase();
  $('attractor-settings').close(); commit('Custom attractor color saved.'); focusAttractorSettings();
});
$('reset-attractor-color').addEventListener('click', () => {
  const attractor = state.attractors.find(item => item.id === editingAttractorId);
  if (!attractor) return;
  delete attractor.customColor;
  $('attractor-settings').close(); commit('Automatic attractor color restored.'); focusAttractorSettings();
});
$('request-attractor-delete').addEventListener('click', () => {
  const tasks = state.tasks.filter(task => task.attractorId === editingAttractorId);
  const endsSession = isSessionActive(state) && tasks.some(task => task.id === state.timer.taskId);
  $('delete-attractor-description').textContent = `Delete ${editingAttractorId} and all ${tasks.length} tasks, including completed tasks?${endsSession ? ' This will also end its current session.' : ''} This cannot be undone.`;
  $('attractor-settings').close(); $('delete-attractor-dialog').showModal();
});
$('cancel-attractor-delete').addEventListener('click', () => $('delete-attractor-dialog').close());
$('delete-attractor-dialog').addEventListener('close', focusAttractorSettings);
$('confirm-attractor-delete').addEventListener('click', () => {
  const id = editingAttractorId;
  deleteAttractor(state, id); tab = 'pending';
  $('delete-attractor-dialog').close();
  commit(`Attractor ${id} deleted.`);
  (document.querySelector('[data-attractor-id]') ?? $('task-url')).focus();
});
for (const id of ['attractor-settings', 'delete-attractor-dialog']) $(id).addEventListener('click', event => {
  if (event.target !== $(id)) return;
  const rect = $(id).getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $(id).close();
});
$('draw-task').addEventListener('click', () => { const task = drawTask(state); if (task) commit(`Your next focus: ${taskLabel(task.url)}.`); });
$('complete-task').addEventListener('click', () => {
  completeTask(state, state.selectedTaskId);
  commit('Task done. A little progress, made.');
  $('draw-task').disabled ? $('tab-done').focus() : $('draw-task').focus();
});
$('task-list').addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const id = button.closest('[data-task-id]').dataset.taskId;
  if (button.dataset.action === 'complete') { completeTask(state, id); commit('Task done. A little progress, made.'); }
  if (button.dataset.action === 'reopen') { reopenTask(state, id); commit('Task reopened.'); }
  if (button.dataset.action === 'delete' && deleteTask(state, id)) commit('Task deleted.');
});
for (const status of ['pending', 'done']) $('tab-' + status).addEventListener('click', () => { tab = status; renderTasks(); });
for (const mode of ['focus', 'break']) $('mode-' + mode).addEventListener('click', () => { if (changeMode(state, mode)) commit(); });

$('timer-toggle').addEventListener('click', () => {
  if (state.timer?.status === 'running') { pauseTimer(state); commit('Session paused.'); }
  else if (state.timer?.status === 'paused') { resumeTimer(state); commit('Session resumed.'); }
  else if (state.timer?.status === 'finished' && state.mode === 'break') { changeMode(state, 'focus'); commit('Ready for your next focus.'); }
  else {
    if (state.timer?.status === 'finished') changeMode(state, 'break');
    if (startTimer(state)) commit(state.mode === 'focus' ? 'Focus session started.' : 'Short break started.');
  }
});
$('timer-end').addEventListener('click', () => { endTimer(state); commit('Session ended. Your task is still pending.'); $('timer-toggle').focus(); });

$('timer-settings').addEventListener('click', () => {
  $('focus-minutes').value = state.settings.focusMinutes;
  $('break-minutes').value = state.settings.breakMinutes;
  $('settings-error').textContent = '';
  $('settings-dialog').showModal();
});
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('click', event => { if (event.target === $('settings-dialog')) { const rect = $('settings-dialog').getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) $('settings-dialog').close(); } });
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  try {
    setSettings(state, Number($('focus-minutes').value), Number($('break-minutes').value));
    $('settings-dialog').close();
    commit('Your rhythm is saved. New durations apply to the next session.');
  } catch (error) { $('settings-error').textContent = error.message; }
});
$('reset-storage').addEventListener('click', () => {
  if (!window.confirm('Reset all Strange Focus data saved in this browser? This also clears tasks in the current session.')) return;
  const issue = storage.reset();
  showStorageIssue(issue);
  if (!issue) { state = createState(); tab = 'pending'; commit('Saved data reset. Ready for a fresh start.'); }
});

function updateClock() {
  if (tickTimer(state)) {
    commit(state.mode === 'focus' ? 'Focus session complete. Your task stays pending until you mark it done.' : 'Break complete. Ready for a fresh start.');
  } else renderTimer();
}
const expired = tickTimer(state);
$('sidebar-attractor').append(createAttractor('#b4a8d1'));
showStorageIssue(loaded.issue);
if (expired) persist();
render();
if (expired) announce('Your previous session has finished. No new timer was started.');
window.setInterval(updateClock, 250);
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateClock(); });
window.addEventListener('pageshow', updateClock);

$('sidebar-toggle').addEventListener('click', () => { state.sidebarCollapsed = !state.sidebarCollapsed; commit(); });
$('export-data').addEventListener('click', async () => {
  try {
    const data = extension ? await storage.document() : state;
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'strange-focus-backup.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { announce(error.message); }
});
if (extension) {
  storage.subscribe(next => { state = next; render(); });
  document.addEventListener('click', event => {
    const link = event.target.closest('#open-task, .task-link');
    if (!link) return;
    event.preventDefault();
    const id = link.id === 'open-task' ? state.selectedTaskId : link.closest('[data-task-id]').dataset.taskId;
    storage.open(id).catch(error => announce(error.message));
  });
  extension.mountControls(storage, announce).catch(error => announce(error.message));
}
