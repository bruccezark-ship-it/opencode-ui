import { describe, it, expect } from 'vitest';
import {
  pageRelativePathToRoute,
  parseRoutesFromPageFiles,
  parseManualRouteList,
} from './pages-parser.js';

describe('pageRelativePathToRoute', () => {
  it('maps index files to root', () => {
    expect(pageRelativePathToRoute('index.tsx')).toBe('/');
    expect(pageRelativePathToRoute('about/index.vue')).toBe('/about');
  });

  it('maps flat page files', () => {
    expect(pageRelativePathToRoute('about.vue')).toBe('/about');
    expect(pageRelativePathToRoute('blog/post.tsx')).toBe('/blog/post');
  });

  it('maps app router page files', () => {
    expect(pageRelativePathToRoute('dashboard/page.tsx')).toBe('/dashboard');
    expect(pageRelativePathToRoute('page.tsx')).toBe('/');
  });

  it('skips dynamic segments', () => {
    expect(pageRelativePathToRoute('user/[id].tsx')).toBeUndefined();
    expect(pageRelativePathToRoute('blog/[...slug].tsx')).toBeUndefined();
  });

  it('skips route groups but keeps static segments', () => {
    expect(pageRelativePathToRoute('(marketing)/about/page.tsx')).toBe('/about');
  });
});

describe('parseRoutesFromPageFiles', () => {
  it('collects routes from a pages directory', () => {
    const routes = parseRoutesFromPageFiles('src/pages', [
      'src/pages/index.tsx',
      'src/pages/about.vue',
      'src/pages/user/[id].tsx',
    ]);

    expect(routes).toEqual(['/', '/about']);
  });
});

describe('parseManualRouteList', () => {
  it('parses comma-separated routes', () => {
    expect(parseManualRouteList('/, /about, /pricing')).toEqual(['/', '/about', '/pricing']);
  });

  it('parses newline-separated routes', () => {
    expect(parseManualRouteList('/about\n/pricing')).toEqual(['/', '/about', '/pricing']);
  });

  it('filters dynamic routes', () => {
    expect(parseManualRouteList('/users/:id, /about')).toEqual(['/', '/about']);
  });

  it('defaults to root when empty', () => {
    expect(parseManualRouteList('')).toEqual(['/']);
  });
});
