import { describe, it, expect } from 'vitest';
import { routeToMdFileName } from './generator.js';

describe('routeToMdFileName', () => {
  it('maps root route to index.md', () => {
    expect(routeToMdFileName('/')).toBe('index.md');
  });

  it('maps flat routes to segment.md', () => {
    expect(routeToMdFileName('/contacts')).toBe('contacts.md');
    expect(routeToMdFileName('/about')).toBe('about.md');
  });

  it('preserves nested route paths', () => {
    expect(routeToMdFileName('/blog/post')).toBe('blog/post.md');
  });
});
