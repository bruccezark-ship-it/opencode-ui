import { formatBytes } from '../builder/vite-builder.js';
import { loadProjectConfig } from '../config/loader.js';
import { buildProjectWithSeo } from './build-with-seo.js';
import {
  normalizeRemotePath,
  saveServerConfig,
  type ServerConfig,
} from '../server/server-config.js';
import { uploadDirectoryToServer } from '../server/server-uploader.js';
import type { RouteDiscoveryOption, RouteDiscoverySelectResult } from '../routes/route-discovery.js';

export interface ServerDeployContext {
  projectRoot: string;
  host: string;
  username: string;
  password: string;
  remotePath: string;
  domain: string;
  protocol: 'http' | 'https';
  siteBaseUrl: string;
}

export interface ServerDeployResult {
  host: string;
  remotePath: string;
  uploaded: number;
  skipped: number;
  deleted: number;
  totalBytes: number;
  buildDuration: number;
  url: string;
  domain: string;
  protocol: 'http' | 'https';
}

export interface ServerDeployOptions {
  noClean?: boolean;
  onStepStart?: (step: number, total: number, name: string) => void;
  onStepComplete?: (step: number, total: number, name: string, message: string) => void;
  onStatus?: (message: string) => void;
  onRouteDiscoverySelect?: (
    options: RouteDiscoveryOption[],
  ) => Promise<RouteDiscoverySelectResult | undefined>;
}

const TOTAL_STEPS = 2;

export async function serverDeploy(
  ctx: ServerDeployContext,
  options: ServerDeployOptions = {},
): Promise<ServerDeployResult> {
  const remotePath = normalizeRemotePath(ctx.remotePath);
  const projectConfig = await loadProjectConfig(ctx.projectRoot);
  const clean = options.noClean === true ? false : projectConfig.cleanRemote;

  options.onStepStart?.(1, TOTAL_STEPS, '构建项目');
  const { outDir, message: buildMessage, buildDuration } = await buildProjectWithSeo({
    projectRoot: ctx.projectRoot,
    siteBaseUrl: ctx.siteBaseUrl,
    projectConfig,
    onStatus: options.onStatus,
    onRouteDiscoverySelect: options.onRouteDiscoverySelect,
  });
  options.onStepComplete?.(1, TOTAL_STEPS, '构建项目', buildMessage);

  options.onStepStart?.(2, TOTAL_STEPS, '上传到服务器');
  const uploadResult = await uploadDirectoryToServer({
    host: ctx.host,
    username: ctx.username,
    password: ctx.password,
    localDir: outDir,
    remotePath,
    clean,
    onProgress: (processed, total, file) => {
      options.onStatus?.(`同步中 (${processed}/${total}): ${file}`);
    },
  });

  const deleteSummary = uploadResult.deleted > 0 ? `, ${uploadResult.deleted} 删除` : '';
  options.onStepComplete?.(
    2,
    TOTAL_STEPS,
    '上传到服务器',
    `同步完成 (${uploadResult.uploaded} 新文件, ${uploadResult.skipped} 跳过${deleteSummary}, ${formatBytes(uploadResult.totalBytes)})`,
  );

  const saved: ServerConfig = {
    host: ctx.host.trim(),
    username: ctx.username.trim(),
    path: remotePath,
    domain: ctx.domain,
    protocol: ctx.protocol,
  };
  await saveServerConfig(ctx.projectRoot, saved);

  return {
    host: saved.host,
    remotePath: uploadResult.remotePath,
    uploaded: uploadResult.uploaded,
    skipped: uploadResult.skipped,
    deleted: uploadResult.deleted,
    totalBytes: uploadResult.totalBytes,
    buildDuration,
    url: ctx.siteBaseUrl,
    domain: ctx.domain,
    protocol: ctx.protocol,
  };
}
