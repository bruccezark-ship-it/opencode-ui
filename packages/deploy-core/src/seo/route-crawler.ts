import { launchHeadlessBrowser } from './browser-launcher.js';
import { extractCrawledPaths } from './link-extractor.js';
import { buildLocalUrl, waitForPageContent } from './page-renderer.js';

export interface CrawlSpaRoutesOptions {
  serverUrl: string;
  basePath?: string;
  startPaths?: string[];
  maxPages?: number;
  maxDepth?: number;
  onStatus?: (message: string) => void;
}

export interface CrawlSpaRoutesResult {
  routes: string[];
  htmlByRoute: Map<string, string>;
}

/** 是否为一级页面：/ 或单段路径如 /about */
export function isFirstLevelRoute(route: string): boolean {
  if (route === '/') {
    return true;
  }

  const segments = route.replace(/^\//, '').replace(/\/+$/, '').split('/').filter(Boolean);
  return segments.length === 1;
}

export async function crawlSpaRoutes(
  options: CrawlSpaRoutesOptions,
): Promise<CrawlSpaRoutesResult> {
  const {
    serverUrl,
    basePath = '/',
    startPaths = ['/'],
    maxPages = 50,
    maxDepth = 1,
    onStatus,
  } = options;

  const { chromium } = await import('playwright-core');
  onStatus?.('正在启动无头浏览器...');
  const browser = await launchHeadlessBrowser(chromium, { onStatus });
  const page = await browser.newPage();

  const htmlByRoute = new Map<string, string>();
  const visited = new Set<string>();
  const queue: Array<{ route: string; depth: number }> = [];

  for (const startPath of startPaths) {
    const route = startPath === '/' ? '/' : startPath.startsWith('/') ? startPath : `/${startPath}`;
    if (!visited.has(route)) {
      visited.add(route);
      queue.push({ route, depth: 0 });
    }
  }

  try {
    while (queue.length > 0 && htmlByRoute.size < maxPages) {
      const current = queue.shift();
      if (!current) {
        break;
      }

      const { route, depth } = current;
      const url = buildLocalUrl(serverUrl, route);
      onStatus?.(`爬取 ${route} (${htmlByRoute.size + 1}/${maxPages})...`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForPageContent(page);
      htmlByRoute.set(route, await page.content());

      if (depth >= maxDepth) {
        continue;
      }

      const hrefs = await page.$$eval('a[href]', (anchors) =>
        anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
      );
      const discovered = extractCrawledPaths(hrefs, page.url(), basePath);

      for (const nextRoute of discovered) {
        if (!isFirstLevelRoute(nextRoute)) {
          continue;
        }

        if (visited.has(nextRoute)) {
          continue;
        }

        visited.add(nextRoute);
        queue.push({ route: nextRoute, depth: depth + 1 });
      }
    }
  } finally {
    await browser.close();
  }

  const routes = [...htmlByRoute.keys()].sort((a, b) => a.localeCompare(b));
  if (routes.length === 1 && routes[0] === '/') {
    onStatus?.('未发现更多一级页面链接，sitemap 仅包含首页');
  } else {
    onStatus?.(`爬取完成，共发现 ${routes.length} 个一级页面`);
  }

  return { routes, htmlByRoute };
}
