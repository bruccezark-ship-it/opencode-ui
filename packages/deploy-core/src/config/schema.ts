import { z } from 'zod';
import type { DeployDomainEntry } from '../validate/domain.js';

export const cacheRuleSchema = z.object({
  type: z.literal('file'),
  rule: z.string(),
  ttl: z.number().int().min(0),
});

export const globalConfigSchema = z.object({
  tencent: z.object({
    secretId: z.string().min(1, 'secretId 不能为空'),
    secretKey: z.string().min(1, 'secretKey 不能为空'),
    region: z.string().min(1, 'region 不能为空'),
  }),
  cos: z.object({
    bucket: z.string().min(1, 'COS bucket 不能为空'),
    prefix: z.string().default('sites'),
  }),
  cdn: z.object({
    serviceType: z.enum(['web', 'download', 'media']).default('web'),
    area: z.enum(['mainland', 'overseas', 'global']).default('mainland'),
    https: z.boolean().default(false),
    certId: z.string().optional(),
    defaultCacheRules: z.array(cacheRuleSchema).default([
      { type: 'file', rule: 'html', ttl: 0 },
      { type: 'file', rule: 'js,css', ttl: 2592000 },
      { type: 'file', rule: 'jpg,png,svg,webp,ico,woff,woff2', ttl: 2592000 },
    ]),
  }),
  dns: z.object({
    domain: z.string().min(1, 'DNS 主域名不能为空'),
    recordLine: z.string().default('默认'),
    ttl: z.number().int().positive().default(600),
  }),
  domain: z.object({
    baseDomain: z.string().min(1, 'baseDomain 不能为空'),
    protocol: z.enum(['http', 'https']).default('http'),
  }),
});

export const projectConfigSchema = z.object({
  subdomain: z.string().optional(),
  routeFile: z.string().optional(),
  buildCommand: z.string().optional(),
  outputDir: z.string().optional(),
  basePath: z.string().default('/'),
  cleanRemote: z.boolean().default(true),
  crawlMaxPages: z.number().int().positive().default(50),
  crawlMaxDepth: z.number().int().positive().default(1),
});

export type GlobalConfig = z.infer<typeof globalConfigSchema>;
export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type DeployConfig = GlobalConfig & { project: ProjectConfig };

export type ResolvedRouteSource =
  | { kind: 'file'; path: string }
  | { kind: 'pages'; dir: string; files: string[] }
  | { kind: 'routes'; routes: string[] }
  | { kind: 'crawl' };

export interface DeployContext {
  projectRoot: string;
  cosPrefix: string;
  domains: DeployDomainEntry[];
  config: DeployConfig;
  outDir: string;
  siteBaseUrl: string;
}

export interface DeployCdnEntry {
  domain: string;
  cname: string;
  created: boolean;
}

export interface DeployResult {
  url: string;
  urls: string[];
  cosPath: string;
  cdnCname: string;
  cdnEntries: DeployCdnEntry[];
}

import type { CdnVerificationHandler } from '../cdn/cdn-manager.js';
import type { RouteDiscoveryOption } from '../routes/route-discovery.js';

export interface DeployOptions {
  noClean?: boolean;
  /** 加速域名均已存在于 CDN 时，跳过 CDN 配置与 DNS 解析 */
  skipCdnAndDns?: boolean;
  /** 交互模式返回 option 或 'browser'；非交互模式自动选择 */
  onRouteDiscoverySelect?: (
    options: RouteDiscoveryOption[],
  ) => Promise<RouteDiscoveryOption | 'browser' | undefined>;
  onStepStart?: (step: number, total: number, name: string) => void;
  onStepComplete?: (step: number, total: number, name: string, message: string) => void;
  onCdnVerificationRequired?: CdnVerificationHandler;
  onStatus?: (message: string) => void;
}
