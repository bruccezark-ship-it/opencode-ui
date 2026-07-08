import type { GlobalConfig } from '../config/schema.js';
import { isCdnDomainExists, removeCdnDomain } from '../cdn/cdn-manager.js';
import { removeCnameRecord, resolveDnsTargetForDomain } from '../dns/dns-manager.js';
import { deletePrefix } from '../uploader/cos-uploader.js';
import { normalizeDomain, resolveCosPrefixFromDomain } from '../validate/domain.js';

export interface UndeployContext {
  domain: string;
  config: GlobalConfig;
}

export interface UndeployResult {
  domain: string;
  cdnStatus: 'removed' | 'not_found';
  dnsStatus: 'deleted' | 'not_found' | 'skipped';
  dnsSkipReason?: string;
  cosPrefix: string;
  cosDeleted: number;
  cosSkipped: boolean;
  cosSkipReason?: string;
}

export interface UndeployOptions {
  onStepStart?: (step: number, total: number, name: string) => void;
  onStepComplete?: (step: number, total: number, name: string, message: string) => void;
}

const TOTAL_STEPS = 3;

async function shouldDeleteCosResources(
  config: GlobalConfig,
  targetDomain: string,
  sharedDomains: string[],
): Promise<{ delete: boolean; reason?: string }> {
  const others = sharedDomains.filter((d) => normalizeDomain(d) !== normalizeDomain(targetDomain));

  for (const domain of others) {
    if (await isCdnDomainExists(config, domain)) {
      return {
        delete: false,
        reason: `同前缀下仍有 CDN 域名 ${domain} 在线，已保留 COS 资源`,
      };
    }
  }

  return { delete: true };
}

export async function undeploy(
  ctx: UndeployContext,
  options: UndeployOptions = {},
): Promise<UndeployResult> {
  const { domain, config } = ctx;
  const { cosPrefix, sharedDomains } = resolveCosPrefixFromDomain(
    domain,
    config.domain.baseDomain,
    config.cos.prefix,
  );
  const dnsTarget = await resolveDnsTargetForDomain(domain, config);

  options.onStepStart?.(1, TOTAL_STEPS, '下线 CDN 域名');
  const cdnStatus = await removeCdnDomain(config, domain);
  const cdnMessage =
    cdnStatus === 'removed'
      ? `CDN 域名已删除: ${domain}`
      : `CDN 域名不存在: ${domain}`;
  options.onStepComplete?.(1, TOTAL_STEPS, '下线 CDN 域名', cdnMessage);

  options.onStepStart?.(2, TOTAL_STEPS, '清除 DNS 解析');
  let dnsStatus: UndeployResult['dnsStatus'] = 'skipped';
  let dnsSkipReason: string | undefined;

  if (!dnsTarget.managedDns) {
    dnsSkipReason = `域名 ${domain} 不在当前腾讯云 DNSPod 账户下，请手动清理 DNS 解析`;
    options.onStepComplete?.(2, TOTAL_STEPS, '清除 DNS 解析', dnsSkipReason);
  } else {
    const dnsResult = await removeCnameRecord({
      subdomain: dnsTarget.dnsHost,
      config,
      dnsZone: dnsTarget.dnsZone,
    });
    const dnsLabel = dnsTarget.dnsHost === '@' ? '@' : dnsTarget.dnsHost;
    if (dnsResult.action === 'deleted') {
      dnsStatus = 'deleted';
      options.onStepComplete?.(
        2,
        TOTAL_STEPS,
        '清除 DNS 解析',
        `CNAME ${dnsLabel} 已删除`,
      );
    } else {
      dnsStatus = 'not_found';
      options.onStepComplete?.(
        2,
        TOTAL_STEPS,
        '清除 DNS 解析',
        `未找到 CNAME 记录: ${dnsLabel}`,
      );
    }
  }

  options.onStepStart?.(3, TOTAL_STEPS, '清除 COS 资源');
  const cosDecision = await shouldDeleteCosResources(config, domain, sharedDomains);

  if (!cosDecision.delete) {
    options.onStepComplete?.(
      3,
      TOTAL_STEPS,
      '清除 COS 资源',
      cosDecision.reason ?? '已跳过 COS 清理',
    );
    return {
      domain,
      cdnStatus,
      dnsStatus,
      dnsSkipReason,
      cosPrefix,
      cosDeleted: 0,
      cosSkipped: true,
      cosSkipReason: cosDecision.reason,
    };
  }

  const { deleted } = await deletePrefix(config, cosPrefix);
  options.onStepComplete?.(
    3,
    TOTAL_STEPS,
    '清除 COS 资源',
    deleted > 0 ? `已删除 ${deleted} 个对象 (${cosPrefix})` : `COS 路径为空: ${cosPrefix}`,
  );

  return {
    domain,
    cdnStatus,
    dnsStatus,
    dnsSkipReason,
    cosPrefix,
    cosDeleted: deleted,
    cosSkipped: false,
  };
}
