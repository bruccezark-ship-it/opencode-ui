import { Resolver, resolve4 } from 'node:dns/promises';

export interface TxtDnsCheckResult {
  ok: boolean;
  fqdn: string;
  expected: string;
  found: string[];
  message: string;
}

function normalizeTxtValue(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}

export async function resolveNameserverIps(nameservers: string[]): Promise<string[]> {
  const ips: string[] = [];

  for (const nameserver of nameservers) {
    const host = nameserver.replace(/\.$/, '');
    if (!host) continue;

    try {
      ips.push(...(await resolve4(host)));
    } catch {
      // ignore unresolved NS
    }
  }

  return ips.length > 0 ? ips : ['119.29.29.29', '8.8.8.8', '1.1.1.1'];
}

export async function checkTxtRecord(
  fqdn: string,
  expectedValue: string,
  options?: { resolverServers?: string[] },
): Promise<TxtDnsCheckResult> {
  const expected = normalizeTxtValue(expectedValue);

  try {
    const resolver = new Resolver();
    if (options?.resolverServers?.length) {
      resolver.setServers(options.resolverServers);
    }

    const records = await Promise.race([
      resolver.resolveTxt(fqdn),
      new Promise<string[][]>((_, reject) =>
        setTimeout(() => reject(new Error('DNS query timeout')), 10_000),
      ),
    ]);
    const found = records.map((parts) => normalizeTxtValue(parts.join('')));
    const ok = found.includes(expected);

    return {
      ok,
      fqdn,
      expected,
      found,
      message: ok
        ? 'DNS TXT 记录已生效'
        : found.length > 0
          ? `DNS 当前 TXT 值为 "${found.join('", "')}"，与期望值不一致。同一根域名下仅保留一条 _cdnauth 记录，请更新为当前加速域名的验证值。`
          : `未查询到 ${fqdn} 的 TXT 记录，请确认已添加并等待 DNS 生效`,
    };
  } catch {
    return {
      ok: false,
      fqdn,
      expected,
      found: [],
      message: `未查询到 ${fqdn} 的 TXT 记录，请确认已添加并等待 DNS 生效`,
    };
  }
}
