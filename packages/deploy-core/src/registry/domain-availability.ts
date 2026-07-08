import type { GlobalConfig } from '../config/schema.js';
import { isCdnDomainExists } from '../cdn/cdn-manager.js';
import { findRegistryEntry, loadDomainRegistry, type DomainRegistry } from './domain-registry.js';

export function findBlockedPublishDomains(
  domains: string[],
  registry: DomainRegistry,
  inUseDomains: Iterable<string>,
): string[] {
  const inUseSet = new Set([...inUseDomains].map((domain) => domain.toLowerCase()));

  return domains.filter((domain) => {
    if (findRegistryEntry(registry, domain)) {
      return false;
    }
    return inUseSet.has(domain.toLowerCase());
  });
}

export async function getBlockedPublishDomains(
  projectRoot: string,
  domains: string[],
  config: GlobalConfig,
): Promise<string[]> {
  const registry = await loadDomainRegistry(projectRoot);
  const blocked: string[] = [];

  for (const domain of domains) {
    if (findRegistryEntry(registry, domain)) {
      continue;
    }
    if (await isCdnDomainExists(config, domain)) {
      blocked.push(domain);
    }
  }

  return blocked;
}

export async function validateDomainsForPublish(
  projectRoot: string,
  domains: string[],
  config: GlobalConfig,
): Promise<true | string> {
  const blocked = await getBlockedPublishDomains(projectRoot, domains, config);

  if (blocked.length > 0) {
    return `以下域名已被其他项目使用：${blocked.join('、')}`;
  }

  return true;
}
