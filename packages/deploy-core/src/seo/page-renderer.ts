import type { Page } from 'playwright-core';
import { launchHeadlessBrowser } from './browser-launcher.js';

export function buildLocalUrl(serverUrl: string, routePath: string): string {
  const base = serverUrl.replace(/\/$/, '');
  if (routePath === '/') {
    return `${base}/`;
  }
  return `${base}${routePath.startsWith('/') ? routePath : `/${routePath}`}`;
}

export async function waitForPageContent(page: Page): Promise<void> {
  await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  await page.waitForTimeout(1500);
  await page.locator('main, #app, #root, body').first().waitFor({ state: 'attached', timeout: 5000 }).catch(() => undefined);
  await page.waitForTimeout(500);
}

/** 使用无头浏览器渲染各路由，抓取 SPA 页面最终 HTML */
export async function renderRoutePages(options: {
  serverUrl: string;
  routes: string[];
  onStatus?: (message: string) => void;
}): Promise<Map<string, string>> {
  const { chromium } = await import('playwright-core');
  const browser = await launchHeadlessBrowser(chromium, { onStatus: options.onStatus });
  const page = await browser.newPage();
  const results = new Map<string, string>();

  try {
    for (const route of options.routes) {
      const url = buildLocalUrl(options.serverUrl, route);
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForPageContent(page);
      results.set(route, await page.content());
    }
  } finally {
    await browser.close();
  }

  return results;
}
