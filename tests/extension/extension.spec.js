import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';

let context, worker, ui, server, origin, directory;
const command = message => ui.evaluate(async message => {
  const response = await chrome.runtime.sendMessage(message);
  if (response.error) throw Error(response.error);
  return response.doc;
}, message);
async function age() {
  await worker.evaluate(() => { const original = Date.now; Date.now = () => original() + 120000; });
}
async function captured(page) {
  await age(); await command({ type: 'scan' });
  await expect.poll(() => page.isClosed()).toBe(true);
}
test.beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'strange-focus-extension-'));
  const extension = path.join(directory, 'extension');
  await cp('dist/extension', extension, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
  // Test-only grant: production requests exact domains from a user gesture.
  manifest.host_permissions = ['http://127.0.0.1/*', 'https://127.0.0.1/*'];
  await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><title>Reading intention</title><h1>Article</h1><input aria-label="Notes"><button>Interact</button>${req.url === '/warn' ? '<script>onbeforeunload=e=>{e.preventDefault();e.returnValue="unsaved"}</script>' : ''}`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  context = await chromium.launchPersistentContext(path.join(directory, 'profile'), { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/index.html`);
  await expect(ui.getByRole('button', { name: 'Add task', exact: true })).toBeVisible();
});
test.afterEach(async () => { await context?.close(); await new Promise(resolve => server?.close(resolve)); await rm(directory, { recursive: true, force: true }); });

test('disabled by default; monitoring captures, restores and re-attracts with history', async () => {
  expect((await command({ type: 'get' })).monitor.paused).toBe(true);
  const article = await context.newPage(); await article.goto(`${origin}/article`);
  await ui.bringToFront();
  await command({ type: 'scan' }); expect((await command({ type: 'get' })).workspace.tasks).toHaveLength(0);
  await command({ type: 'monitor', monitor: { domains: ['127.0.0.1'], minutes: 1, paused: false, alpha: 1 } });
  await command({ type: 'scan' });
  await captured(article);
  let doc = await command({ type: 'get' }); expect(doc.workspace.tasks).toHaveLength(1); expect(doc.recent).toHaveLength(1);
  const task = doc.workspace.tasks[0]; expect(task.title).toBe('Reading intention');
  const opened = context.waitForEvent('page'); await command({ type: 'open', id: task.id }); const restored = await opened; await restored.waitForLoadState();
  doc = await command({ type: 'get' }); expect(doc.workspace.tasks[0].lifecycle).toBe('reopened'); expect(doc.workspace.tasks[0].reopenCount).toBe(1);
  await ui.bringToFront(); await command({ type: 'scan' }); await captured(restored);
  doc = await command({ type: 'get' }); expect(doc.workspace.tasks).toHaveLength(1); expect(doc.workspace.tasks[0].reopenCount).toBe(1);
});

test('dirty forms and native unload warnings keep the original tab open', async () => {
  await command({ type: 'monitor', monitor: { domains: ['127.0.0.1'], minutes: 1, paused: false, alpha: 1 } });
  const dirty = await context.newPage(); await dirty.goto(`${origin}/dirty`); await dirty.getByLabel('Notes').fill('unfinished draft');
  const warned = await context.newPage(); await warned.goto(`${origin}/warn`); await warned.getByRole('button').click();
  let warnings = 0;
  warned.on('dialog', dialog => { warnings++; return dialog.dismiss(); });
  await ui.bringToFront(); await command({ type: 'scan' }); await age(); await command({ type: 'scan' });
  await expect.poll(() => warnings).toBe(1);
  await expect(dirty.getByLabel('Notes')).toHaveValue('unfinished draft'); expect(warned.isClosed()).toBe(false); expect(warned.url()).toBe(`${origin}/warn`);
});

test('workspace survives a worker stop and non-destructive import preserves settings', async () => {
  await ui.getByLabel('Add a task', { exact: true }).fill(`${origin}/saved`); await ui.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect.poll(async () => (await command({ type: 'get' })).workspace.tasks.length).toBe(1);
  const doc = await command({ type: 'get' });
  await worker.evaluate(() => { globalThis.restartSentinel = true; });
  const session = await context.newCDPSession(ui);
  const targets = (await session.send('Target.getTargets')).targetInfos;
  const target = targets.find(item => item.type === 'service_worker' && item.url === worker.url());
  await session.send('Target.closeTarget', { targetId: target.targetId });
  await ui.reload(); await expect(ui.locator('.task-row')).toHaveCount(1);
  await command({ type: 'import', data: doc.workspace });
  expect((await command({ type: 'get' })).workspace.tasks).toHaveLength(1);
});

