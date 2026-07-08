import { describe, it, expect } from 'vitest';
import { isDnsPodNsEffective, isDomainNotManagedError, matchesTxtRecordValue } from './dns-zone.js';

describe('isDomainNotManagedError', () => {
  it('treats permission errors as external domain', () => {
    expect(isDomainNotManagedError(new Error('当前域名无权限，请返回域名列表'))).toBe(true);
    expect(isDomainNotManagedError(new Error('DomainNotExists'))).toBe(true);
  });
});

describe('isDnsPodNsEffective', () => {
  it('returns true when actual NS matches DNSPod NS', () => {
    expect(
      isDnsPodNsEffective(
        ['f1g1ns1.dnspod.net', 'f1g1ns2.dnspod.net'],
        ['f1g1ns1.dnspod.net', 'f1g1ns2.dnspod.net'],
      ),
    ).toBe(true);
  });

  it('returns false when actual NS points elsewhere', () => {
    expect(
      isDnsPodNsEffective(
        ['ns1.cloudflare.com', 'ns2.cloudflare.com'],
        ['f1g1ns1.dnspod.net'],
      ),
    ).toBe(false);
  });
});

describe('matchesTxtRecordValue', () => {
  it('matches values with or without quotes', () => {
    expect(matchesTxtRecordValue('"abc123"', 'abc123')).toBe(true);
    expect(matchesTxtRecordValue('abc123', '"abc123"')).toBe(true);
  });
});
