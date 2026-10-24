import test from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../../extension/engine.js';
import { initial, KEY, mergeWorkspace, importWorkspace, validate, validateMonitor } from '../../extension/state.js';
import { addTask, createState, drawTask, equivalentUrl, taskWeight } from '../../src/model.js';

function fixture() {
  let saved = initial(), fail = false;
  saved.monitor = { domains: ['example.com'], minutes: 1, paused: false, alpha: 1 };
  const tabs = new Map([[1, { id: 1, url: 'https://example.com/read', title: 'An article', status: 'complete', active: false, lastAccessed: 0 }]]);
  saved.candidates[1] = { tabId: 1, url: tabs.get(1).url, observedAt: 0, lastActive: 0 };
  const actions = [];
  const api = {
    storage: { local: { get: async () => ({ [KEY]: structuredClone(saved) }), set: async value => { if (fail) throw Error('quota'); saved = structuredClone(value[KEY]); actions.push('save'); } } },
    tabs: { query: async () => [...tabs.values()], get: async id => tabs.get(id), update: async (id, patch) => { actions.push('navigate'); Object.assign(tabs.get(id), patch); return tabs.get(id); }, remove: async id => { actions.push('remove'); tabs.delete(id); }, create: async options => { const tab = { id: 2, ...options, status: 'complete', windowId: 1 }; tabs.set(2, tab); return tab; } },
    scripting: { executeScript: async () => [{ result: true }] },
    permissions: { contains: async () => true },
    runtime: { getURL: path => `chrome-extension://test/${path}` }, windows: { update: async () => {} },
  };
  api.tabs.discard = async id => { actions.push('discard'); Object.assign(tabs.get(id), { discarded: true, status: 'unloaded' }); return tabs.get(id); };
  return { engine: new Engine(api), api, tabs, actions, saved: () => saved, fail: () => { fail = true; } };
}
test('capture persists before navigation; only the saved landing page is removed, survives new engine', async () => {
  const f = fixture(); await f.engine.scan();
  assert.deepEqual(f.actions, ['save', 'save', 'navigate']);
  assert.equal(f.saved().workspace.tasks[0].title, 'An article');
  await new Engine(f.api).scan();
  assert.equal(f.tabs.size, 0);
  assert.equal(f.saved().workspace.tasks[0].lifecycle, 'attracted');
  assert.equal(f.saved().recent.length, 1);
});
test('storage failure never closes or navigates a tab', async () => {
  const f = fixture(); f.fail();
  await assert.rejects(f.engine.scan(), /quota/);
  assert.equal(f.tabs.get(1).url, 'https://example.com/read');
  assert.deepEqual(f.actions, []);
});
test('active, pinned, audible, loading, and unsafe pages are protected', async () => {
  for (const patch of [{ active: true }, { pinned: true }, { audible: true }, { status: 'loading' }, { pendingUrl: 'https://example.com/next' }]) {
    const f = fixture(); Object.assign(f.tabs.get(1), patch); await f.engine.scan();
    assert.ok(!f.actions.includes('navigate'));
  }
  const f = fixture(); f.api.scripting.executeScript = async () => [{ result: false }]; await f.engine.scan();
  assert.ok(!f.actions.includes('navigate'));
});
test('default monitoring is paused and empty; missing permissions keep tabs', async () => {
  assert.deepEqual(initial().monitor.domains, []); assert.equal(initial().monitor.paused, true);
  const f = fixture(); f.api.scripting.executeScript = async () => { throw Error('No permission'); };
  await f.engine.scan(); assert.equal(f.tabs.size, 1);
});
test('reopen, re-attract and repeat preserve history and do not duplicate tasks', async () => {
  const f = fixture(); await f.engine.scan(); await f.engine.scan();
  let task = f.saved().workspace.tasks[0];
  await f.engine.command({ type: 'open', id: task.id });
  assert.equal(f.saved().workspace.tasks[0].reopenCount, 1);
  f.tabs.delete(2); await f.engine.scan();
  await f.engine.command({ type: 'open', id: task.id });
  task = f.saved().workspace.tasks[0];
  assert.equal(task.reopenCount, 2); assert.equal(f.saved().workspace.tasks.length, 1);
  assert.deepEqual(task.history.map(item => item.type), ['attracted', 'reopened', 're-attracted', 'reopened']);
});
test('crash reconciliation matches restored URLs despite changed tab IDs', async () => {
  const f = fixture(); await f.engine.scan(); await f.engine.scan();
  f.tabs.set(99, { id: 99, url: 'https://example.com/read', active: true, status: 'complete' });
  await new Engine(f.api).scan();
  assert.equal(f.saved().workspace.tasks[0].lifecycle, 'reopened');
  assert.equal(f.saved().candidates[99].taskId, f.saved().workspace.tasks[0].id);
});
test('weighted draw is statistically proportional and excludes open tasks', () => {
  const state = createState();
  const a = addTask(state, 'https://example.com/a', 'a').task;
  const b = addTask(state, 'https://example.com/b', 'b').task;
  const c = addTask(state, 'https://example.com/c', 'c').task;
  b.reopenCount = 3; c.lifecycle = 'reopened'; state.selectedAttractorId = 'example.com';
  assert.equal(taskWeight(a), 1); assert.equal(taskWeight(b), 3);
  let seed = 123456789, count = 0;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let i = 0; i < 40000; i++) { const selected = drawTask(state, random); assert.notEqual(selected.id, 'c'); if (selected.id === 'b') count++; }
  assert.ok(Math.abs(count / 40000 - .75) < .01);
});
test('URL equivalence strips tracking but preserves meaningful parameters and fragments', () => {
  assert.equal(equivalentUrl('https://example.com/a?id=2&utm_source=x'), 'https://example.com/a?id=2');
  assert.notEqual(equivalentUrl('https://youtube.com/watch?v=1'), equivalentUrl('https://youtube.com/watch?v=2'));
  assert.notEqual(equivalentUrl('https://example.com/#a'), equivalentUrl('https://example.com/#b'));
});
test('imports merge without overwriting existing tasks, settings or custom colors', () => {
  const doc = initial(); const existing = addTask(doc.workspace, 'https://example.com/a').task;
  doc.workspace.attractors[0].customColor = '#123456';
  const incoming = createState(); addTask(incoming, 'https://example.com/a?utm_source=x'); addTask(incoming, 'https://example.com/b'); incoming.settings.focusMinutes = 99;
  assert.equal(importWorkspace(doc, incoming), 1);
  assert.equal(doc.workspace.tasks.length, 2); assert.equal(doc.workspace.tasks[0].id, existing.id);
  assert.equal(doc.workspace.attractors[0].customColor, '#123456'); assert.equal(doc.workspace.settings.focusMinutes, 25);
});
test('three-way merge retains new background tasks and rejects stale conflicting edits', () => {
  const base = createState(); addTask(base, 'https://example.com/a');
  const next = structuredClone(base); next.theme = 'dark';
  const latest = structuredClone(base); addTask(latest, 'https://example.com/b');
  const merged = mergeWorkspace(latest, base, next); assert.equal(merged.tasks.length, 2); assert.equal(merged.theme, 'dark');
  latest.theme = 'light'; assert.throws(() => mergeWorkspace(latest, base, next), /changed/);
});

