import { dnspod } from 'tencentcloud-sdk-nodejs';
import type { GlobalConfig } from '../config/schema.js';
import {
  computeDnsHost,
  getRootDomain,
  normalizeDomain,
  type DeployPlan,
} from '../validate/domain.js';
import { isDnsPodNsEffective, isDomainNotManagedError, matchesTxtRecordValue } from './dns-zone.js';
import { retry } from '../utils/retry.js';

type DnsClient = InstanceType<typeof dnspod.v20210323.Client>;

export interface DnsSetupOptions {
  subdomain: string;
  cnameTarget: string;
  config: GlobalConfig;
  /** DNSPod 解析区域，默认 config.dns.domain */
  dnsZone?: string;
}

export interface DnsSetupResult {
  action: 'created' | 'updated' | 'skipped';
  recordId?: number;
}

function createDnsClient(config: GlobalConfig): DnsClient {
  return new dnspod.v20210323.Client({
    credential: {
      secretId: config.tencent.secretId,
      secretKey: config.tencent.secretKey,
    },
    profile: {
      httpProfile: { endpoint: 'dnspod.tencentcloudapi.com' },
    },
  });
}

function resolveDnsZone(config: GlobalConfig, dnsZone?: string): string {
  return normalizeDomain(dnsZone ?? config.dns.domain);
}

function isDomainNotFoundError(error: unknown): boolean {
  return isDomainNotManagedError(error);
}

/** 检测根域名是否在当前腾讯云 DNSPod 账户下 */
export async function isDnsZoneInAccount(
  config: GlobalConfig,
  zone: string,
): Promise<boolean> {
  const details = await getDnsZoneDetails(config, zone);
  return details.inAccount;
}

export interface DnsZoneDetails {
  inAccount: boolean;
  effective: boolean;
  actualNs: string[];
  dnspodNs: string[];
  grade?: string;
  dnsStatus?: string;
}

export async function getDnsZoneDetails(
  config: GlobalConfig,
  zone: string,
): Promise<DnsZoneDetails> {
  const client = createDnsClient(config);
  const normalizedZone = resolveDnsZone(config, zone);

  try {
    const result = await client.DescribeDomain({ Domain: normalizedZone });
    const info = result.DomainInfo;

    if (!info) {
      return { inAccount: false, effective: false, actualNs: [], dnspodNs: [] };
    }

    const actualNs = info.ActualNsList ?? [];
    const dnspodNs = info.DnspodNsList ?? [];

    return {
      inAccount: true,
      effective: isDnsPodNsEffective(actualNs, dnspodNs),
      actualNs,
      dnspodNs,
      grade: info.Grade,
      dnsStatus: info.DnsStatus,
    };
  } catch (error) {
    if (isDomainNotFoundError(error)) {
      return { inAccount: false, effective: false, actualNs: [], dnspodNs: [] };
    }
    throw error;
  }
}

/** 根据 DNSPod 账户归属更新发布计划中的 managedDns / dnsZone / dnsHost */
export async function enrichDeployPlanDns(
  plan: DeployPlan,
  config: GlobalConfig,
): Promise<DeployPlan> {
  const zoneCache = new Map<string, DnsZoneDetails>();

  const domains = await Promise.all(
    plan.domains.map(async (entry) => {
      const dnsZone = getRootDomain(entry.fullDomain);

      let details = zoneCache.get(dnsZone);
      if (!details) {
        details = await getDnsZoneDetails(config, dnsZone);
        zoneCache.set(dnsZone, details);
      }

      if (details.inAccount && details.effective) {
        return {
          ...entry,
          managedDns: true,
          dnsZone,
          dnsHost: computeDnsHost(entry.fullDomain, dnsZone),
        };
      }

      return {
        ...entry,
        managedDns: false,
        dnsZone,
        dnsHost: entry.fullDomain,
      };
    }),
  );

  return { ...plan, domains };
}

export async function resolveDnsTargetForDomain(
  fullDomain: string,
  config: GlobalConfig,
): Promise<{ dnsHost: string; managedDns: boolean; dnsZone: string }> {
  const dnsZone = getRootDomain(normalizeDomain(fullDomain));
  const details = await getDnsZoneDetails(config, dnsZone);

  if (details.inAccount && details.effective) {
    return {
      managedDns: true,
      dnsZone,
      dnsHost: computeDnsHost(fullDomain, dnsZone),
    };
  }

  return {
    managedDns: false,
    dnsZone,
    dnsHost: fullDomain,
  };
}

function normalizeCname(value: string): string {
  return value.replace(/\.$/, '').toLowerCase();
}

function isEmptyRecordListError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('记录列表为空') ||
    message.includes('NoDataOfRecord') ||
    message.includes('ResourceNotFound.NoDataOfRecord')
  );
}

async function describeRecordList(
  client: DnsClient,
  params: {
    Domain: string;
    Subdomain: string;
    RecordType: string;
  },
) {
  try {
    return await client.DescribeRecordList({
      ...params,
      ErrorOnEmpty: 'no',
    });
  } catch (error) {
    if (isEmptyRecordListError(error)) {
      return { RecordList: [] };
    }
    throw error;
  }
}

async function findCnameRecord(
  client: DnsClient,
  domain: string,
  subdomain: string,
) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await describeRecordList(client, {
      Domain: domain,
      Subdomain: subdomain,
      RecordType: 'CNAME',
    });

    const record = result.RecordList?.find((r) => r.Type === 'CNAME');
    if (record) return record;

    if (attempt < 2) await sleep(3000);
  }

  return undefined;
}

export interface TxtRecordSetupOptions {
  host: string;
  value: string;
  config: GlobalConfig;
  /** DNSPod 解析区域，默认 config.dns.domain */
  dnsZone?: string;
}

