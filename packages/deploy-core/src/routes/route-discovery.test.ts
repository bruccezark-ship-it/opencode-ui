import { describe, it, expect } from 'vitest';
import {
  formatRouteDiscoverySummary,
  pickDefaultRouteDiscoveryOption,
  shouldSkipBrowserRendering,
  shouldUseBrowserRouteDiscovery,
  type RouteDiscoveryOption,
} from './route-discovery.js';

function makeOption(
  partial: Pick<RouteDiscoveryOption, 'id' | 'label' | 'method' | 'routes' | 'source'>,
): RouteDiscoveryOption {
  return {
    htmlByRoute: undefined,
    ...partial,
  };
}

describe('pickDefaultRouteDiscoveryOption', () => {
  const routerOption = makeOption({
    id: 'router:src/router/index.ts',
    label: '路由文件: src/router/index.ts',
    method: 'routerFile',
    routes: ['/', '/about'],
    source: { kind: 'file', path: 'src/router/index.ts' },
  });
  const pagesOption = makeOption({
    id: 'pages:src/pages',
    label: 'Pages 目录: src/pages/',
    method: 'pagesDir',
    routes: ['/', '/blog'],
    source: { kind: 'pages', dir: 'src/pages', files: ['src/pages/index.tsx'] },
  });
  const crawlOption = makeOption({
    id: 'crawl',
    label: '浏览器爬取链接',
    method: 'crawl',
    routes: ['/', '/about', '/pricing'],
    source: { kind: 'routes', routes: ['/', '/about', '/pricing'] },
  });

  it('prefers configured route file match', () => {
    expect(
      pickDefaultRouteDiscoveryOption(
        [pagesOption, routerOption, crawlOption],
        'src/router/index.ts',
      ),
    ).toBe(routerOption);
  });

  it('falls back to router, pages, then crawl', () => {
    expect(pickDefaultRouteDiscoveryOption([pagesOption, crawlOption])).toBe(pagesOption);
    expect(pickDefaultRouteDiscoveryOption([crawlOption])).toBe(crawlOption);
  });
});

describe('formatRouteDiscoverySummary', () => {
  it('includes label, count, and route preview', () => {
    const summary = formatRouteDiscoverySummary(
      makeOption({
        id: 'crawl',
        label: '浏览器爬取链接',
        method: 'crawl',
        routes: ['/', '/about', '/pricing'],
        source: { kind: 'routes', routes: ['/', '/about', '/pricing'] },
      }),
    );

    expect(summary).toContain('浏览器爬取链接');
    expect(summary).toContain('3 条');
    expect(summary).toContain('/, /about, /pricing');
  });
});

describe('browser route discovery helpers', () => {
  const routerOption = makeOption({
    id: 'router:src/router/index.ts',
    label: '路由文件: src/router/index.ts',
    method: 'routerFile',
    routes: ['/', '/about'],
    source: { kind: 'file', path: 'src/router/index.ts' },
  });
  const pagesOption = makeOption({
    id: 'pages:src/pages',
    label: 'Pages 目录: src/pages/',
    method: 'pagesDir',
    routes: ['/', '/blog'],
    source: { kind: 'pages', dir: 'src/pages', files: ['src/pages/index.tsx'] },
  });
  const crawlOption = makeOption({
    id: 'crawl',
    label: '浏览器爬取链接',
    method: 'crawl',
    routes: ['/', '/about'],
    source: { kind: 'routes', routes: ['/', '/about'] },
  });

  it('skips browser only for router file selection', () => {
    expect(shouldUseBrowserRouteDiscovery(routerOption)).toBe(false);
    expect(shouldUseBrowserRouteDiscovery(pagesOption)).toBe(true);
    expect(shouldUseBrowserRouteDiscovery(crawlOption)).toBe(true);
    expect(shouldUseBrowserRouteDiscovery(undefined)).toBe(true);
  });

  it('skips browser rendering only for router file selection', () => {
    expect(shouldSkipBrowserRendering(routerOption)).toBe(true);
    expect(shouldSkipBrowserRendering(pagesOption)).toBe(false);
    expect(shouldSkipBrowserRendering(crawlOption)).toBe(false);
  });
});
