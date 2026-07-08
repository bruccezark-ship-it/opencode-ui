const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export interface DeployTarget {
  fullDomain: string;
  /** DNSPod 主机记录，如 wocao、app.staging、@ */
  dnsHost: string;
  /** COS 路径标识 */
  cosKey: string;
  /** 是否可在 DNSPod 托管域下自动配置解析 */
  managedDns: boolean;
}

export function normalizeDomain(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '');
}

export function validateDomain(input: string): string | true {
  const trimmed = input.trim();

  if (!trimmed) {
    return '域名不能为空';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return '请勿包含 http:// 或 https://';
  }

  if (trimmed.includes('/') || trimmed.includes(':')) {
    return '域名格式不正确';
  }

  const normalized = normalizeDomain(trimmed);
  const labels = normalized.split('.');

  if (labels.length < 2) {
    return '域名格式不正确';
  }

  if (normalized.length > 253) {
    return '域名过长';
  }

  if (labels.some((label) => !DOMAIN_LABEL.test(label))) {
    return '域名格式不正确';
  }

  return true;
}

export function parseFullDomain(fullDomain: string, baseDomain: string): DeployTarget {
  const full = normalizeDomain(fullDomain);
  const base = normalizeDomain(baseDomain);

  if (full === base) {
    return {
      fullDomain: full,
      dnsHost: '@',
      cosKey: base.replace(/\./g, '-'),
      managedDns: true,
    };
  }

  const suffix = `.${base}`;
  if (full.endsWith(suffix)) {
    const dnsHost = full.slice(0, -suffix.length);
    return {
      fullDomain: full,
      dnsHost,
      cosKey: dnsHost.replace(/\./g, '-'),
      managedDns: true,
    };
  }

  return {
    fullDomain: full,
    dnsHost: full,
    cosKey: full.replace(/\./g, '-'),
    managedDns: false,
  };
}

export function buildCosPrefixFromKey(prefix: string, cosKey: string): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const normalizedKey = cosKey.replace(/^\/+|\/+$/g, '');
  return `${normalizedPrefix}/${normalizedKey}/`;
}

export interface DeployDomainEntry {
  fullDomain: string;
  dnsHost: string;
  /** DNSPod 解析区域（根域名） */
  dnsZone?: string;
  /** 是否可在当前腾讯云账户下自动配置 DNS 与 CDN 归属验证 */
  managedDns: boolean;
}

export interface DeployPlan {
  cosKey: string;
  cosPrefix: string;
  domains: DeployDomainEntry[];
  primaryDomain: string;
}

/** 根域名输入时同时部署 apex 与 www */
export function expandCdnDomains(domain: string): string[] {
  const normalized = normalizeDomain(domain);
  const root = getRootDomain(normalized);

  if (normalized === root) {
    return [root, `www.${root}`];
  }

  return [normalized];
}

/** 根域名输入时 sitemap/robots 使用 www 前缀作为站点 URL */
export function resolveSiteBaseDomain(inputDomain: string): string {
  const normalized = normalizeDomain(inputDomain);
  const root = getRootDomain(normalized);

  if (normalized === root) {
    return `www.${root}`;
  }

  return normalized;
}

export function resolveDeployPlan(
  inputDomain: string,
  baseDomain: string,
  cosPrefixBase: string,
): DeployPlan {
  const cdnDomains = expandCdnDomains(inputDomain);
  const cosKey = getRootDomain(normalizeDomain(inputDomain)).replace(/\./g, '-');
  const domains = cdnDomains.map((fullDomain) => {
    const target = parseFullDomain(fullDomain, baseDomain);
    return {
      fullDomain: target.fullDomain,
      dnsHost: target.dnsHost,
      managedDns: target.managedDns,
    };
  });

  return {
    cosKey,
    cosPrefix: buildCosPrefixFromKey(cosPrefixBase, cosKey),
    domains,
    primaryDomain: domains[0].fullDomain,
  };
}

