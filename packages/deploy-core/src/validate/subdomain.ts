export const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

export const RESERVED_NAMES = ['www', 'api', 'cdn', 'admin', 'mail', 'ftp', 'dns', 'ns'];

export function validateSubdomain(input: string): string | true {
  const trimmed = input.trim();

  if (!trimmed) {
    return '子域名不能为空';
  }

  if (trimmed !== trimmed.toLowerCase()) {
    return '子域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾';
  }

  const normalized = trimmed.toLowerCase();
  if (!SUBDOMAIN_REGEX.test(normalized)) {
    return '子域名只能包含小写字母、数字和连字符，且不能以连字符开头或结尾';
  }

  if (RESERVED_NAMES.includes(normalized)) {
    return `"${normalized}" 是保留名称，不可使用`;
  }

  return true;
}

export function normalizeSubdomain(input: string): string {
  return input.trim().toLowerCase();
}

export function buildFullDomain(subdomain: string, baseDomain: string): string {
  return `${normalizeSubdomain(subdomain)}.${baseDomain}`;
}

export function buildCosPrefix(prefix: string, subdomain: string): string {
  const normalizedPrefix = prefix.replace(/^\/+|\/+$/g, '');
  const normalizedSub = normalizeSubdomain(subdomain);
  return `${normalizedPrefix}/${normalizedSub}/`;
}
