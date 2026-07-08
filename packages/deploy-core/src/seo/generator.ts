import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveViteBasePath } from '../detector/vite-project.js';
import { parseRoutePaths } from '../routes/parser.js';
import { parseRoutesFromPageFiles } from '../routes/pages-parser.js';
import { htmlToLlmMarkdown } from './html-to-md.js';
import { renderRoutePages } from './page-renderer.js';
import { crawlSpaRoutes } from './route-crawler.js';
import { resolveSpaFile, startSpaStaticServer } from './static-server.js';

export interface GenerateSeoOptions {
  projectRoot: string;
  outDir: string;
  baseUrl: string;
  routeFile?: string;
  pagesDir?: string;
  pageFiles?: string[];
  routes?: string[];
  htmlByRoute?: Map<string, string>;
  crawl?: boolean;
  crawlMaxPages?: number;
  crawlMaxDepth?: number;
  onStatus?: (message: string) => void;
}

export interface GenerateSeoResult {
  routes: string[];
  sitemapPath: string;
  robotsPath: string;
  mdFiles: string[];
  renderedWithBrowser: boolean;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function routeToPageUrl(baseUrl: string, routePath: string): string {
  if (routePath === '/') {
    return `${normalizeBaseUrl(baseUrl)}/`;
  }
  return `${normalizeBaseUrl(baseUrl)}${routePath}`;
}

/** 根据路由生成 LLM 友好的 md 文件名，如 / → index.md，/contacts → contacts.md */
export function routeToMdFileName(routePath: string): string {
  if (routePath === '/') {
    return 'index.md';
  }

  const segment = routePath.replace(/^\//, '').replace(/\/$/, '');
  return `${segment}.md`;
}

function buildSitemapXml(urls: string[]): string {
  const body = urls
    .map((url) => `  <url>\n    <loc>${escapeXml(url)}</loc>\n  </url>`)
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    body,
    '</urlset>',
    '',
  ].join('\n');
}

function buildRobotsTxt(sitemapUrl: string): string {
  return ['User-agent: *', 'Allow: /', `Sitemap: ${sitemapUrl}`, ''].join('\n');
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function hasDedicatedHtml(outDir: string, routePath: string): boolean {
  if (routePath === '/') {
    return existsSync(join(outDir, 'index.html'));
  }

  const segment = routePath.replace(/^\//, '').replace(/\/$/, '');
  return (
    existsSync(join(outDir, segment, 'index.html')) ||
    existsSync(join(outDir, `${segment}.html`))
  );
}

async function readStaticHtml(outDir: string, routePath: string): Promise<string | undefined> {
  try {
    const filePath = await resolveSpaFile(outDir, routePath === '/' ? '/' : routePath);
    return await readFile(filePath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function resolveRouteHtmlMap(
  projectRoot: string,
  outDir: string,
  routes: string[],
  onStatus?: (message: string) => void,
): Promise<{ htmlByRoute: Map<string, string>; renderedWithBrowser: boolean }> {
  const needsBrowser = routes.some((route) => route !== '/' && !hasDedicatedHtml(outDir, route));

  if (!needsBrowser) {
    const htmlByRoute = new Map<string, string>();
    for (const route of routes) {
      const html = await readStaticHtml(outDir, route);
      if (html) {
        htmlByRoute.set(route, html);
      }
    }
    return { htmlByRoute, renderedWithBrowser: false };
  }

  const viteBase = await resolveViteBasePath(projectRoot);
  const server = await startSpaStaticServer(outDir, viteBase);

  try {
    const htmlByRoute = await renderRoutePages({
      serverUrl: server.url,
      routes,
      onStatus,
    });
    return { htmlByRoute, renderedWithBrowser: true };
  } finally {
    await server.close();
  }
}

async function resolveRoutes(options: GenerateSeoOptions): Promise<string[]> {
  if (options.routes && options.routes.length > 0) {
    return options.routes;
  }

  if (options.pagesDir) {
    if (!options.pageFiles || options.pageFiles.length === 0) {
      throw new Error(`pages 目录 "${options.pagesDir}" 下未找到页面文件`);
    }
    return parseRoutesFromPageFiles(options.pagesDir, options.pageFiles);
  }

  if (options.routeFile) {
    const routeFilePath = join(options.projectRoot, options.routeFile);
    const content = await readFile(routeFilePath, 'utf-8');
    return parseRoutePaths(content);
  }

  throw new Error('未提供路由来源（routeFile、pagesDir、routes 或 crawl）');
}

async function crawlRoutesAndHtml(
  projectRoot: string,
  outDir: string,
  options: GenerateSeoOptions,
): Promise<{ routes: string[]; htmlByRoute: Map<string, string> }> {
  const viteBase = await resolveViteBasePath(projectRoot);
  const server = await startSpaStaticServer(outDir, viteBase);

  try {
    options.onStatus?.('正在通过浏览器爬取站内链接...');
    return await crawlSpaRoutes({
      serverUrl: server.url,
      basePath: viteBase,
      maxPages: options.crawlMaxPages,
      maxDepth: options.crawlMaxDepth,
      onStatus: options.onStatus,
    });
  } finally {
    await server.close();
  }
}

async function writeMarkdownFiles(
  routes: string[],
  htmlByRoute: Map<string, string>,
  outDir: string,
  baseUrl: string,
): Promise<string[]> {
  const mdFiles: string[] = [];

  for (const route of routes) {
    const html = htmlByRoute.get(route);
    if (!html) {
      continue;
    }

    const mdFileName = routeToMdFileName(route);
    const mdPath = join(outDir, mdFileName);
    await mkdir(join(mdPath, '..'), { recursive: true });
    const pageUrl = routeToPageUrl(baseUrl, route);
    await writeFile(mdPath, htmlToLlmMarkdown(html, pageUrl, route), 'utf-8');
    mdFiles.push(mdFileName);
  }

  return mdFiles;
}

export async function generateSeoArtifacts(options: GenerateSeoOptions): Promise<GenerateSeoResult> {
  const { projectRoot, outDir, baseUrl } = options;
  const sitemapUrl = `${normalizeBaseUrl(baseUrl)}/sitemap.xml`;
  const sitemapPath = join(outDir, 'sitemap.xml');
  const robotsPath = join(outDir, 'robots.txt');

  if (options.routes && options.htmlByRoute) {
    const routes = options.routes;
    const urls = routes.map((route) => routeToPageUrl(baseUrl, route));

    await writeFile(sitemapPath, buildSitemapXml(urls), 'utf-8');
    await writeFile(robotsPath, buildRobotsTxt(sitemapUrl), 'utf-8');

    const mdFiles = await writeMarkdownFiles(routes, options.htmlByRoute, outDir, baseUrl);

    return {
      routes,
      sitemapPath,
      robotsPath,
      mdFiles,
      renderedWithBrowser: true,
    };
  }

  if (options.crawl) {
    const { routes, htmlByRoute } = await crawlRoutesAndHtml(projectRoot, outDir, options);
    const urls = routes.map((route) => routeToPageUrl(baseUrl, route));

    await writeFile(sitemapPath, buildSitemapXml(urls), 'utf-8');
    await writeFile(robotsPath, buildRobotsTxt(sitemapUrl), 'utf-8');

    const mdFiles = await writeMarkdownFiles(routes, htmlByRoute, outDir, baseUrl);

    return {
      routes,
      sitemapPath,
      robotsPath,
      mdFiles,
      renderedWithBrowser: true,
    };
  }

  const routes = await resolveRoutes(options);
  const urls = routes.map((route) => routeToPageUrl(baseUrl, route));

  await writeFile(sitemapPath, buildSitemapXml(urls), 'utf-8');
  await writeFile(robotsPath, buildRobotsTxt(sitemapUrl), 'utf-8');

  const { htmlByRoute, renderedWithBrowser } = await resolveRouteHtmlMap(
    projectRoot,
    outDir,
    routes,
    options.onStatus,
  );

  const mdFiles = await writeMarkdownFiles(routes, htmlByRoute, outDir, baseUrl);

  return {
    routes,
    sitemapPath,
    robotsPath,
    mdFiles,
    renderedWithBrowser,
  };
}
