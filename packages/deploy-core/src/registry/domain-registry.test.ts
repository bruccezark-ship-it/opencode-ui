import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  DOMAIN_REGISTRY_JSON,
  DOMAIN_REGISTRY_MD,
  findRegistryEntry,
  findRegistrySiblings,
  loadDomainRegistry,
  parseCosPathToPrefix,
  recordPublishedDomains,
  removePublishedDomain,
} from './domain-registry.js';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createProjectDir() {
  const dir = await mkdtemp(join(tmpdir(), 'opencode-deploy-registry-'));
  tempDirs.push(dir);
  return dir;
}

describe('domain-registry', () => {
  it('creates registry files on first publish', async () => {
    const projectRoot = await createProjectDir();

    await recordPublishedDomains(projectRoot, {
      mode: 'subdomain',
      target: 'my-app',
      urls: ['http://my-app.example.com'],
      cosPath: 'cos://bucket/sites/my-app/',
      cdnEntries: [{ domain: 'my-app.example.com', cname: 'xxx.cdn.myqcloud.com' }],
    });

    const registry = await loadDomainRegistry(projectRoot);
    expect(registry.domains).toHaveLength(1);
    expect(registry.domains[0]).toMatchObject({
      domain: 'my-app.example.com',
      url: 'http://my-app.example.com',
      mode: 'subdomain',
      target: 'my-app',
      cname: 'xxx.cdn.myqcloud.com',
    });

    const markdown = await readFile(join(projectRoot, DOMAIN_REGISTRY_MD), 'utf-8');
    expect(markdown).toContain('my-app.example.com');
    expect(markdown).toContain('子域名');
  });

  it('appends new domains and updates existing ones', async () => {
    const projectRoot = await createProjectDir();

    await recordPublishedDomains(projectRoot, {
      mode: 'subdomain',
      target: 'blog',
      urls: ['http://blog.example.com'],
      cosPath: 'cos://bucket/sites/blog/',
      cdnEntries: [{ domain: 'blog.example.com', cname: 'a.cdn.myqcloud.com' }],
    });

    await recordPublishedDomains(projectRoot, {
      mode: 'subdomain',
      target: 'docs',
      urls: ['https://docs.example.com'],
      cosPath: 'cos://bucket/sites/docs/',
      cdnEntries: [{ domain: 'docs.example.com', cname: 'b.cdn.myqcloud.com' }],
    });

    await recordPublishedDomains(projectRoot, {
      mode: 'subdomain',
      target: 'blog',
      urls: ['https://blog.example.com'],
      cosPath: 'cos://bucket/sites/blog/',
      cdnEntries: [{ domain: 'blog.example.com', cname: 'a2.cdn.myqcloud.com' }],
    });

    const registry = await loadDomainRegistry(projectRoot);
    expect(registry.domains).toHaveLength(2);
    expect(registry.domains.find((entry) => entry.domain === 'blog.example.com')).toMatchObject({
      url: 'https://blog.example.com',
      cname: 'a2.cdn.myqcloud.com',
    });
    expect(registry.domains.find((entry) => entry.domain === 'docs.example.com')).toBeTruthy();

    const json = await readFile(join(projectRoot, DOMAIN_REGISTRY_JSON), 'utf-8');
    expect(JSON.parse(json).domains).toHaveLength(2);
  });

  it('records multiple domains from a single deploy', async () => {
    const projectRoot = await createProjectDir();

    await recordPublishedDomains(projectRoot, {
      mode: 'domain',
      target: 'example.com',
      urls: ['https://example.com', 'https://www.example.com'],
      cosPath: 'cos://bucket/sites/example-com/',
      cdnEntries: [
        { domain: 'example.com', cname: 'apex.cdn.myqcloud.com' },
        { domain: 'www.example.com', cname: 'www.cdn.myqcloud.com' },
      ],
    });

    const registry = await loadDomainRegistry(projectRoot);
    expect(registry.domains).toHaveLength(2);
    expect(registry.domains.map((entry) => entry.domain).sort()).toEqual([
      'example.com',
      'www.example.com',
    ]);
  });

  it('parses cos path and finds registry siblings', async () => {
    const projectRoot = await createProjectDir();

    await recordPublishedDomains(projectRoot, {
      mode: 'domain',
      target: 'example.com',
      urls: ['https://example.com', 'https://www.example.com'],
      cosPath: 'cos://bucket/sites/example-com/',
      cdnEntries: [
        { domain: 'example.com', cname: 'apex.cdn.myqcloud.com' },
        { domain: 'www.example.com', cname: 'www.cdn.myqcloud.com' },
      ],
    });

    expect(parseCosPathToPrefix('cos://bucket/sites/example-com/')).toBe('sites/example-com/');

    const registry = await loadDomainRegistry(projectRoot);
    expect(findRegistryEntry(registry, 'example.com')?.cosPath).toBe('cos://bucket/sites/example-com/');
    expect(findRegistrySiblings(registry, 'example.com', 'cos://bucket/sites/example-com/')).toEqual([
      'www.example.com',
    ]);

    await removePublishedDomain(projectRoot, 'example.com');
    const updated = await loadDomainRegistry(projectRoot);
    expect(updated.domains).toHaveLength(1);
    expect(updated.domains[0]?.domain).toBe('www.example.com');
  });
});
