import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const SERVER_CONFIG_FILE = 'server-config.json';

const serverConfigSchema = z.object({
  host: z.string().min(1, '服务器主机不能为空'),
  username: z.string().min(1, '用户名不能为空'),
  path: z.string().min(1, '远程路径不能为空'),
  domain: z.string().optional(),
  protocol: z.enum(['http', 'https']).optional(),
});

export type ServerConfig = z.infer<typeof serverConfigSchema>;

export const DEFAULT_SERVER_USERNAME = 'root';
export const DEFAULT_SERVER_PATH = '/var/www/html/';

export function getServerConfigPath(projectRoot: string) {
  return join(projectRoot, SERVER_CONFIG_FILE);
}

export async function loadServerConfig(projectRoot: string): Promise<Partial<ServerConfig>> {
  const configPath = getServerConfigPath(projectRoot);
  if (!existsSync(configPath)) {
    return {};
  }

  const raw = JSON.parse(await readFile(configPath, 'utf-8'));
  return serverConfigSchema.partial().parse(raw);
}

export async function saveServerConfig(projectRoot: string, config: ServerConfig): Promise<void> {
  const normalized = serverConfigSchema.parse(config);
  await writeFile(getServerConfigPath(projectRoot), JSON.stringify(normalized, null, 2), 'utf-8');
}

export function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return DEFAULT_SERVER_PATH;
  }
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}
