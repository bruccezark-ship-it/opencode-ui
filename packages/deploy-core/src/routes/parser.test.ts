import { describe, it, expect } from 'vitest';
import { parseRoutePaths, normalizeRoutePath, isSitemapRoute } from './parser.js';

describe('parseRoutePaths', () => {
  it('extracts vue-router style paths', () => {
    const content = `
      const routes = [
        { path: '/', component: Home },
        { path: '/about', component: About },
        { path: '/users/:id', component: User },
      ];
    `;

    expect(parseRoutePaths(content)).toEqual(['/', '/about']);
  });

  it('extracts react-router jsx paths', () => {
    const content = `
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/pricing" element={<Pricing />} />
      </Routes>
    `;

    expect(parseRoutePaths(content)).toEqual(['/', '/pricing']);
  });

  it('always includes root path', () => {
    expect(parseRoutePaths(`export default [{ path: '/docs' }];`)).toEqual(['/', '/docs']);
  });
});

describe('normalizeRoutePath', () => {
  it('normalizes paths', () => {
    expect(normalizeRoutePath('about')).toBe('/about');
    expect(normalizeRoutePath('/about/')).toBe('/about');
    expect(normalizeRoutePath('/')).toBe('/');
  });
});

describe('isSitemapRoute', () => {
  it('skips dynamic routes', () => {
    expect(isSitemapRoute('/users/:id')).toBe(false);
    expect(isSitemapRoute('/about')).toBe(true);
  });
});