test('a capture write failure after discovery preserves the original tab', async () => {
  const f = fixture();
  const write = f.api.storage.local.set; let writes = 0;
  f.api.storage.local.set = async value => { if (++writes === 2) throw Error('disk full'); return write(value); };
  await assert.rejects(f.engine.scan(), /disk full/);
  assert.equal(f.tabs.get(1).url, 'https://example.com/read');
  assert.equal(f.saved().candidates[1].url, 'https://example.com/read');
  assert.ok(!f.actions.includes('navigate'));
});
test('candidates lost in a browser crash become tasks instead of disappearing', async () => {
  const f = fixture(); f.tabs.clear(); await new Engine(f.api).scan();
  assert.equal(f.saved().workspace.tasks.length, 1);
  assert.equal(f.saved().workspace.tasks[0].url, 'https://example.com/read');
});
test('a tab activated during safety checks is never navigated away', async () => {
  const f = fixture(); f.api.scripting.executeScript = async () => { f.tabs.get(1).active = true; return [{ result: true }]; };
  await f.engine.scan(); assert.ok(!f.actions.includes('navigate'));
});
test('malformed persisted data blocks capture without overwriting evidence', async () => {
  const f = fixture(); f.api.storage.local.get = async () => ({ [KEY]: { version: 999 } });
  await assert.rejects(f.engine.scan(), /preserved/); assert.deepEqual(f.actions, []);
});

test('storage key ordering does not create false edit conflicts', () => {
  const base = createState(); addTask(base, 'https://example.com/a');
  const current = structuredClone(base);
  current.tasks[0] = Object.fromEntries(Object.entries(current.tasks[0]).reverse());
  const next = structuredClone(base); next.tasks[0].status = 'done'; next.tasks[0].completedAt = 1;
  assert.equal(mergeWorkspace(current, base, next).tasks[0].status, 'done');
});

