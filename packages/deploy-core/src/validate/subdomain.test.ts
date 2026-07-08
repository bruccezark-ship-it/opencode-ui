import { describe, it, expect } from 'vitest';
import {
  validateSubdomain,
  normalizeSubdomain,
  buildFullDomain,
  buildCosPrefix,
  RESERVED_NAMES,
} from './subdomain.js';

describe('validateSubdomain', () => {
  it('accepts valid subdomains', () => {
    expect(validateSubdomain('my-app')).toBe(true);
    expect(validateSubdomain('blog')).toBe(true);
    expect(validateSubdomain('docs-v2')).toBe(true);
  });

  it('rejects invalid subdomains', () => {
    expect(validateSubdomain('')).toBe('子域名不能为空');
    expect(validateSubdomain('-start')).not.toBe(true);
    expect(validateSubdomain('My-App')).not.toBe(true);
    expect(validateSubdomain('end-')).not.toBe(true);
  });

  it('rejects reserved names', () => {
    for (const name of RESERVED_NAMES) {
      expect(validateSubdomain(name)).toContain('保留名称');
    }
  });
});

describe('normalizeSubdomain', () => {
  it('trims and lowercases', () => {
    expect(normalizeSubdomain('  My-App  ')).toBe('my-app');
  });
});

describe('buildFullDomain', () => {
  it('builds full domain', () => {
    expect(buildFullDomain('my-app', 'example.com')).toBe('my-app.example.com');
  });
});

describe('buildCosPrefix', () => {
  it('builds cos prefix with trailing slash', () => {
    expect(buildCosPrefix('sites', 'my-app')).toBe('sites/my-app/');
  });

  it('strips leading/trailing slashes from prefix', () => {
    expect(buildCosPrefix('/sites/', 'my-app')).toBe('sites/my-app/');
  });
});
