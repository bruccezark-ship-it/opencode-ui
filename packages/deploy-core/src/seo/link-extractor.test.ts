import { describe, it, expect } from 'vitest';
import {
  extractCrawledPaths,
  isCrawlableHref,
  normalizeCrawledPath,
} from './link-extractor.js';

const PAGE_URL = 'http://127.0.0.1:4173/';

describe('isCrawlableHref', () => {
  it('rejects empty, hash-only, and special protocols', () => {
    expect(isCrawlableHref('')).toBe(false);
    expect(isCrawlableHref('#')).toBe(false);
    expect(isCrawlableHref('#section')).toBe(false);
    expect(isCrawlableHref('mailto:a@b.com')).toBe(false);
    expect(isCrawlableHref('javascript:void(0)')).toBe(false);
  });

  it('accepts relative and absolute paths', () => {
    expect(isCrawlableHref('/about')).toBe(true);
    expect(isCrawlableHref('about')).toBe(true);
    expect(isCrawlableHref('http://127.0.0.1:4173/pricing')).toBe(true);
  });
});

describe('normalizeCrawledPath', () => {
  it('normalizes same-origin paths without query or hash', () => {
    expect(normalizeCrawledPath('/about', PAGE_URL)).toBe('/about');
    expect(normalizeCrawledPath('/about?q=1#top', PAGE_URL)).toBe('/about');
    expect(normalizeCrawledPath('pricing', PAGE_URL)).toBe('/pricing');
  });

  it('rejects external links and static assets', () => {
    expect(normalizeCrawledPath('https://example.com/x', PAGE_URL)).toBeUndefined();
    expect(normalizeCrawledPath('/app.js', PAGE_URL)).toBeUndefined();
    expect(normalizeCrawledPath('/logo.png', PAGE_URL)).toBeUndefined();
  });

  it('strips vite base path', () => {
    const basePageUrl = 'http://127.0.0.1:4173/app/';
    expect(normalizeCrawledPath('/app/about', basePageUrl, '/app')).toBe('/about');
    expect(normalizeCrawledPath('/app', basePageUrl, '/app')).toBe('/');
  });
});

describe('extractCrawledPaths', () => {
  it('deduplicates routes from multiple hrefs', () => {
    expect(
      extractCrawledPaths(['/', '/about', '/about#x', 'mailto:x'], PAGE_URL),
    ).toEqual(['/', '/about']);
  });
});
