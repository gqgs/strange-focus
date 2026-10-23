import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const saved = page => page.evaluate(() => JSON.parse(localStorage.getItem('strange-focus:v1')));
async function add(page, url) {
  await page.getByLabel('Add a task', { exact: true }).fill(url);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
}
async function choose(page, domain) { await page.getByRole('button', { name: new RegExp(`^${domain.replaceAll('.', '\\.')}.*, \\d+ pending tasks$`) }).click(); }
async function settings(page, focus, rest) {
  await page.getByRole('button', { name: 'Timer settings' }).click();
  await page.getByLabel('Focus duration').fill(String(focus));
  await page.getByLabel('Break duration').fill(String(rest));
  await page.getByRole('button', { name: 'Save durations' }).click();
}

test('add, group, draw, open, complete, reload and reopen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Pick a task', exact: true })).toBeDisabled();
  await add(page, 'https://www.github.com/acme/strange-focus/issues/42');
  await add(page, 'https://docs.google.com/document/d/a');
  await add(page, 'https://drive.google.com/file/d/b');
  await expect(page.locator('.attractor-card')).toHaveCount(3);
  await choose(page, 'github.com');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', 'https://www.github.com/acme/strange-focus/issues/42');
  await expect(page.getByRole('link', { name: 'Open task' })).toHaveAttribute('target', '_blank');
  await page.getByRole('button', { name: 'Start focus' }).click();
  await expect(page.getByRole('button', { name: 'Pick again', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect(page.locator('#done-count')).toHaveText('1');
  await page.reload();
  await expect(page.locator('#done-count')).toHaveText('1');
  await page.getByRole('button', { name: /^Done 1$/ }).click();
  await page.getByRole('button', { name: 'Reopen acme/strange-focus/issues/42', exact: true }).click();
  await page.getByRole('button', { name: /^To do 1$/ }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  expect((await saved(page)).timer).toBeNull();
  expect(errors).toEqual([]);
});

test('validation, duplicate completion recovery and task deletion', async ({ page }) => {
  await page.goto('/');
  await add(page, 'javascript:alert(1)');
  await expect(page.locator('#url-error')).toHaveText('Use an http:// or https:// link.');
  await add(page, 'example.com/read?a=1#notes');
  await add(page, 'https://EXAMPLE.com:443/read?a=1#notes');
  await expect(page.locator('#url-error')).toContainText('already in your task collection');
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Complete read?a=1#notes', exact: true }).click();
  await add(page, 'example.com/read?a=1#notes');
  await page.getByRole('button', { name: 'Reopen task', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete read?a=1#notes', exact: true }).click();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pick a task', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await expect(page.locator('.attractor-card')).toHaveCount(1);
});

test('adjustable timer, pause and running/paused reload recovery', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
  await page.goto('/');
  await add(page, 'example.com/work');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await settings(page, 2, 1);
  await expect(page.locator('#timer-value')).toHaveText('02:00');
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.clock.fastForward(15_000);
  await page.getByRole('button', { name: 'Pause session' }).click();
  const paused = await page.locator('#timer-value').textContent();
  await page.clock.fastForward(30_000);
  await expect(page.locator('#timer-value')).toHaveText(paused);
  await page.reload();
  await expect(page.locator('#timer-value')).toHaveText(paused);
  await expect(page.getByRole('button', { name: 'Resume session' })).toBeVisible();
  await page.getByRole('button', { name: 'Resume session' }).click();
  const deadline = (await saved(page)).timer.endAt;
  await page.reload();
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeVisible();
  expect((await saved(page)).timer.endAt).toBe(deadline);
  await settings(page, 3, 2);
  expect((await saved(page)).timer.durationMs).toBe(120_000);
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.locator('#timer-value')).toHaveText('03:00');
  await page.reload();
  expect((await saved(page)).settings).toEqual({ focusMinutes: 3, breakMinutes: 2 });
});

test('expiry never auto-completes tasks or automatically starts breaks', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-22T12:00:00Z') });
  await page.goto('/');
  await add(page, 'example.com/work');
  await settings(page, 1, 1);
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.clock.fastForward(61_000);
  await expect(page.locator('#timer-value')).toHaveText('00:00');
  expect((await saved(page)).timer.status).toBe('finished');
  expect((await saved(page)).tasks[0].status).toBe('pending');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start short break' })).toBeVisible();
  await page.getByRole('button', { name: 'Start short break' }).click();
  await page.clock.fastForward(61_000);
  await expect(page.getByRole('button', { name: 'Back to focus' })).toBeVisible();
  expect((await saved(page)).timer.status).toBe('finished');
  expect((await saved(page)).tasks[0].status).toBe('pending');
});

test('an elapsed deadline is recovered after the app was closed', async ({ page }) => {
  await page.goto('/');
  await add(page, 'example.com/work');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('strange-focus:v1'));
    state.timer.endAt = Date.now() - 10_000;
    localStorage.setItem('strange-focus:v1', JSON.stringify(state));
  });
  await page.reload();
  await expect(page.locator('#timer-value')).toHaveText('00:00');
  await expect(page.getByRole('button', { name: 'Start short break' })).toBeVisible();
  expect((await saved(page)).tasks[0].status).toBe('pending');
});

test('corrupt storage is preserved until explicit reset', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('strange-focus:v1', '{broken'));
  await page.reload();
  await expect(page.locator('#storage-warning')).toBeVisible();
  await add(page, 'example.com/temporary');
  expect(await page.evaluate(() => localStorage.getItem('strange-focus:v1'))).toBe('{broken');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Reset saved data' }).click();
  await expect(page.locator('#storage-warning')).toBeHidden();
  await expect(page.locator('.task-row')).toHaveCount(0);
  await add(page, 'example.com/saved');
  await page.reload();
  await expect(page.locator('.task-row')).toHaveCount(1);
});

test('unavailable browser storage keeps the app usable in memory', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Denied', 'SecurityError'); } }); });
  await page.goto('/');
  await expect(page.locator('#storage-warning')).toBeVisible();
  await add(page, 'example.com/temporary');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Open task' })).toHaveAttribute('href', 'https://example.com/temporary');
  await expect(page.locator('.local-badge')).toContainText('Temporary session');
});

test('responsive layout, long URLs, keyboard controls and screenshots', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('empty-workspace.png'), fullPage: true });
  await add(page, 'github.com/acme/strange-focus/issues/42');
  await add(page, 'github.com/acme/strange-focus/pull/18');
  await add(page, 'docs.google.com/document/d/project-notes');
  await add(page, 'figma.com/design/interface-explorations');
  await choose(page, 'github.com');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'Open task' })).toBeVisible();
  await expect(page.locator('#toast')).toBeHidden({ timeout: 6000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });
  await page.getByRole('button', { name: 'Timer settings' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Timer settings' })).toBeFocused();
  await add(page, `https://a-very-long-subdomain.a-long-example-domain.com/${'a-very-long-task-path-'.repeat(20)}?query=%3Cimg%20src=x%3E`);
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  expect(await page.locator('img').count()).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (testInfo.project.name === 'mobile') {
    await page.setViewportSize({ width: 320, height: 640 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test('accessible empty, populated and settings states', async ({ page }) => {
  await page.goto('/');
  const check = async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  };
  await check();
  await add(page, 'example.com/work');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await check();
  await page.getByRole('button', { name: 'Timer settings' }).click();
  await check();
});
