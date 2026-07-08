import COS from 'cos-nodejs-sdk-v5';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import fg from 'fast-glob';
import type { GlobalConfig } from '../config/schema.js';
import { retry } from '../utils/retry.js';
import { getCacheControl, getContentType } from './mime.js';

export interface UploadOptions {
  localDir: string;
  remotePrefix: string;
  config: GlobalConfig;
  concurrency?: number;
  clean?: boolean;
  onProgress?: (uploaded: number, total: number) => void;
}

export interface UploadResult {
  uploaded: number;
  skipped: number;
  deleted: number;
  totalBytes: number;
}

interface CosObjectMeta {
  Key: string;
  ETag?: string;
}

function createCosClient(config: GlobalConfig): COS {
  return new COS({
    SecretId: config.tencent.secretId,
    SecretKey: config.tencent.secretKey,
  });
}

function md5(content: Buffer): string {
  return createHash('md5').update(content).digest('hex');
}

function normalizeEtag(etag?: string): string {
  return (etag ?? '').replace(/"/g, '').toLowerCase();
}

async function listRemoteObjects(
  cos: COS,
  bucket: string,
  region: string,
  prefix: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let marker: string | undefined;

  do {
    const data = (await cos.getBucket({
      Bucket: bucket,
      Region: region,
      Prefix: prefix,
      Marker: marker,
      MaxKeys: 1000,
    })) as { Contents?: CosObjectMeta[]; IsTruncated?: string; NextMarker?: string };

    for (const item of data.Contents ?? []) {
      if (item.Key) {
        map.set(item.Key, normalizeEtag(item.ETag));
      }
    }

    marker = data.IsTruncated === 'true' ? data.NextMarker : undefined;
  } while (marker);

  return map;
}

export async function ensureBucketWebsite(config: GlobalConfig): Promise<void> {
  const cos = createCosClient(config);
  const { bucket } = config.cos;
  const { region } = config.tencent;

  await cos.putBucketWebsite({
    Bucket: bucket,
    Region: region,
    WebsiteConfiguration: {
      IndexDocument: { Suffix: 'index.html' },
      ErrorDocument: { Key: 'index.html' },
    },
  });
}

function resolveLocalFile(localDir: string, relativePath: string): string {
  const normalized = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
  const rootDir = resolve(localDir);
  const absolutePath = resolve(rootDir, normalized);

  if (absolutePath !== rootDir && !absolutePath.startsWith(`${rootDir}${sep}`)) {
    throw new Error(`非法文件路径: ${relativePath}`);
  }

  return absolutePath;
}

export async function uploadDirectory(options: UploadOptions): Promise<UploadResult> {
  const { localDir, remotePrefix, config, concurrency = 10, clean = true } = options;
  const cos = createCosClient(config);
  const { bucket } = config.cos;
  const { region } = config.tencent;

  const localFiles = await fg('**/*', {
    cwd: localDir,
    onlyFiles: true,
    dot: false,
  });

  const remoteMap = await listRemoteObjects(cos, bucket, region, remotePrefix);
  const localKeys = new Set<string>();

  let uploaded = 0;
  let skipped = 0;
  let totalBytes = 0;
  let processed = 0;

  async function uploadFile(relativePath: string) {
    const normalizedPath = relativePath.replace(/^[/\\]+/, '').replace(/\\/g, '/');
    const key = `${remotePrefix}${normalizedPath}`;
    localKeys.add(key);

    const content = await readFile(resolveLocalFile(localDir, relativePath));
    const localHash = md5(content);
    const remoteHash = remoteMap.get(key);

    if (remoteHash && remoteHash === localHash) {
      skipped++;
      processed++;
      options.onProgress?.(processed, localFiles.length);
      return;
    }

    await retry(() =>
      cos.putObject({
        Bucket: bucket,
        Region: region,
        Key: key,
        Body: content,
        ContentType: getContentType(normalizedPath),
        CacheControl: getCacheControl(normalizedPath),
      }),
    );

    uploaded++;
    totalBytes += content.length;
    processed++;
    options.onProgress?.(processed, localFiles.length);
  }

  for (let i = 0; i < localFiles.length; i += concurrency) {
    const batch = localFiles.slice(i, i + concurrency);
    await Promise.all(batch.map(uploadFile));
  }

  let deleted = 0;
  if (clean) {
    const toDelete = [...remoteMap.keys()].filter((key) => !localKeys.has(key));
    for (const key of toDelete) {
      await retry(() =>
        cos.deleteObject({
          Bucket: bucket,
          Region: region,
          Key: key,
        }),
      );
      deleted++;
    }
  }

  return { uploaded, skipped, deleted, totalBytes };
}

export async function deletePrefix(
  config: GlobalConfig,
  prefix: string,
): Promise<{ deleted: number }> {
  const cos = createCosClient(config);
  const { bucket } = config.cos;
  const { region } = config.tencent;
  const remoteMap = await listRemoteObjects(cos, bucket, region, prefix);

  let deleted = 0;
  for (const key of remoteMap.keys()) {
    await retry(() =>
      cos.deleteObject({
        Bucket: bucket,
        Region: region,
        Key: key,
      }),
    );
    deleted++;
  }

  return { deleted };
}
