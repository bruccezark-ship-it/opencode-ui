import { describe, it, expect } from 'vitest';
import { findBlockedPublishDomains } from './domain-availability.js';
import type { DomainRegistry } from './domain-registry.js';

describe('findBlockedPublishDomains', () => {
  const registry: DomainRegistry = {
    domains: [
      {
        domain: 'my-app.example.com',
        url: 'http://my-app.example.com',
        mode: 'subdomain',
        target: 'my-app',
        cosPath: 'cos://bucket/sites/my-app/',
        publishedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        domain: 'www.example.com',
        url: 'https://www.example.com',
        mode: 'domain',
        target: 'example.com',
        cosPath: 'cos://bucket/sites/example-com/',
        publishedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  };

  it('blocks in-use domains that are not in the project registry', () => {
    expect(
      findBlockedPublishDomains(
        ['blog.example.com', 'other.example.com'],
        registry,
        ['blog.example.com'],
      ),
    ).toEqual(['blog.example.com']);
  });

  it('allows in-use domains that belong to the current project registry', () => {
    expect(
      findBlockedPublishDomains(
        ['my-app.example.com', 'www.example.com'],
        registry,
        ['my-app.example.com', 'www.example.com'],
      ),
    ).toEqual([]);
  });

  it('allows unused domains', () => {
    expect(
      findBlockedPublishDomains(['new-app.example.com'], registry, []),
    ).toEqual([]);
  });
});