test('activation while persisting a capture protects the tab before navigation', async () => {
  const f = fixture(); const save = f.api.storage.local.set; let writes = 0;
  f.api.storage.local.set = async value => { await save(value); if (++writes === 2) f.tabs.get(1).active = true; };
  await f.engine.scan(); assert.ok(!f.actions.includes('navigate')); assert.equal(f.saved().workspace.tasks.length, 1);
});

test('slow navigation keeps its capture receipt until the landing page commits', async () => {
  const f = fixture();
  f.api.tabs.update = async (id, patch) => { f.actions.push('navigate'); Object.assign(f.tabs.get(id), { pendingUrl: patch.url, status: 'loading' }); };
  await f.engine.scan(); const gate = f.saved().candidates[1].gate;
  await f.engine.scan(); assert.equal(f.saved().candidates[1].gate, gate);
  assert.equal(f.actions.filter(action => action === 'navigate').length, 1);
  Object.assign(f.tabs.get(1), { url: gate, pendingUrl: undefined, status: 'complete' });
  await f.engine.scan(); assert.equal(f.tabs.size, 0);
});


test('page safety bypass defaults off, migrates old saves, and rejects malformed opt-ins', () => {
  assert.equal(initial().monitor.bypassPageSafety, false);
  const legacy = initial(); delete legacy.monitor.bypassPageSafety;
  assert.equal(validate(legacy).monitor.bypassPageSafety, false);
  for (const bypassPageSafety of ['true', 1, null, {}, []]) {
    assert.throws(() => validateMonitor({ ...initial().monitor, bypassPageSafety }), /bypass/);
  }
  assert.equal(validateMonitor({ ...initial().monitor, bypassPageSafety: true }).bypassPageSafety, true);
});

test('explicit bypass persists before direct close and does not inspect or navigate the page', async () => {
  const f = fixture();
  await f.engine.command({ type: 'monitor', monitor: { ...f.saved().monitor, bypassPageSafety: true } });
  f.actions.length = 0;
  f.api.scripting.executeScript = async () => { throw Error('must not inspect'); };
  let requestedOrigins;
  f.api.permissions.contains = async access => { requestedOrigins = access.origins; return true; };
  await f.engine.scan();
  assert.deepEqual(f.actions, ['save', 'save', 'discard', 'remove', 'save']);
  assert.deepEqual(requestedOrigins, ['https://example.com/*']);
  assert.equal(f.tabs.size, 0);
  assert.equal(f.saved().workspace.tasks.length, 1);
  assert.equal(f.saved().workspace.tasks[0].capturePending, undefined);
  assert.equal(f.saved().recent.length, 1);
  assert.deepEqual(f.saved().candidates, {});
});

test('bypass retains global pause, exact domains, inactivity, and tab protection', async () => {
  for (const patch of [{ active: true }, { pinned: true }, { audible: true }, { status: 'loading' }, { pendingUrl: 'https://example.com/next' }, { incognito: true }]) {
    const f = fixture(); f.saved().monitor.bypassPageSafety = true;
    Object.assign(f.tabs.get(1), patch); await f.engine.scan();
    assert.ok(!f.actions.includes('remove')); assert.ok(!f.actions.includes('navigate'));
  }
  for (const monitorPatch of [{ paused: true }, { domains: ['other.example'] }]) {
    const f = fixture(); Object.assign(f.saved().monitor, monitorPatch, { bypassPageSafety: true });
    await f.engine.scan(); assert.ok(!f.actions.includes('remove'));
  }
  const f = fixture(); f.saved().monitor.bypassPageSafety = true; f.saved().candidates[1].lastActive = Date.now();
  await f.engine.scan(); assert.equal(f.saved().candidates[1].skipReason, 'inactivity'); assert.equal(f.tabs.size, 1);
});

test('bypass still respects revoked site permission and reports it', async () => {
  const f = fixture(); f.saved().monitor.bypassPageSafety = true;
  f.api.permissions.contains = async () => false;
  await f.engine.scan();
  assert.equal(f.tabs.size, 1); assert.equal(f.saved().workspace.tasks.length, 0);
  assert.equal(f.saved().candidates[1].skipReason, 'site-access');
});

