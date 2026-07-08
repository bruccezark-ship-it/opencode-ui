import { describe, it, expect } from 'vitest';
import { getContentType, getCacheControl } from './mime.js';

describe('mime', () => {
  it('returns correct content types', () => {
    expect(getContentType('app.js')).toBe('application/javascript');
    expect(getContentType('style.css')).toBe('text/css');
    expect(getContentType('index.html')).toBe('text/html');
  });

  it('returns no-cache for html', () => {
    expect(getCacheControl('index.html')).toContain('no-cache');
  });

  it('returns long cache for hashed assets', () => {
    expect(getCacheControl('assets/index-a1b2c3d4.js')).toContain('immutable');
  });
});
