import SftpClient from 'ssh2-sftp-client';
import type { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import fg from 'fast-glob';

export interface ServerUploadOptions {
  host: string;
  username: string;
  password: string;
  port?: number;
  localDir: string;
  remotePath: string;
  clean?: boolean;
  concurrency?: number;
  onProgress?: (processed: number, total: number, file: string) => void;
}

export interface ServerUploadResult {
  uploaded: number;
  skipped: number;
  deleted: number;
  totalBytes: number;
  remotePath: string;
}

type RemoteFileMeta = {
  size: number;
};

type SyncSftpClient = SftpClient & {
  list(path: string): Promise<Array<{ name: string; type: string; size: number }>>;
  delete(path: string): Promise<void>;
  createReadStream(path: string): Readable;
};

function formatSshConnectError(error: unknown, host: string, port: number): Error {
  const message = error instanceof Error ? error.message : String(error);

  if (/authentication methods failed|authentication failed|auth fail/i.test(message)) {
    return new Error(
      'SSH 登录失败。请确认 root 密码正确，并在服务器 /etc/ssh/sshd_config 中设置 PermitRootLogin yes、PasswordAuthentication yes，执行 passwd root 设置密码后运行 systemctl restart sshd。',
    );
  }

  if (/ENOTFOUND|getaddrinfo/i.test(message)) {
    return new Error(`无法解析服务器地址：${host}`);
  }

  if (/ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH/i.test(message)) {
    return new Error(`无法连接 ${host}:${port}，请检查 IP、SSH 端口及安全组/防火墙。`);
  }

  return error instanceof Error ? error : new Error(message);
}

function buildSshConnectConfig(options: ServerUploadOptions) {
  const password = options.password;

  return {
    host: options.host,
    port: options.port ?? 22,
    username: options.username,
    password,
    readyTimeout: 30_000,
    tryKeyboard: true,
    hostVerifier: () => true,
    onKeyboardInteractive: (
      _name: string,
      _instructions: string,
      _instructionsLang: string,
      prompts: Array<{ prompt: string; echo: boolean }>,
      finish: (responses: string[]) => void,
    ) => {
      finish(prompts.map(() => password));
    },
  };
}

function md5(content: Buffer): string {
  return createHash('md5').update(content).digest('hex');
}

async function md5RemoteFile(sftp: SyncSftpClient, remoteFile: string): Promise<string> {
  const hash = createHash('md5');
  const stream = sftp.createReadStream(remoteFile);

  for await (const chunk of stream) {
    hash.update(chunk as Buffer);
  }

  return hash.digest('hex');
}

async function listRemoteFilesRecursive(
  sftp: SyncSftpClient,
  remoteDir: string,
  relativePrefix = '',
): Promise<Map<string, RemoteFileMeta>> {
  const files = new Map<string, RemoteFileMeta>();

  let entries: Array<{ name: string; type: string; size: number }>;
  try {
    entries = (await sftp.list(remoteDir)) as Array<{ name: string; type: string; size: number }>;
  } catch {
    return files;
  }

  for (const entry of entries) {
    if (entry.name === '.' || entry.name === '..') continue;

    const relativePath = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
    const remoteEntryPath = `${remoteDir}/${entry.name}`;

    if (entry.type === 'd') {
      const nested = await listRemoteFilesRecursive(sftp, remoteEntryPath, relativePath);
      for (const [path, meta] of nested) {
        files.set(path, meta);
      }
      continue;
    }

    if (entry.type === '-' || entry.type === 'l') {
      files.set(relativePath.replace(/\\/g, '/'), { size: entry.size });
    }
  }

  return files;
}

async function ensureRemoteDir(sftp: SyncSftpClient, remoteDir: string) {
  if (!remoteDir || remoteDir === '/') return;
  await sftp.mkdir(remoteDir, true);
}

export async function uploadDirectoryToServer(
  options: ServerUploadOptions,
): Promise<ServerUploadResult> {
  const sftp = new SftpClient() as SyncSftpClient;
  const remotePath = options.remotePath.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  const clean = options.clean !== false;
  const concurrency = options.concurrency ?? 5;

  const localFiles = await fg('**/*', {
    cwd: options.localDir,
    onlyFiles: true,
    dot: false,
  });

  if (localFiles.length === 0) {
    throw new Error('构建产物目录为空，请先执行构建');
  }

  try {
    await sftp.connect(buildSshConnectConfig(options));
    await ensureRemoteDir(sftp, remotePath);

    const remoteMap = await listRemoteFilesRecursive(sftp, remotePath);
    const localKeys = new Set<string>();

    let uploaded = 0;
    let skipped = 0;
    let totalBytes = 0;
    let processed = 0;

    async function syncFile(relativePath: string) {
      const normalizedPath = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
      localKeys.add(normalizedPath);

      const localPath = join(options.localDir, relativePath);
      const remoteFile = `${remotePath}/${normalizedPath}`;
      const remoteDir = remoteFile.slice(0, remoteFile.lastIndexOf('/'));

      const localContent = await readFile(localPath);
      const localHash = md5(localContent);
      const remoteMeta = remoteMap.get(normalizedPath);

      if (remoteMeta) {
        if (remoteMeta.size === localContent.length) {
          const remoteHash = await md5RemoteFile(sftp, remoteFile);
          if (remoteHash === localHash) {
            skipped++;
            processed++;
            options.onProgress?.(processed, localFiles.length, normalizedPath);
            return;
          }
        }
      }

      if (remoteDir) {
        await ensureRemoteDir(sftp, remoteDir);
      }

      await sftp.put(localPath, remoteFile);
      uploaded++;
      totalBytes += localContent.length;
      processed++;
      options.onProgress?.(processed, localFiles.length, normalizedPath);
    }

    for (let i = 0; i < localFiles.length; i += concurrency) {
      const batch = localFiles.slice(i, i + concurrency);
      await Promise.all(batch.map(syncFile));
    }

    let deleted = 0;
    if (clean) {
      const toDelete = [...remoteMap.keys()].filter((key) => !localKeys.has(key));
      for (const relativePath of toDelete) {
        await sftp.delete(`${remotePath}/${relativePath}`);
        deleted++;
      }
    }

    return {
      uploaded,
      skipped,
      deleted,
      totalBytes,
      remotePath: `${remotePath}/`,
    };
  } catch (error) {
    throw formatSshConnectError(error, options.host, options.port ?? 22);
  } finally {
    await sftp.end().catch(() => undefined);
  }
}
