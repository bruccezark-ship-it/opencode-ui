const PATH_PATTERNS = [
  /path\s*:\s*['"`]([^'"`]+)['"`]/g,
  /path\s*=\s*['"`]([^'"`]+)['"`]/g,
  /<Route[^>]*\spath=["']([^"']+)["']/g,
];

export function normalizeRoutePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }

  const withLeading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  const withoutTrailing = withLeading.replace(/\/+$/, '');
  return withoutTrailing || '/';
}

export function isSitemapRoute(path: string): boolean {
  if (!path || path === '*') {
    return false;
  }

  return !(/[:*?]/.test(path));
}

/** 从路由文件内容中提取可用于 sitemap 的静态路径 */
export function parseRoutePaths(content: string): string[] {
  const paths = new Set<string>();

  for (const pattern of PATH_PATTERNS) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match) {
      const normalized = normalizeRoutePath(match[1]);
      if (isSitemapRoute(normalized)) {
        paths.add(normalized);
      }
      match = pattern.exec(content);
    }
  }

  if (!paths.has('/')) {
    paths.add('/');
  }

  return [...paths].sort((a, b) => a.localeCompare(b));
}
