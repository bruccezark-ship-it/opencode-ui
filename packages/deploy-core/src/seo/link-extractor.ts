import { isSitemapRoute, normalizeRoutePath } from '../routes/parser.js';

const NON_CRAWLABLE_PROTOCOLS = /^(mailto:|tel:|javascript:|data:|blob:)/i;

const STATIC_ASSET_EXTENSIONS = new Set([
  '.js',
  '.css',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.map',
  '.json',
  '.xml',
  '.pdf',
  '.zip',
  '.mp4',
  '.webm',
  '.md',
]);

function normalizeBasePath(basePath: string): string {
  if (!basePath || basePath === '/') {
    return '';
  }

  const trimmed = basePath.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function stripBasePath(pathname: string, basePath: string): string {
  const normalizedBase = normalizeBasePath(basePath);
  if (!normalizedBase) {
    return pathname || '/';
  }

  if (pathname === normalizedBase) {
    return '/';
  }

  if (pathname.startsWith(`${normalizedBase}/`)) {
    const stripped = pathname.slice(normalizedBase.length);
    return stripped || '/';
  }

  return pathname;
}

function hasStaticAssetExtension(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  const dotIndex = lower.lastIndexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  return STATIC_ASSET_EXTENSIONS.has(lower.slice(dotIndex));
}

/** 判断 href 是否值得进一步解析 */
export function isCrawlableHref(href: string | null | undefined): boolean {
  if (!href) {
    return false;
  }

  const trimmed = href.trim();
  if (!trimmed || trimmed === '#' || trimmed.startsWith('#')) {
    return false;
  }

  return !NON_CRAWLABLE_PROTOCOLS.test(trimmed);
}

/** 将页面上的 href 规范化为站内路由路径 */
export function normalizeCrawledPath(
  href: string,
  pageUrl: string,
  basePath = '/',
): string | undefined {
  if (!isCrawlableHref(href)) {
    return undefined;
  }

  let resolved: URL;
  try {
    resolved = new URL(href.trim(), pageUrl);
  } catch {
    return undefined;
  }

  const pageOrigin = new URL(pageUrl);
  if (resolved.origin !== pageOrigin.origin) {
    return undefined;
  }

  const pathname = stripBasePath(resolved.pathname, basePath);
  if (!pathname || hasStaticAssetExtension(pathname)) {
    return undefined;
  }

  const route = normalizeRoutePath(pathname);
  return isSitemapRoute(route) ? route : undefined;
}

/** 从 href 列表中提取可爬取的站内路由 */
export function extractCrawledPaths(
  hrefs: string[],
  pageUrl: string,
  basePath = '/',
): string[] {
  const routes = new Set<string>();

  for (const href of hrefs) {
    const route = normalizeCrawledPath(href, pageUrl, basePath);
    if (route) {
      routes.add(route);
    }
  }

  return [...routes];
}
