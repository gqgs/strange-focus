import { createState } from '../src/model.js';
import { domainName, origins, KEY, initial } from './state.js';
async function request(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  if (!result?.doc) throw new Error('Extension worker did not respond. Reload to retry.');
  return result.doc;
}
export function extensionStorage() {
  let base, latestDocument, pending = 0, queue = Promise.resolve(), subscriber, blocked = false;
  async function refresh() {
    if (pending || blocked || !subscriber) return;
    try { const doc = await request({ type: 'get' }); if (!pending && !blocked) { latestDocument = doc; base = structuredClone(doc.workspace); subscriber(doc.workspace); } } catch { /* The next save reports errors. */ }
  }
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes[KEY]) refresh(); });
  return {
    async load() {
      try { const doc = await request({ type: 'get' }); latestDocument = doc; base = structuredClone(doc.workspace); return { state: doc.workspace }; }
      catch (error) { blocked = true; return { state: createState(), issue: error.message }; }
    },
    save(state) {
      if (blocked) { base = structuredClone(state); return Promise.resolve('Changes are only in memory. Export data before reloading to retry.'); }
      const previous = structuredClone(base), next = structuredClone(state);
      base = next; pending++;
      const operation = queue.then(async () => {
        try {
          if (blocked) return 'Changes are only in memory. Export data before reloading to retry.';
          await request({ type: 'workspace', base: previous, next }); return null;
        }
        catch (error) { blocked = true; return `${error.message} Changes remain in memory; export data before reloading.`; }
        finally { pending--; }
      });
      queue = operation.then(async issue => { if (!pending) await refresh(); return issue; });
      return queue;
    },
    subscribe(callback) { subscriber = callback; },
    reset() { return 'Extension data is preserved. Export a backup before managing extension storage.'; },
    async open(id) { await queue; await request({ type: 'open', id }); await refresh(); },
    async document() {
      await queue;
      if (blocked) return { ...structuredClone(latestDocument ?? initial()), workspace: structuredClone(base ?? createState()) };
      return request({ type: 'get' });
    },
  };
}
export async function mountControls(storage, announce) {
  const root = document.getElementById('extension-controls');
  root.hidden = false;
  root.innerHTML = `<details class="monitor-panel"><summary>Tab attraction settings</summary>
    <p>Opt in to exact domains. Active, pinned, audible tabs, forms with edits, and embedded editors stay open. Only explicitly completed tasks leave your collection.</p>
    <form id="monitor-form"><label for="monitor-domains">Monitored domains (one per line)</label><textarea id="monitor-domains" rows="5" placeholder="news.ycombinator.com&#10;arxiv.org&#10;en.wikipedia.org&#10;www.youtube.com&#10;chatgpt.com"></textarea>
    <label for="monitor-minutes">Attract after inactivity (minutes)</label><input id="monitor-minutes" type="number" min="1" max="10080" required>
    <label for="monitor-alpha">Reopening priority strength</label><input id="monitor-alpha" type="number" min="0" max="100" step="0.1" required><p>Default 1. Set to 0 for equal chances.</p>
    <label class="check-label"><input id="monitor-paused" type="checkbox"> Pause automatic attraction</label>
    <button class="button primary" type="submit">Save monitoring settings</button><p id="monitor-message" role="status"></p></form>
    <h3>Recently attracted</h3><div id="recent-tabs"></div>
    <h3>Import existing tasks</h3><p>Use Export data in the web app, then select its JSON file here. Existing tasks and colors are kept. Settings are imported only into an empty collection.</p><label for="import-data">Choose a Strange Focus export</label><input id="import-data" type="file" accept="application/json,.json">
  </details>`;
  const $ = id => document.getElementById(id);
  const doc = await storage.document();
  $('monitor-domains').value = doc.monitor.domains.join('\n');
  $('monitor-minutes').value = doc.monitor.minutes;
  $('monitor-alpha').value = doc.monitor.alpha;
  $('monitor-paused').checked = doc.monitor.paused;
  async function recent() {
    const doc = await storage.document();
    $('recent-tabs').replaceChildren();
    for (const entry of doc.recent) {
      const task = doc.workspace.tasks.find(task => task.id === entry.taskId);
      if (!task) continue;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'text-button';
      button.textContent = `Restore ${task.title || task.url}`;
      button.addEventListener('click', () => storage.open(task.id).catch(error => announce(error.message)));
      $('recent-tabs').append(button);
    }
    if (!$('recent-tabs').children.length) $('recent-tabs').textContent = 'No attracted tabs yet.';
  }
  await recent();
  root.querySelector('details').addEventListener('toggle', () => { if (root.querySelector('details').open) recent().catch(error => announce(error.message)); });
  $('monitor-form').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      const domains = [...new Set($('monitor-domains').value.split(/[\s,]+/).filter(Boolean).map(domainName))];
      // Request optional access directly from the user gesture.
      if (domains.length && !await chrome.permissions.request({ origins: origins(domains) })) throw new Error('Site access was not granted. Monitoring settings were not changed.');
      await request({ type: 'monitor', monitor: { domains, minutes: Number($('monitor-minutes').value), alpha: Number($('monitor-alpha').value), paused: $('monitor-paused').checked } });
      $('monitor-message').textContent = 'Saved. Checks run every minute.';
      await request({ type: 'scan' });
      await recent();
    } catch (error) { $('monitor-message').textContent = error.message; }
  });
  $('import-data').addEventListener('change', async () => {
    try {
      const file = $('import-data').files[0]; if (!file) return;
      if (file.size > 10 * 1024 * 1024) throw new Error('Choose an export smaller than 10 MB.');
      await request({ type: 'import', data: JSON.parse(await file.text()) });
      announce('Tasks imported. Existing tasks and colors were preserved.');
    } catch (error) { announce(error.message); }
    $('import-data').value = '';
  });
}
