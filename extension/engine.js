import { initial, validate, validateMonitor, monitored, protectedTab, tabProtectionReason, attract, history, mergeWorkspace, importWorkspace, KEY } from './state.js';
import { equivalentUrl, isSessionActive } from '../src/model.js';
import { safeToLeave } from './safety.js';

// A bypass capture may resume after a discard succeeded but removal failed.
// Discarded is not loading; never relax active/pinned/audible/pending-URL guards.
const captureProtectionReason = (tab, monitor) => tabProtectionReason(
  monitor.bypassPageSafety && tab.discarded && tab.status === 'unloaded' ? { ...tab, status: 'complete' } : tab,
);

export class Engine {
  constructor(api) { this.api = api; }
  async load() { const saved = (await this.api.storage.local.get(KEY))[KEY]; return saved === undefined ? initial() : validate(saved); }
  async save(doc) { validate(doc); await this.api.storage.local.set({ [KEY]: doc }); }
  async scan() {
    const doc = await this.load();
    const now = Date.now();
    const tabs = await this.api.tabs.query({});
    // Tab IDs change after browser restoration. Match URLs before retiring a
    // record; an intention whose tab vanished is retained as a queued task.
    for (const [id, candidate] of Object.entries(doc.candidates)) {
      const sameTab = tabs.find(tab => String(tab.id) === id);
      if (sameTab && (sameTab.url === candidate.url || sameTab.url === candidate.gate)) continue;
      const restored = tabs.find(tab => { try { return equivalentUrl(tab.url) === equivalentUrl(candidate.url); } catch { return false; } });
      if (restored) doc.candidates[restored.id] = { ...candidate, tabId: restored.id, gate: undefined };
      else attract(doc, candidate, now);
      if (String(restored?.id) !== id) delete doc.candidates[id];
    }
    const open = new Set();
    for (const tab of tabs) {
      if (tab.incognito) continue;
      const candidate = doc.candidates[tab.id];
      const gate = candidate?.gate;
      if (gate && (tab.pendingUrl === gate || (tab.url === candidate.url && tab.status === 'loading'))) {
        if (candidate.taskId) open.add(candidate.taskId);
        continue; // Preserve the capture receipt while navigation/unload is pending.
      }
      if (gate && tab.url === gate) {
        const task = doc.workspace.tasks.find(item => item.id === candidate.taskId);
        // Only a persisted, exact, unguessable landing URL can be closed.
        if (task) {
          delete task.capturePending;
          if (!doc.recent.some(item => item.taskId === task.id)) doc.recent = [{ taskId: task.id, at: now }, ...doc.recent].slice(0, 50);
        }
        if (task && !protectedTab(tab) && !doc.monitor.paused) {
          await this.save(doc);
          const fresh = await this.api.tabs.get(tab.id);
          if (fresh.url === gate && !protectedTab(fresh)) {
            await this.api.tabs.remove(tab.id);
            delete doc.candidates[tab.id];
          }
          doc.recent = [{ taskId: task.id, at: now }, ...doc.recent.filter(item => item.taskId !== task.id)].slice(0, 50);
        }
        continue;
      }
      let key;
      try { key = equivalentUrl(tab.url); } catch { continue; }
      const task = doc.workspace.tasks.find(item => equivalentUrl(item.url) === key && item.status === 'pending');
      if (task) {
        open.add(task.id);
        if (task.lifecycle !== 'reopened') {
          task.lifecycle = 'reopened';
          if (!candidate?.gate) { task.reopenCount = (task.reopenCount ?? 0) + 1; history(task, 'reopened', now); }
          delete task.capturePending;
        }
      }
      if (!monitored(tab, doc.monitor) && !task) { delete doc.candidates[tab.id]; continue; }
      const previous = candidate?.url === tab.url ? candidate : null;
      doc.candidates[tab.id] = {
        tabId: tab.id, url: tab.url, title: tab.title ?? '', favIconUrl: tab.favIconUrl ?? '',
        observedAt: previous?.observedAt ?? now,
        lastActive: tab.active || previous?.wasActive ? now : Math.max(previous?.lastActive ?? now, tab.lastAccessed ?? 0),
        wasActive: Boolean(tab.active),
        ...(task ? { taskId: task.id } : {}),
        ...(previous?.gate ? { blockedAt: now } : previous?.blockedAt ? { blockedAt: previous.blockedAt } : {}),
      };
    }
    for (const task of doc.workspace.tasks) {
      if (task.lifecycle === 'reopened' && !open.has(task.id)) { task.lifecycle = 'attracted'; history(task, 're-attracted', now); }
    }
    // Discovery is durable even when paused, and before any tab operation.
    for (const candidate of Object.values(doc.candidates)) {
      const tab = tabs.find(item => item.id === candidate.tabId);
      const existing = doc.workspace.tasks.find(task => equivalentUrl(task.url) === equivalentUrl(candidate.url));
      candidate.skipReason = doc.monitor.paused ? 'paused'
        : !tab ? 'page-changed'
        : captureProtectionReason(tab, doc.monitor) || (candidate.gate ? 'capture-pending'
          : !monitored(tab, doc.monitor) ? 'not-monitored'
          : now - candidate.lastActive < doc.monitor.minutes * 60000 ? 'inactivity'
          : !doc.monitor.bypassPageSafety && candidate.blockedAt && now - candidate.blockedAt < 3600000 ? 'unload-cooldown'
          : existing?.status === 'done' ? 'completed'
          : isSessionActive(doc.workspace) && existing?.id === doc.workspace.timer.taskId ? 'focus-session'
          : 'checking');
    }
    await this.save(doc);
    if (doc.monitor.paused) return doc;
    let statusChanged = false;
    const skip = (candidate, reason) => { candidate.skipReason = reason; statusChanged = true; };
    for (const candidate of Object.values(doc.candidates)) {
      const tab = tabs.find(item => item.id === candidate.tabId);
      if (candidate.skipReason !== 'checking') continue;
      try {
        if (doc.monitor.bypassPageSafety) {
          // Revoked site access is still respected even without DOM inspection.
          const url = new URL(candidate.url);
          if (!await this.api.permissions.contains({ origins: [`${url.protocol}//${url.hostname}/*`] })) { skip(candidate, 'site-access'); continue; }
        } else {
          const result = await this.api.scripting.executeScript({ target: { tabId: tab.id }, func: safeToLeave, args: [candidate.url] });
          const unsafe = result.find(frame => frame.result !== true);
          if (!result.length || unsafe) {
            skip(candidate, ['page-changed', 'frames', 'editor', 'edited-form'].includes(unsafe?.result) ? unsafe.result : 'safety-check');
            continue;
          }
        }
      } catch { skip(candidate, 'site-access'); continue; } // No host access or page disappeared: keep it.
      try {
        const fresh = await this.api.tabs.get(tab.id);
        if (fresh.url !== candidate.url || captureProtectionReason(fresh, doc.monitor)) { skip(candidate, 'page-changed'); continue; }
        const task = attract(doc, candidate, now);
        if (!task) continue;
        if (!doc.monitor.bypassPageSafety) candidate.gate = this.api.runtime.getURL(`extension/parked.html#${crypto.randomUUID()}`);
        candidate.skipReason = 'capture-pending';
        // Keep it out of the draw pool until the original document is gone.
        task.capturePending = true;
        await this.save(doc);
        // In safe mode navigation lets Chromium run beforeunload. Never
        // accept/dismiss a prompt. Explicit bypass instead closes directly.
        const beforeNavigation = await this.api.tabs.get(tab.id);
        if (beforeNavigation.url !== candidate.url || captureProtectionReason(beforeNavigation, doc.monitor)) { skip(candidate, 'page-changed'); continue; }
        if (doc.monitor.bypassPageSafety) {
          // Removing a live page can still wait for beforeunload. The explicit
          // opt-out discards its document first, only after the task is durable.
          // Chrome refuses to discard an active tab; recheck again before close.
          let discarded = beforeNavigation;
          try {
            if (!discarded.discarded) discarded = await this.api.tabs.discard(tab.id);
          } catch { skip(candidate, 'discard-failed'); continue; }
          if (!discarded || !Number.isInteger(discarded.id)) { skip(candidate, 'discard-failed'); continue; }
          if (!discarded.discarded) { skip(candidate, 'page-changed'); continue; }
          // Some Chromium versions replace the tab's WebContents and ID on
          // discard. Persist that identity before attempting to remove it.
          if (discarded.id !== candidate.tabId) {
            delete doc.candidates[candidate.tabId];
            candidate.tabId = discarded.id;
            doc.candidates[candidate.tabId] = candidate;
            await this.save(doc);
          }
          const beforeClose = await this.api.tabs.get(candidate.tabId);
          if (!beforeClose.discarded || beforeClose.url !== candidate.url || beforeClose.active || beforeClose.pinned || beforeClose.audible || beforeClose.pendingUrl) {
            skip(candidate, 'page-changed'); continue;
          }
          await this.api.tabs.remove(candidate.tabId);
          delete task.capturePending;
          delete doc.candidates[candidate.tabId];
          doc.recent = [{ taskId: task.id, at: now }, ...doc.recent.filter(item => item.taskId !== task.id)].slice(0, 50);
          await this.save(doc);
        } else await this.api.tabs.update(tab.id, { url: candidate.gate });
      } catch (error) {
        // A failed storage write stops the entire scan before any further close.
        // Navigation failures retain the task and original tab for recovery.
        throw error;
      }
    }
    if (statusChanged) await this.save(doc);
    return doc;
  }
  async command(message) {
    const doc = await this.load();
    if (message.type === 'get') return doc;
    if (message.type === 'scan') return this.scan();
    if (message.type === 'workspace') {
      doc.workspace = mergeWorkspace(doc.workspace, message.base, message.next);
      // Deleting a task/attractor also cancels its pending capture record.
      for (const [id, candidate] of Object.entries(doc.candidates)) if (candidate.taskId && !doc.workspace.tasks.some(task => task.id === candidate.taskId)) delete doc.candidates[id];
      doc.recent = doc.recent.filter(item => doc.workspace.tasks.some(task => task.id === item.taskId));
    } else if (message.type === 'monitor') {
      doc.monitor = validateMonitor(message.monitor);
      doc.workspace.priorityAlpha = doc.monitor.alpha;
    } else if (message.type === 'import') {
      importWorkspace(doc, message.data);
    } else if (message.type === 'open') {
      const task = doc.workspace.tasks.find(item => item.id === message.id);
      if (!task) throw new Error('Task no longer exists.');
      const tabs = await this.api.tabs.query({});
      const existing = tabs.find(tab => { try { return equivalentUrl(tab.url) === equivalentUrl(task.url); } catch { return false; } });
      if (existing) {
        if (task.status === 'pending' && task.lifecycle !== 'reopened') {
          task.lifecycle = 'reopened'; task.reopenCount = (task.reopenCount ?? 0) + 1; history(task, 'reopened', Date.now());
          await this.save(doc);
        }
        await this.api.tabs.update(existing.id, { active: true }); await this.api.windows.update(existing.windowId, { focused: true }); return doc;
      }
      const before = structuredClone(doc);
      if (task.status === 'pending') {
        task.lifecycle = 'reopened'; task.reopenCount = (task.reopenCount ?? 0) + 1; history(task, 'reopened', Date.now());
      }
      await this.save(doc);
      let opened;
      try { opened = await this.api.tabs.create({ url: task.url, active: true }); }
      catch (error) { await this.save(before); throw error; }
      doc.candidates[opened.id] = { tabId: opened.id, url: task.url, title: task.title ?? '', favIconUrl: task.favIconUrl ?? '', taskId: task.id, observedAt: Date.now(), lastActive: Date.now() };
    } else throw new Error('Unknown operation.');
    await this.save(doc);
    return doc;
  }
}

