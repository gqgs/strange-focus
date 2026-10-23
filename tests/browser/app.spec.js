import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.beforeEach(async ({ page }) => {
  // Keep tests deterministic and offline. The favicon test supplies a CORS image.
  await page.route('**/favicon.ico', route => route.abort());
});

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

test('attractor deletion confirms, removes completed tasks, and ends its session', async ({ page }) => {
  await page.goto('/');
  await add(page, 'example.com/a'); await add(page, 'example.com/b');
  await page.getByRole('button', { name: 'Complete b', exact: true }).click();
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await page.getByRole('button', { name: 'Start focus' }).click();
  await page.getByRole('button', { name: 'Settings for example.com', exact: true }).click();
  await page.getByRole('button', { name: 'Delete…', exact: true }).click();
  await expect(page.locator('#delete-attractor-description')).toContainText('all 2 tasks');
  await expect(page.locator('#delete-attractor-description')).toContainText('end its current session');
  await page.getByRole('button', { name: 'Keep attractor', exact: true }).click();
  await expect(page.locator('.attractor-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Settings for example.com', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Settings for example.com', exact: true }).click();
  await page.getByRole('button', { name: 'Delete…', exact: true }).click();
  await page.getByRole('button', { name: 'Delete attractor', exact: true }).click();
  expect((await saved(page)).timer).toBeNull();
  await page.reload();
  await expect(page.locator('.attractor-card')).toHaveCount(0);
  expect((await saved(page)).tasks).toEqual([]);
});

test('task dots move, respect reduced motion, and stay centered after selection', async ({ page }) => {
  await page.goto('/');
  await add(page, 'example.com/a'); await add(page, 'example.com/b');
  const art = page.locator('#focus-art');
  await expect(art.locator('.task-orbit-dot')).toHaveCount(2);
  const before = await art.boundingBox();
  const dot = art.locator('.task-orbit-dot').first();
  const start = await dot.getAttribute('cx');
  await expect.poll(() => dot.getAttribute('cx')).not.toBe(start);
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  const after = await art.boundingBox();
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  const card = await page.locator('.focus-card').boundingBox();
  expect(Math.abs(after.x + after.width / 2 - card.x - card.width / 2)).toBeLessThan(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const stopped = await dot.getAttribute('cx');
  await page.waitForTimeout(150);
  expect(await dot.getAttribute('cx')).toBe(stopped);
  await page.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect(art.locator('.task-orbit-dot')).toHaveCount(1);
});

test('favicon color is extracted, saved, and manually overridable', async ({ page }) => {
  // Playwright auto-aborts bare /favicon.ico requests before route handlers.
  // A test-only query allows a real cross-origin image response to be mocked.
  await page.addInitScript(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, options) => {
      const url = new URL(String(input), location.href);
      if (url.pathname === '/favicon.ico') url.searchParams.set('playwright-fixture', '1');
      return originalFetch(url, options);
    };
  });
  await page.goto('/');
  const icon = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 16;
    const context = canvas.getContext('2d'); context.fillStyle = '#ff0000'; context.fillRect(0, 0, 16, 16);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await page.route('https://example.com/favicon.ico?playwright-fixture=1', route => route.fulfill({ status: 200, contentType: 'image/png', headers: { 'access-control-allow-origin': '*' }, body: Buffer.from(icon, 'base64') }));
  await add(page, 'https://example.com/private-path?secret=only-in-browser');
  await expect.poll(async () => (await saved(page)).attractors[0].faviconChecked).toBe(true);
  const color = (await saved(page)).attractors[0].color;
  expect(color.slice(3)).toBe('0000');
  await page.reload();
  await page.getByRole('button', { name: 'Settings for example.com', exact: true }).click();
  await expect(page.getByLabel('Custom color picker')).toHaveValue(color);
  await page.getByLabel('Hex color', { exact: true }).fill('#126f60');
  await page.getByRole('button', { name: 'Save custom color' }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Settings for example.com', exact: true }).click();
  await expect(page.getByLabel('Custom color picker')).toHaveValue('#126f60');
  await page.getByRole('button', { name: 'Use automatic color' }).click();
  expect((await saved(page)).attractors[0].color).toBe(color);
  expect((await saved(page)).attractors[0].customColor).toBeUndefined();
});


test('theme follows system until chosen, then persists without affecting tasks', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await add(page, 'example.com/theme-test');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  await page.getByRole('button', { name: 'Start focus' }).click();
  const deadline = (await saved(page)).timer.endAt;
  await page.getByRole('button', { name: 'Switch to light theme' }).click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await saved(page)).timer.endAt).toBe(deadline);
  await page.getByRole('button', { name: 'Switch to dark theme' }).click();
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: testInfo.outputPath('dark-workspace.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('custom color validation, exact persistence, and dialog keyboard behavior', async ({ page }) => {
  await page.goto('/'); await add(page, 'example.com/colors');
  const button = page.getByRole('button', { name: 'Settings for example.com', exact: true });
  await button.focus(); await page.keyboard.press('Enter');
  await page.getByLabel('Hex color', { exact: true }).fill('oops');
  await page.getByRole('button', { name: 'Save custom color' }).click();
  await expect(page.locator('#color-error')).toContainText('six-digit hex');
  await page.getByLabel('Hex color', { exact: true }).fill('#ffff00');
  await page.getByRole('button', { name: 'Save custom color' }).click();
  await expect(button).toBeFocused();
  expect((await saved(page)).attractors[0].customColor).toBe('#ffff00');
  await page.reload(); await button.click();
  await expect(page.getByLabel('Custom color picker')).toHaveValue('#ffff00');
  await page.keyboard.press('Escape'); await expect(button).toBeFocused();
  await button.click(); await page.getByRole('button', { name: 'Use automatic color' }).click();
  expect((await saved(page)).attractors[0].customColor).toBeUndefined();
});

test('both themes and attractor dialogs meet accessibility checks', async ({ page }, testInfo) => {
  await page.goto('/'); await add(page, 'example.com/accessibility');
  await page.getByRole('button', { name: 'Pick a task', exact: true }).click();
  const check = async () => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(results.violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => ({ target: node.target, summary: node.failureSummary })) }))).toEqual([]);
  };
  for (const theme of ['light', 'dark']) {
    if (theme === 'dark') await page.getByRole('button', { name: 'Switch to dark theme' }).click();
    await check();
    await page.getByRole('button', { name: 'Settings for example.com', exact: true }).click();
    await check();
    await page.screenshot({ path: testInfo.outputPath(`${theme}-attractor-settings.png`) });
    await page.getByRole('button', { name: 'Delete…', exact: true }).click();
    await check();
    await page.getByRole('button', { name: 'Keep attractor', exact: true }).click();
  }
});
