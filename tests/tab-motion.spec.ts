import { test, expect } from '@playwright/test';

test('tabs stay mounted and indicator glides without native tooltip boxes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.evaluate(() => { (window as any).__firstTab = document.querySelector('.tab-select'); });
  const first = page.getByRole('tab', { name: '随手记.md', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as any).__firstTab === document.querySelector('.tab-select'))).toBe(true);
  await expect(first).not.toHaveAttribute('title');
  await first.hover();
  expect(await first.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  const indicator = page.locator('.tab-indicator');
  await expect.poll(() => indicator.evaluate(el => Math.abs(el.getBoundingClientRect().left - document.querySelector('.document-tab.active')!.getBoundingClientRect().left))).toBeLessThan(1);
  expect(await indicator.evaluate(el => getComputedStyle(el).transitionProperty)).toContain('transform');
  expect(await indicator.evaluate(el => getComputedStyle(el).transitionDuration)).toContain('0.18s');
  const second = page.getByRole('tab', { name: '未命名 1.md', exact: true });
  await second.click();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => indicator.evaluate(el => {
    const a = el.getBoundingClientRect(), b = document.querySelector('.document-tab.active')!.getBoundingClientRect();
    return Math.abs(a.left - b.left) + Math.abs(a.width - b.width);
  })).toBeLessThan(2);
  await page.screenshot({ path: 'test-results/tabs-v101.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(second).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('reduced-motion disables tab and document transitions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  await expect(page.getByRole('tab')).toHaveCount(2);
  const first = page.getByRole('tab', { name: '随手记.md', exact: true });
  await first.click();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  expect(await page.locator('.tab-indicator').evaluate(el => getComputedStyle(el).transitionDuration)).toBe('0s');
  expect(await page.locator('#surface').evaluate(el => el.getAnimations().length)).toBe(0);
});