async function findTxtRecord(client: DnsClient, domain: string, host: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await describeRecordList(client, {
      Domain: domain,
      Subdomain: host,
      RecordType: 'TXT',
    });

    const record = result.RecordList?.find((r) => r.Type === 'TXT');
    if (record) return record;

    if (attempt < 2) await sleep(3000);
  }

  return undefined;
}

async function resolveDefaultRecordLine(
  client: DnsClient,
  domain: string,
  domainGrade: string | undefined,
  fallbackLine: string,
): Promise<{ recordLine: string; recordLineId?: string }> {
  const gradesToTry = [...new Set([domainGrade, 'DP_FREE', 'D_FREE'].filter(Boolean))] as string[];

  for (const grade of gradesToTry) {
    try {
      const result = await client.DescribeRecordLineList({
        Domain: domain,
        DomainGrade: grade,
      });

      const line = result.LineList?.find(
        (item) => item.LineId === '0' || item.Name === '默认' || item.Name === 'Default',
      );

      if (line) {
        return { recordLine: line.Name, recordLineId: line.LineId };
      }
    } catch {
      // try next grade
    }
  }

  return { recordLine: fallbackLine, recordLineId: '0' };
}

async function waitForTxtRecordInDnsPod(
  client: DnsClient,
  domain: string,
  host: string,
  expectedValue: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const existing = await findTxtRecord(client, domain, host);
    if (matchesTxtRecordValue(existing?.Value, expectedValue)) {
      return;
    }

    if (attempt < 7) {
      await sleep(3000);
    }
  }

  throw new Error(
    `DNSPod 中未找到 TXT 记录 ${host}.${domain}。请确认子账号拥有 CreateTXTRecord/ModifyTXTRecord 权限，且域名解析区域状态正常。`,
  );
}

export async function ensureTxtRecord(options: TxtRecordSetupOptions): Promise<DnsSetupResult> {
  const { host, value, config, dnsZone } = options;
  const client = createDnsClient(config);
  const domain = resolveDnsZone(config, dnsZone);
  const normalizedValue = value.replace(/^"|"$/g, '');

  const domainInfo = await client.DescribeDomain({ Domain: domain });
  const recordLine = await resolveDefaultRecordLine(
    client,
    domain,
    domainInfo.DomainInfo?.Grade,
    config.dns.recordLine,
  );

  const existing = await findTxtRecord(client, domain, host);

  if (existing?.Value && matchesTxtRecordValue(existing.Value, normalizedValue)) {
    return { action: 'skipped', recordId: existing.RecordId };
  }

  if (existing?.RecordId != null) {
    await retry(() =>
      client.ModifyTXTRecord({
        Domain: domain,
        RecordId: existing.RecordId!,
        SubDomain: host,
        RecordLine: recordLine.recordLine,
        RecordLineId: recordLine.recordLineId,
        Value: normalizedValue,
        TTL: config.dns.ttl,
        Status: 'ENABLE',
      }),
    );
    await waitForTxtRecordInDnsPod(client, domain, host, normalizedValue);
    return { action: 'updated', recordId: existing.RecordId };
  }

  const result = await retry(() =>
    client.CreateTXTRecord({
      Domain: domain,
      SubDomain: host,
      RecordLine: recordLine.recordLine,
      RecordLineId: recordLine.recordLineId,
      Value: normalizedValue,
      TTL: config.dns.ttl,
      Status: 'ENABLE',
    }),
  );

  await waitForTxtRecordInDnsPod(client, domain, host, normalizedValue);
  return { action: 'created', recordId: result.RecordId };
}

export async function ensureCnameRecord(options: DnsSetupOptions): Promise<DnsSetupResult> {
  const { subdomain, cnameTarget, config, dnsZone } = options;
  const client = createDnsClient(config);
  const domain = resolveDnsZone(config, dnsZone);
  const normalizedTarget = normalizeCname(cnameTarget);

  const existing = await findCnameRecord(client, domain, subdomain);

  if (existing?.Value && normalizeCname(existing.Value) === normalizedTarget) {
    return { action: 'skipped', recordId: existing.RecordId };
  }

  if (existing?.RecordId != null) {
    await retry(() =>
      client.ModifyRecord({
        Domain: domain,
        RecordId: existing.RecordId!,
        SubDomain: subdomain,
        RecordType: 'CNAME',
        RecordLine: config.dns.recordLine,
        Value: cnameTarget,
        TTL: config.dns.ttl,
      }),
    );
    return { action: 'updated', recordId: existing.RecordId };
  }

  const result = await retry(() =>
    client.CreateRecord({
      Domain: domain,
      SubDomain: subdomain,
      RecordType: 'CNAME',
      RecordLine: config.dns.recordLine,
      Value: cnameTarget,
      TTL: config.dns.ttl,
    }),
  );

  return { action: 'created', recordId: result.RecordId };
}

export interface DnsRemoveResult {
  action: 'deleted' | 'not_found' | 'skipped';
  recordId?: number;
  reason?: string;
}

export async function removeCnameRecord(options: {
  subdomain: string;
  config: GlobalConfig;
  dnsZone?: string;
}): Promise<DnsRemoveResult> {
  const { subdomain, config, dnsZone } = options;
  const client = createDnsClient(config);
  const domain = resolveDnsZone(config, dnsZone);

  const existing = await findCnameRecord(client, domain, subdomain);
  if (!existing?.RecordId) {
    return { action: 'not_found' };
  }

  await retry(() =>
    client.DeleteRecord({
      Domain: domain,
      RecordId: existing.RecordId!,
    }),
  );

  return { action: 'deleted', recordId: existing.RecordId };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