test('bypass cannot close after a failed capture write or a late activation/URL change', async () => {
  for (const operation of ['write-failure', 'active', 'url']) {
    const f = fixture(); f.saved().monitor.bypassPageSafety = true;
    const save = f.api.storage.local.set; let writes = 0;
    f.api.storage.local.set = async value => {
      writes++;
      if (writes === 2 && operation === 'write-failure') throw Error('disk full');
      await save(value);
      if (writes === 2 && operation === 'active') f.tabs.get(1).active = true;
      if (writes === 2 && operation === 'url') f.tabs.get(1).url = 'https://example.com/changed';
    };
    if (operation === 'write-failure') await assert.rejects(f.engine.scan(), /disk full/); else await f.engine.scan();
    assert.equal(f.tabs.size, 1); assert.ok(!f.actions.includes('remove'));
  }
});

test('bypass removal failure retains the durable task and can retry its discarded tab', async () => {
  const f = fixture(); f.saved().monitor.bypassPageSafety = true;
  const remove = f.api.tabs.remove;
  f.api.tabs.remove = async () => { throw Error('cannot remove'); };
  await assert.rejects(f.engine.scan(), /cannot remove/);
  assert.equal(f.saved().workspace.tasks.length, 1); assert.equal(f.tabs.size, 1);
  assert.equal(f.saved().workspace.tasks[0].capturePending, true);
  assert.equal(f.tabs.get(1).discarded, true);
  f.api.tabs.remove = remove;
  await new Engine(f.api).scan();
  assert.equal(f.tabs.size, 0); assert.equal(f.saved().workspace.tasks.length, 1);
  assert.equal(f.actions.filter(action => action === 'discard').length, 1);
});

test('a failed receipt write after bypass close is reconciled without losing the task', async () => {
  const f = fixture(); f.saved().monitor.bypassPageSafety = true;
  const save = f.api.storage.local.set; let writes = 0;
  f.api.storage.local.set = async value => { if (++writes === 3) throw Error('receipt failed'); return save(value); };
  await assert.rejects(f.engine.scan(), /receipt failed/);
  assert.equal(f.tabs.size, 0); assert.equal(f.saved().workspace.tasks.length, 1);
  await new Engine(f.api).scan();
  assert.equal(f.saved().workspace.tasks.length, 1); assert.equal(f.saved().workspace.tasks[0].capturePending, undefined);
});

test('skip diagnostics persist, contain only reason codes, and clear when a page becomes safe', async () => {
  for (const reason of ['frames', 'editor', 'edited-form', 'page-changed']) {
    const f = fixture(); f.api.scripting.executeScript = async () => [{ result: reason }];
    await f.engine.scan(); assert.equal(f.saved().candidates[1].skipReason, reason);
    assert.equal(f.saved().workspace.tasks.length, 0);
    f.api.scripting.executeScript = async () => [{ result: true }];
    await f.engine.scan(); assert.equal(f.saved().candidates[1].skipReason, 'capture-pending');
  }
  for (const result of [[], [{ result: false }], [{ result: { field: 'private text' } }]]) {
    const f = fixture(); f.api.scripting.executeScript = async () => result;
    await f.engine.scan(); assert.equal(f.saved().candidates[1].skipReason, 'safety-check');
    assert.ok(!JSON.stringify(f.saved()).includes('private text'));
  }
  const f = fixture(); f.api.scripting.executeScript = async () => { throw Error('private details'); };
  await f.engine.scan(); assert.equal(f.saved().candidates[1].skipReason, 'site-access');
});

test('bypass removes a prior unload cooldown but not inactivity', async () => {
  const f = fixture(); f.saved().monitor.bypassPageSafety = true;
  f.saved().candidates[1].blockedAt = Date.now();
  await f.engine.scan(); assert.equal(f.tabs.size, 0);
});

test('bypass leaves the saved task and tab if discard fails or the tab changes after discarding', async () => {
  for (const change of ['discard-failure', 'active', 'pinned', 'audible', 'url', 'reload']) {
    const f = fixture(); f.saved().monitor.bypassPageSafety = true;
    f.api.tabs.discard = async id => {
      f.actions.push('discard');
      if (change === 'discard-failure') throw Error('cannot discard');
      const tab = f.tabs.get(id); Object.assign(tab, { discarded: true, status: 'unloaded' });
      if (['active', 'pinned', 'audible'].includes(change)) tab[change] = true;
      if (change === 'url') tab.url = 'https://example.com/new';
      if (change === 'reload') { tab.discarded = false; tab.status = 'loading'; }
      return tab;
    };
    await f.engine.scan();
    assert.equal(f.tabs.size, 1); assert.equal(f.saved().workspace.tasks.length, 1);
    assert.ok(!f.actions.includes('remove'));
    assert.equal(f.saved().candidates[1].skipReason, change === 'discard-failure' ? 'discard-failed' : 'page-changed');
  }
});
