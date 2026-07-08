import fg from 'fast-glob';

const ROUTER_GLOB_PATTERNS = [
  'src/router/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'src/routes/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'src/**/routes.{ts,tsx,js,jsx,mjs,cjs}',
  'src/**/router.{ts,tsx,js,jsx,mjs,cjs}',
  'router/**/*.{ts,tsx,js,jsx,mjs,cjs}',
  'routes/**/*.{ts,tsx,js,jsx,mjs,cjs}',
];

const PAGES_GLOB_PATTERNS = [
  'src/pages/**/*.{tsx,jsx,vue,ts,js,mjs,cjs}',
  'pages/**/*.{tsx,jsx,vue,ts,js,mjs,cjs}',
  'app/**/page.{tsx,jsx,ts,js,mjs,cjs}',
  'src/views/**/*.{vue,tsx,jsx}',
];

const PAGES_DIR_ROOTS = ['src/pages', 'pages', 'app', 'src/views'] as const;

const IGNORE = ['**/node_modules/**', '**/dist/**', '**/.git/**', '**/coverage/**'];

export type RouteSourceCandidate =
  | { kind: 'routerFile'; path: string }
  | { kind: 'pagesDir'; dir: string; files: string[] };

function normalizePath(file: string): string {
  return file.replace(/\\/g, '/');
}

function resolvePagesDirForFile(file: string): string | undefined {
  const normalized = normalizePath(file);

  for (const root of PAGES_DIR_ROOTS) {
    const prefix = `${root}/`;
    if (normalized.startsWith(prefix) || normalized === root) {
      return root;
    }
  }

  return undefined;
}

function groupPageFiles(pageFiles: string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const file of pageFiles) {
    const dir = resolvePagesDirForFile(file);
    if (!dir) {
      continue;
    }

    const existing = groups.get(dir);
    if (existing) {
      existing.push(file);
    } else {
      groups.set(dir, [file]);
    }
  }

  return groups;
}

/** 扫描 Vite 项目中可能的路由定义文件（router 风格，兼容旧 API） */
export async function discoverRouteFiles(projectRoot: string): Promise<string[]> {
  const matches = await fg(ROUTER_GLOB_PATTERNS, {
    cwd: projectRoot,
    absolute: false,
    ignore: IGNORE,
    onlyFiles: true,
    followSymbolicLinks: true,
  });

  const normalized = [...new Set(matches.map(normalizePath))];
  normalized.sort((a, b) => a.localeCompare(b));
  return normalized;
}

/** 扫描 router 文件与 pages 目录两类路由源 */
export async function discoverRouteSources(projectRoot: string): Promise<RouteSourceCandidate[]> {
  const [routerFiles, pageFiles] = await Promise.all([
    fg(ROUTER_GLOB_PATTERNS, {
      cwd: projectRoot,
      absolute: false,
      ignore: IGNORE,
      onlyFiles: true,
      followSymbolicLinks: true,
    }),
    fg(PAGES_GLOB_PATTERNS, {
      cwd: projectRoot,
      absolute: false,
      ignore: IGNORE,
      onlyFiles: true,
      followSymbolicLinks: true,
    }),
  ]);

  const candidates: RouteSourceCandidate[] = [];

  for (const file of [...new Set(routerFiles.map(normalizePath))].sort((a, b) =>
    a.localeCompare(b),
  )) {
    candidates.push({ kind: 'routerFile', path: file });
  }

  const pageGroups = groupPageFiles([...new Set(pageFiles.map(normalizePath))]);
  for (const [dir, files] of [...pageGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    candidates.push({
      kind: 'pagesDir',
      dir,
      files: files.sort((a, b) => a.localeCompare(b)),
    });
  }

  return candidates;
}
