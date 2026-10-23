import { Engine } from './engine.js';
const engine = new Engine(chrome);
let queue = Promise.resolve();
function serial(action) {
  const result = queue.then(action);
  queue = result.catch(error => { console.error('Strange Focus:', error); });
  return result;
}
function scan() { return serial(() => engine.scan()); }
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('index.html'))) return false;
  serial(() => engine.command(message)).then(doc => respond({ doc }), error => respond({ error: error.message }));
  return true;
});
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('index.html');
  const existing = (await chrome.tabs.query({})).find(tab => tab.url === url);
  if (existing) { await chrome.tabs.update(existing.id, { active: true }); await chrome.windows.update(existing.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});
async function initialize() {
  if (!await chrome.alarms.get('attract-tabs')) await chrome.alarms.create('attract-tabs', { periodInMinutes: 1 });
  await scan();
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'attract-tabs') scan(); });
chrome.runtime.onInstalled.addListener(initialize);
chrome.runtime.onStartup.addListener(initialize);
chrome.tabs.onCreated.addListener(scan);
chrome.tabs.onRemoved.addListener(scan);
chrome.tabs.onActivated.addListener(scan);
chrome.tabs.onUpdated.addListener((id, change) => { if (change.url || change.status === 'complete' || 'audible' in change || 'pinned' in change) scan(); });
initialize().catch(console.error);
