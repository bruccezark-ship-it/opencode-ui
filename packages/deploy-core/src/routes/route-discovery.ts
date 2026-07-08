import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveViteBasePath } from '../detector/vite-project.js';
import { discoverRouteSources } from './discovery.js';
import { parseRoutesFromPageFiles } from './pages-parser.js';
import { parseRoutePaths } from './parser.js';
import { crawlSpaRoutes } from '../seo/route-crawler.js';
import { startSpaStaticServer } from '../seo/static-server.js';
import type { DeployConfig, ResolvedRouteSource } from '../config/schema.js';

export type RouteDiscoveryMethod = 'routerFile' | 'pagesDir' | 'crawl';

export interface RouteDiscoveryOption {
  id: string;
  label: string;
  method: RouteDiscoveryMethod;
  routes: string[];
  source: ResolvedRouteSource;
  htmlByRoute?: Map<string, string>;
}

export interface CollectRouteDiscoveryOptions {
  projectRoot: string;
  outDir: string;
  config: DeployConfig;
  onStatus?: (message: string) => void;
}

function formatRoutePreview(routes: string[], max = 6): string {
  if (routes.length === 0) {
    return '(无)';
  }

  const preview = routes.slice(0, max).join(', ');
  return routes.length > max ? `${preview}, ... (+${routes.length - max})` : preview;
}

export function formatRouteDiscoverySummary(option: RouteDiscoveryOption): string {
  return `${option.label} (${option.routes.length} 条): ${formatRoutePreview(option.routes)}`;
}

export function pickDefaultRouteDiscoveryOption(
  options: RouteDiscoveryOption[],
  configuredRouteFile?: string,
): RouteDiscoveryOption | undefined {
  if (options.length === 0) {
    return undefined;
  }

  if (configuredRouteFile) {
    const normalized = configuredRouteFile.replace(/\\/g, '/');
    const configuredMatch = options.find((option) => {
      if (option.method === 'routerFile' && option.source.kind === 'file') {
        return option.source.path === normalized;
      }

      if (option.method === 'pagesDir' && option.source.kind === 'pages') {
        return (
          normalized === option.source.dir ||
          normalized.startsWith(`${option.source.dir}/`)
        );
      }

      return false;
    });

    if (configuredMatch) {
      return configuredMatch;
    }
  }

  const routerOption = options.find((option) => option.method === 'routerFile');
  if (routerOption) {
    return routerOption;
  }

  const pagesOption = options.find((option) => option.method === 'pagesDir');
  if (pagesOption) {
    return pagesOption;
  }

  const crawlOption = options.find((option) => option.method === 'crawl');
  if (crawlOption) {
    return crawlOption;
  }

  return options[0];
}

/** 汇总各方式发现的路由表（构建完成后调用，含浏览器爬取） */
export async function collectRouteDiscoveryResults(
  options: CollectRouteDiscoveryOptions,
): Promise<RouteDiscoveryOption[]> {
  const { projectRoot, outDir, config, onStatus } = options;
  const results: RouteDiscoveryOption[] = [];
  const candidates = await discoverRouteSources(projectRoot);

  for (const candidate of candidates) {
    if (candidate.kind === 'routerFile') {
      const content = await readFile(join(projectRoot, candidate.path), 'utf-8');
      const routes = parseRoutePaths(content);
      results.push({
        id: `router:${candidate.path}`,
        label: `路由文件: ${candidate.path}`,
        method: 'routerFile',
        routes,
        source: { kind: 'file', path: candidate.path },
      });
      continue;
    }

    const routes = parseRoutesFromPageFiles(candidate.dir, candidate.files);
    results.push({
      id: `pages:${candidate.dir}`,
      label: `Pages 目录: ${candidate.dir}/`,
      method: 'pagesDir',
      routes,
      source: { kind: 'pages', dir: candidate.dir, files: candidate.files },
    });
  }

  const viteBase = await resolveViteBasePath(projectRoot);
  const server = await startSpaStaticServer(outDir, viteBase);

  try {
    onStatus?.('正在通过浏览器爬取站内链接...');
    const { routes, htmlByRoute } = await crawlSpaRoutes({
      serverUrl: server.url,
      basePath: viteBase,
      maxPages: config.project.crawlMaxPages,
      maxDepth: config.project.crawlMaxDepth,
      onStatus,
    });

    results.push({
      id: 'crawl',
      label: '浏览器爬取链接',
      method: 'crawl',
      routes,
      source: { kind: 'routes', routes },
      htmlByRoute,
    });
  } finally {
    await server.close();
  }

  return results;
}

export function routeDiscoveryOptionToSeoInput(option: RouteDiscoveryOption): {
  routeFile?: string;
  pagesDir?: string;
  pageFiles?: string[];
  routes?: string[];
  htmlByRoute?: Map<string, string>;
  crawl?: boolean;
  crawlMaxPages?: number;
  crawlMaxDepth?: number;
} {
  if (option.htmlByRoute) {
    return {
      routes: option.routes,
      htmlByRoute: option.htmlByRoute,
    };
  }

  if (option.source.kind === 'file') {
    return { routeFile: option.source.path };
  }

  if (option.source.kind === 'pages') {
    return {
      pagesDir: option.source.dir,
      pageFiles: option.source.files,
    };
  }

  return { routes: option.routes };
}
