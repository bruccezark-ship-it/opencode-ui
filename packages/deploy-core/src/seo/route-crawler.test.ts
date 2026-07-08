import { describe, it, expect } from 'vitest';
import { isFirstLevelRoute } from './route-crawler.js';

describe('isFirstLevelRoute', () => {
  it('accepts root and single-segment paths', () => {
    expect(isFirstLevelRoute('/')).toBe(true);
    expect(isFirstLevelRoute('/about')).toBe(true);
    expect(isFirstLevelRoute('/pricing/')).toBe(true);
  });

  it('rejects nested paths', () => {
    expect(isFirstLevelRoute('/about/team')).toBe(false);
    expect(isFirstLevelRoute('/blog/post')).toBe(false);
  });
});