test('monitoring controls persist opt-in configuration and global pause', async () => {
  await ui.getByText('Tab attraction settings', { exact: true }).click();
  await ui.getByLabel('Monitored domains (one per line)').fill('127.0.0.1');
  await ui.getByLabel('Attract after inactivity (minutes)').fill('3');
  await ui.getByLabel('Pause automatic attraction').uncheck();
  await ui.getByRole('button', { name: 'Save monitoring settings' }).click();
  await expect(ui.locator('#monitor-message')).toHaveText('Saved. Checks run every minute.');
  const doc = await command({ type: 'get' }); expect(doc.monitor.paused).toBe(false); expect(doc.monitor.minutes).toBe(3);
  await ui.getByLabel('Pause automatic attraction').check();
  await ui.getByRole('button', { name: 'Save monitoring settings' }).click();
  await expect.poll(async () => (await command({ type: 'get' })).monitor.paused).toBe(true);
  await ui.reload(); await ui.getByText('Tab attraction settings', { exact: true }).click();
  await expect(ui.getByLabel('Pause automatic attraction')).toBeChecked();
  await expect(ui.getByLabel('Attract after inactivity (minutes)')).toHaveValue('3');
  await ui.screenshot({ path: test.info().outputPath('extension-settings.png'), fullPage: true });
});

test('alarm monitoring recovers saved candidates after service worker termination', async () => {
  await command({ type: 'monitor', monitor: { domains: ['127.0.0.1'], minutes: 1, paused: false, alpha: 1 } });
  const article = await context.newPage(); await article.goto(`${origin}/recover`); await ui.bringToFront();
  await command({ type: 'scan' });
  const before = await command({ type: 'get' }); expect(Object.keys(before.candidates)).toHaveLength(1);
  const session = await context.newCDPSession(ui);
  await session.send('ServiceWorker.enable'); await session.send('ServiceWorker.stopAllWorkers');
  await command({ type: 'get' });
  worker = context.serviceWorkers().find(item => item.url().endsWith('/extension/worker.js')) ?? await context.waitForEvent('serviceworker');
  expect(Object.keys((await command({ type: 'get' })).candidates)).toHaveLength(1);
  expect(await worker.evaluate(() => globalThis.restartSentinel)).toBeUndefined();
  await age();
  await worker.evaluate(() => chrome.alarms.create('attract-tabs', { when: Date.now() - 120000 + 100 }));
  await expect.poll(() => article.isClosed(), { timeout: 10000 }).toBe(true);
  expect((await command({ type: 'get' })).workspace.tasks).toHaveLength(1);
});

test('failed workspace writes keep new tasks in memory and allow exporting them', async () => {
  await worker.evaluate(() => { chrome.storage.local.set = async () => { throw new Error('Storage quota exceeded'); }; });
  await ui.getByLabel('Add a task', { exact: true }).fill(`${origin}/unsaved`);
  await ui.getByRole('button', { name: 'Add task', exact: true }).click();
  await expect(ui.locator('#storage-warning')).toBeVisible();
  await expect(ui.locator('.task-row')).toHaveCount(1);
  const downloading = ui.waitForEvent('download');
  await ui.getByRole('button', { name: 'Export data' }).click();
  const file = await (await downloading).path();
  const exported = JSON.parse(await readFile(file, 'utf8'));
  expect(exported.workspace.tasks[0].url).toBe(`${origin}/unsaved`);
  expect((await command({ type: 'get' })).workspace.tasks).toHaveLength(0);
});

test('JSON file import migrates tasks, theme and colors into an empty collection', async () => {
  const source = {
    version: 1, settings: { focusMinutes: 35, breakMinutes: 7 }, theme: 'dark', mode: 'focus', timer: null,
    selectedTaskId: null, selectedAttractorId: 'example.com',
    attractors: [{ id: 'example.com', hostname: 'example.com', color: '#7254c8', customColor: '#123456' }],
    tasks: [{ id: 'old-task', url: 'https://example.com/read', attractorId: 'example.com', status: 'pending', createdAt: 100, completedAt: null }],
  };
  await ui.getByText('Tab attraction settings', { exact: true }).click();
  await ui.getByLabel('Choose a Strange Focus export').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(ui.locator('.task-row')).toHaveCount(1);
  const doc = await command({ type: 'get' });
  expect(doc.workspace.theme).toBe('dark'); expect(doc.workspace.settings.focusMinutes).toBe(35);
  expect(doc.workspace.attractors[0].customColor).toBe('#123456');
  await ui.getByLabel('Choose a Strange Focus export').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(source)) });
  await expect(ui.locator('#toast')).toContainText('Tasks imported');
  expect((await command({ type: 'get' })).workspace.tasks).toHaveLength(1);
});