export function resolveCosPrefixFromDomain(
  domain: string,
  baseDomain: string,
  cosPrefixBase: string,
): { cosPrefix: string; sharedDomains: string[] } {
  const normalized = normalizeDomain(domain);
  const root = getRootDomain(normalized);

  if (normalized === root || normalized === `www.${root}`) {
    return {
      cosPrefix: buildCosPrefixFromKey(cosPrefixBase, root.replace(/\./g, '-')),
      sharedDomains: expandCdnDomains(root),
    };
  }

  const target = parseFullDomain(normalized, baseDomain);
  return {
    cosPrefix: buildCosPrefixFromKey(cosPrefixBase, target.cosKey),
    sharedDomains: [normalized],
  };
}

export function resolveSubdomainTarget(subdomain: string, baseDomain: string): DeployTarget {
  const normalizedSub = subdomain.trim().toLowerCase();
  return {
    fullDomain: `${normalizedSub}.${normalizeDomain(baseDomain)}`,
    dnsHost: normalizedSub,
    cosKey: normalizedSub,
    managedDns: true,
  };
}

export function resolveSubdomainPlan(
  subdomain: string,
  baseDomain: string,
  cosPrefixBase: string,
): DeployPlan {
  const target = resolveSubdomainTarget(subdomain, baseDomain);
  return {
    cosKey: target.cosKey,
    cosPrefix: buildCosPrefixFromKey(cosPrefixBase, target.cosKey),
    domains: [
      {
        fullDomain: target.fullDomain,
        dnsHost: target.dnsHost,
        managedDns: target.managedDns,
      },
    ],
    primaryDomain: target.fullDomain,
  };
}

/** 提取 CDN 归属验证使用的根域名（解析区域） */
export function getRootDomain(domain: string): string {
  const normalized = normalizeDomain(domain);
  const labels = normalized.split('.');

  if (labels.length <= 2) {
    return normalized;
  }

  const multiPartTlds = new Set([
    'com.cn',
    'net.cn',
    'org.cn',
    'gov.cn',
    'ac.cn',
    'co.uk',
    'org.uk',
    'com.au',
    'net.au',
  ]);
  const lastTwo = labels.slice(-2).join('.');

  if (multiPartTlds.has(lastTwo) && labels.length >= 3) {
    return labels.slice(-3).join('.');
  }

  return lastTwo;
}

/** 根据 DNSPod 解析区域计算主机记录 */
export function computeDnsHost(fullDomain: string, dnsZone: string): string {
  const full = normalizeDomain(fullDomain);
  const zone = normalizeDomain(dnsZone);

  if (full === zone) {
    return '@';
  }

  const suffix = `.${zone}`;
  if (full.endsWith(suffix)) {
    return full.slice(0, -suffix.length);
  }

  throw new Error(`域名 ${full} 不属于解析区域 ${zone}`);
}

/**
 * 腾讯云 CDN 归属验证 TXT 始终添加在根域名下:
 * _cdnauth.example.com（与 www / 多级子域 / 根域加速域名无关）
 */
export function buildVerifyRecordFqdn(accelerateDomain: string): string {
  return `_cdnauth.${getRootDomain(accelerateDomain)}`;
}

export function buildCdnVerifyRecord(
  accelerateDomain: string,
  verifyInfo: { Record?: string; RecordType?: string },
) {
  const domain = normalizeDomain(accelerateDomain);
  const rootDomain = getRootDomain(domain);

  return {
    domain,
    rootDomain,
    host: '_cdnauth',
    recordType: verifyInfo.RecordType ?? 'TXT',
    value: verifyInfo.Record ?? '',
    fqdn: `_cdnauth.${rootDomain}`,
  };
}

export function formatCdnVerifyRecordMessage(record: {
  domain: string;
  rootDomain?: string;
  host: string;
  recordType: string;
  value: string;
  fqdn: string;
}): string {
  const rootDomain = record.rootDomain ?? getRootDomain(record.domain);
  return [
    `CDN 域名归属验证: ${record.domain}`,
    '',
    '请在根域名 DNS 解析区域添加以下 TXT 记录:',
    `  解析区域: ${rootDomain}`,
    `  记录类型: ${record.recordType}`,
    `  主机记录: ${record.host}`,
    `  记录值:   ${record.value}`,
    `  完整主机: ${record.fqdn}`,
    '',
    '注意: 同一根域名下的不同加速域名共用 _cdnauth 记录位置，',
    '      验证新域名时需将记录值更新为当前域名的最新验证值。',
  ].join('\n');
}
