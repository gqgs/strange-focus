import { createState, addTask, equivalentUrl } from '../src/model.js';
import { isValidState } from '../src/storage.js';
export const KEY = 'strange-focus:extension:v2';
export function initial() {
  return { version: 2, workspace: createState(), candidates: {}, recent: [], monitor: { domains: [], minutes: 60, paused: true, alpha: 1 } };
}
export function validate(doc) {
  if (!doc || doc.version !== 2 || !isValidState(doc.workspace) || !doc.candidates || typeof doc.candidates !== 'object' || Array.isArray(doc.candidates) || !Array.isArray(doc.recent)) throw new Error('Extension data could not be read. It has been preserved.');
  validateMonitor(doc.monitor);
  for (const candidate of Object.values(doc.candidates)) {
    if (!candidate || !Number.isInteger(candidate.tabId) || !Number.isFinite(candidate.lastActive) || !Number.isFinite(candidate.observedAt)) throw new Error('Invalid saved candidate; data preserved.');
    equivalentUrl(candidate.url);
  }
  return doc;
}
export function validateMonitor(value) {
  if (!value || !Array.isArray(value.domains) || value.domains.some(domain => typeof domain !== 'string' || domain !== domainName(domain)) || typeof value.paused !== 'boolean' || !Number.isFinite(value.minutes) || value.minutes < 1 || value.minutes > 10080 || !Number.isFinite(value.alpha) || value.alpha < 0 || value.alpha > 100) throw new Error('Use exact domains, 1–10080 minutes, and a priority strength from 0 to 100.');
  return value;
}
export function domainName(input) {
  const url = new URL(input.includes('://') ? input : `https://${input.trim()}`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash || !url.hostname) throw new Error('Enter a domain without a path or port.');
  return url.hostname.toLowerCase();
}
export const origins = domains => domains.flatMap(domain => [`http://${domain}/*`, `https://${domain}/*`]);
export function monitored(tab, config) {
  try { const url = new URL(tab.url); return !tab.incognito && ['https:', 'http:'].includes(url.protocol) && config.domains.includes(url.hostname); } catch { return false; }
}
export function protectedTab(tab) { return tab.active || tab.pinned || tab.audible || tab.status !== 'complete' || Boolean(tab.pendingUrl); }
export function history(task, type, now) {
  task.history ??= [];
  task.history.push({ type, at: now });
}
export function attract(doc, candidate, now) {
  const { task } = addTask(doc.workspace, candidate.url, crypto.randomUUID(), now);
  if (!doc.workspace.selectedAttractorId) doc.workspace.selectedAttractorId = task.attractorId;
  if (task.status === 'done') return null;
  task.title = candidate.title || task.title || '';
  task.favIconUrl = candidate.favIconUrl || task.favIconUrl || '';
  task.reopenCount ??= 0;
  if (task.lifecycle !== 'attracted') history(task, task.lifecycle === 'reopened' ? 're-attracted' : 'attracted', now);
  task.lifecycle = 'attracted';
  delete task.capturePending;
  candidate.taskId = task.id;
  return task;
}
const same = (a, b) => {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
};
// Three-way merge: concurrent changes to unrelated tasks/settings are retained.
// Conflicting edits fail instead of overwriting newer background captures.
export function mergeWorkspace(current, base, next) {
  if (!isValidState(base) || !isValidState(next)) throw new Error('Invalid workspace.');
  const result = structuredClone(current);
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (same(base[key], next[key])) continue;
    if (['tasks', 'attractors'].includes(key)) {
      const before = new Map(base[key].map(item => [item.id, item]));
      const after = new Map(next[key].map(item => [item.id, item]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        if (same(before.get(id), after.get(id))) continue;
        const actual = result[key].find(item => item.id === id);
        if (!same(actual, before.get(id))) throw new Error('This item changed in another tab. Please export your work before reloading and retrying.');
        result[key] = result[key].filter(item => item.id !== id);
        if (after.has(id)) result[key].push(after.get(id));
      }
    } else {
      if (!same(current[key], base[key])) throw new Error('Workspace changed in another tab. Please retry.');
      if (key in next) result[key] = structuredClone(next[key]); else delete result[key];
    }
  }
  if (!isValidState(result)) throw new Error('Concurrent changes conflict. Please retry.');
  return result;
}
export function importWorkspace(doc, input) {
  const source = input?.version === 2 ? validate(input).workspace : input;
  if (!isValidState(source)) throw new Error('Choose a valid Strange Focus JSON export.');
  const empty = !doc.workspace.tasks.length && !doc.workspace.attractors.length;
  const existingDomains = doc.workspace.attractors.map(item => item.id);
  let count = 0;
  for (const incoming of source.tasks) {
    if (doc.workspace.tasks.some(task => equivalentUrl(task.url) === equivalentUrl(incoming.url))) continue;
    const { task } = addTask(doc.workspace, incoming.url);
    const id = task.id;
    Object.assign(task, structuredClone(incoming), { id });
    delete task.capturePending;
    if (task.lifecycle === 'reopened') task.lifecycle = 'attracted';
    count++;
  }
  for (const incoming of source.attractors) {
    let target = doc.workspace.attractors.find(item => item.id === incoming.id);
    if (!target) { doc.workspace.attractors.push(structuredClone(incoming)); continue; }
    // Existing user colors always win; copy colors for newly imported domains.
    if (!existingDomains.includes(incoming.id)) Object.assign(target, incoming);
  }
  if (empty) {
    doc.workspace.settings = structuredClone(source.settings);
    if (source.theme) doc.workspace.theme = source.theme;
    doc.workspace.sidebarCollapsed = source.sidebarCollapsed ?? false;
    doc.workspace.selectedAttractorId = source.selectedAttractorId;
  }
  return count;
}
