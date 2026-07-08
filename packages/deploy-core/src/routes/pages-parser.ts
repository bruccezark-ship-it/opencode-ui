import { isSitemapRoute, normalizeRoutePath } from './parser.js';

const PAGE_EXTENSIONS = /\.(tsx|jsx|vue|ts|js|mjs|cjs)$/;

/** 判断路径段是否为路由组（如 (marketing)） */
function isRouteGroupSegment(segment: string): boolean {
  return segment.startsWith('(') && segment.endsWith(')');
}

/** 判断路径段是否含动态路由标记 */
function isDynamicSegment(segment: string): boolean {
  return /[[\]:*?]/.test(segment);
}

/** 从 pages 目录下的相对文件路径推断 sitemap 路由 */
export function pageRelativePathToRoute(relativePath: string): string | undefined {
  const normalized = relativePath.replace(/\\/g, '/');
  let withoutExt = normalized.replace(PAGE_EXTENSIONS, '');

  // app router: foo/page -> foo; standalone page -> root
  if (withoutExt === 'page') {
    return '/';
  }
  if (withoutExt.endsWith('/page')) {
    withoutExt = withoutExt.slice(0, -'/page'.length);
  }

  if (!withoutExt || withoutExt === 'index') {
    return '/';
  }

  const segments = withoutExt.split('/').filter(Boolean);
  const staticSegments: string[] = [];

  for (const segment of segments) {
    if (isRouteGroupSegment(segment)) {
      continue;
    }
    if (isDynamicSegment(segment)) {
      return undefined;
    }
    staticSegments.push(segment);
  }

  if (staticSegments.length === 0) {
    return '/';
  }

  if (staticSegments[staticSegments.length - 1] === 'index') {
    staticSegments.pop();
  }

  if (staticSegments.length === 0) {
    return '/';
  }

  const route = normalizeRoutePath(`/${staticSegments.join('/')}`);
  return isSitemapRoute(route) ? route : undefined;
}

/** 从 pages 目录与文件列表推断全部静态路由 */
export function parseRoutesFromPageFiles(pagesDir: string, files: string[]): string[] {
  const normalizedDir = pagesDir.replace(/\\/g, '/').replace(/\/+$/, '');
  const routes = new Set<string>();

  for (const file of files) {
    const normalizedFile = file.replace(/\\/g, '/');
    const prefix = `${normalizedDir}/`;
    if (!normalizedFile.startsWith(prefix)) {
      continue;
    }

    const relative = normalizedFile.slice(prefix.length);
    const route = pageRelativePathToRoute(relative);
    if (route) {
      routes.add(route);
    }
  }

  if (!routes.has('/')) {
    routes.add('/');
  }

  return [...routes].sort((a, b) => a.localeCompare(b));
}

/** 解析用户手动输入的路由列表（逗号或换行分隔） */
export function parseManualRouteList(input: string): string[] {
  const parts = input
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const routes = new Set<string>();

  for (const part of parts) {
    const normalized = normalizeRoutePath(part);
    if (isSitemapRoute(normalized)) {
      routes.add(normalized);
    }
  }

  if (routes.size === 0) {
    routes.add('/');
  } else if (!routes.has('/')) {
    routes.add('/');
  }

  return [...routes].sort((a, b) => a.localeCompare(b));
}
