import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const DOMAIN_REGISTRY_JSON = '.opencode-deploy-domains.json';
export const DOMAIN_REGISTRY_MD = '.opencode-deploy-domains.md';

const entrySchema = z.object({
  domain: z.string(),
  url: z.string(),
  mode: z.enum(['subdomain', 'domain']),
  target: z.string(),
  cosPath: z.string(),
  cname: z.string().optional(),
  publishedAt: z.string(),
});

const registrySchema = z.object({
  domains: z.array(entrySchema),
});

export type PublishedDomainEntry = z.infer<typeof entrySchema>;
export type DomainRegistry = z.infer<typeof registrySchema>;

export function getDomainRegistryPaths(projectRoot: string) {
  return {
    json: join(projectRoot, DOMAIN_REGISTRY_JSON),
    markdown: join(projectRoot, DOMAIN_REGISTRY_MD),
  };
}

export async function loadDomainRegistry(projectRoot: string): Promise<DomainRegistry> {
  const { json } = getDomainRegistryPaths(projectRoot);
  if (!existsSync(json)) {
    return { domains: [] };
  }

  const raw = JSON.parse(await readFile(json, 'utf-8'));
  return registrySchema.parse(raw);
}

function renderMarkdownTable(registry: DomainRegistry): string {
  const lines = [
    '# COS 发布域名记录',
    '',
    '本文件由 COS 发布自动生成，记录该项目已发布的所有域名。',
    '',
    '| 域名 | 访问地址 | 发布方式 | 目标 | COS 路径 | CNAME | 发布时间 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];

  const sorted = [...registry.domains].sort((a, b) => a.domain.localeCompare(b.domain));

  for (const entry of sorted) {
    const modeLabel = entry.mode === 'subdomain' ? '子域名' : '完整域名';
    lines.push(
      `| ${entry.domain} | ${entry.url} | ${modeLabel} | ${entry.target} | ${entry.cosPath} | ${entry.cname ?? '-'} | ${entry.publishedAt} |`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export interface RecordPublishInput {
  mode: 'subdomain' | 'domain';
  target: string;
  urls: string[];
  cosPath: string;
  cdnEntries: Array<{ domain: string; cname: string }>;
}

async function saveDomainRegistry(projectRoot: string, registry: DomainRegistry): Promise<void> {
  const { json, markdown } = getDomainRegistryPaths(projectRoot);
  await writeFile(json, JSON.stringify(registry, null, 2), 'utf-8');
  await writeFile(markdown, renderMarkdownTable(registry), 'utf-8');
}

export function parseCosPathToPrefix(cosPath: string): string {
  const match = cosPath.trim().match(/^cos:\/\/[^/]+\/(.+)$/);
  if (!match) {
    throw new Error(`无效的 COS 路径: ${cosPath}`);
  }

  const prefix = match[1].replace(/^\/+|\/+$/g, '');
  return `${prefix}/`;
}

export function findRegistryEntry(registry: DomainRegistry, domain: string) {
  const normalized = domain.trim().toLowerCase();
  return registry.domains.find((entry) => entry.domain.toLowerCase() === normalized);
}

export function findRegistrySiblings(
  registry: DomainRegistry,
  domain: string,
  cosPath: string,
): string[] {
  const normalized = domain.trim().toLowerCase();
  return registry.domains
    .filter(
      (entry) => entry.domain.toLowerCase() !== normalized && entry.cosPath === cosPath,
    )
    .map((entry) => entry.domain);
}

export async function recordPublishedDomains(
  projectRoot: string,
  input: RecordPublishInput,
): Promise<DomainRegistry> {
  const registry = await loadDomainRegistry(projectRoot);
  const now = new Date().toISOString();
  const cnameByDomain = new Map(input.cdnEntries.map((entry) => [entry.domain, entry.cname]));

  for (const url of input.urls) {
    const domain = new URL(url).hostname;
    const entry: PublishedDomainEntry = {
      domain,
      url,
      mode: input.mode,
      target: input.target,
      cosPath: input.cosPath,
      cname: cnameByDomain.get(domain),
      publishedAt: now,
    };

    const existingIndex = registry.domains.findIndex((item) => item.domain === domain);
    if (existingIndex >= 0) {
      registry.domains[existingIndex] = entry;
    } else {
      registry.domains.push(entry);
    }
  }

  await saveDomainRegistry(projectRoot, registry);
  return registry;
}

export async function removePublishedDomain(
  projectRoot: string,
  domain: string,
): Promise<DomainRegistry> {
  const registry = await loadDomainRegistry(projectRoot);
  const normalized = domain.trim().toLowerCase();
  registry.domains = registry.domains.filter(
    (entry) => entry.domain.toLowerCase() !== normalized,
  );
  await saveDomainRegistry(projectRoot, registry);
  return registry;
}
