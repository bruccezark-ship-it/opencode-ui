export function normalizeTxtRecordValue(value: string): string {
  return value.replace(/^"|"$/g, '').trim();
}

export function matchesTxtRecordValue(actual: string | undefined, expected: string): boolean {
  if (!actual) return false;
  return normalizeTxtRecordValue(actual) === normalizeTxtRecordValue(expected);
}

/** 域名不在当前 DNSPod 账户，或 API 返回无权限访问该域名 */
export function isDomainNotManagedError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    message.includes('DomainNotExists') ||
    message.includes('ResourceNotFound') ||
    message.includes('域名不存在') ||
    message.includes('NoSuchDomain') ||
    message.includes('无权限') ||
    message.includes('请返回域名列表') ||
    message.includes('UnauthorizedOperation') ||
    message.includes('Unauthorized') ||
    message.includes('NoPermission') ||
    message.includes('has no permission') ||
    message.includes('没有权限') ||
    message.includes('DomainNotBelong') ||
    message.includes('not belong')
  );
}

/** 判断域名 NS 是否已指向 DNSPod（否则写入 DNSPod 的记录不会在公网生效） */
export function isDnsPodNsEffective(actualNs: string[], dnspodNs: string[]): boolean {
  if (actualNs.length === 0) {
    return dnspodNs.length > 0;
  }

  const norm = (value: string) => value.toLowerCase().replace(/\.$/, '');
  const actualSet = new Set(actualNs.map(norm));

  for (const ns of dnspodNs) {
    if (actualSet.has(norm(ns))) {
      return true;
    }
  }

  return actualNs.some((ns) =>
    /(?:^|\.)dnspod\.(?:net|com)|tencentyun\.com|ns\.tencent/i.test(norm(ns)),
  );
}
