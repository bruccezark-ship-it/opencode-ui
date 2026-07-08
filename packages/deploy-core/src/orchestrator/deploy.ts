import type { DeployContext, DeployOptions, DeployResult } from '../config/schema.js';
import { build } from '../builder/vite-builder.js';
import { formatBytes, formatDuration } from '../builder/vite-builder.js';
import {
  ensureCdnDomain,
  purgeCdnCache,
  resolveExistingCdnEntries,
} from '../cdn/cdn-manager.js';
import { ensureCnameRecord } from '../dns/dns-manager.js';
import {
  collectRouteDiscoveryResults,
  pickDefaultRouteDiscoveryOption,
  routeDiscoveryOptionToSeoInput,
} from '../routes/route-discovery.js';
import { generateSeoArtifacts } from '../seo/generator.js';
import { ensureBucketWebsite, uploadDirectory } from '../uploader/cos-uploader.js';

export async function deploy(
  ctx: DeployContext,
  options: DeployOptions = {},
): Promise<DeployResult> {
  const { config, projectRoot, domains, cosPrefix, outDir, siteBaseUrl } = ctx;
  const clean = options.noClean === true ? false : config.project.cleanRemote;
  const skipCdnAndDns = options.skipCdnAndDns === true;
  const totalSteps = skipCdnAndDns ? 2 : 4;

  options.onStepStart?.(1, totalSteps, '构建项目');
  const buildResult = await build({
    cwd: projectRoot,
    command: config.project.buildCommand,
    outDir,
  });

  let buildMessage = `构建完成 (${formatDuration(buildResult.duration)}, ${buildResult.fileCount} files)`;

  const discoveryOptions = await collectRouteDiscoveryResults({
    projectRoot,
    outDir,
    config,
    onStatus: options.onStatus,
  });

  let selectedOption =
    discoveryOptions.length === 1
      ? discoveryOptions[0]
      : options.onRouteDiscoverySelect
        ? await options.onRouteDiscoverySelect(discoveryOptions)
        : pickDefaultRouteDiscoveryOption(discoveryOptions, config.project.routeFile);

  if (selectedOption) {
    const seoResult = await generateSeoArtifacts({
      projectRoot,
      outDir,
      baseUrl: siteBaseUrl,
      onStatus: options.onStatus,
      crawlMaxPages: config.project.crawlMaxPages,
      crawlMaxDepth: config.project.crawlMaxDepth,
      ...routeDiscoveryOptionToSeoInput(selectedOption),
    });
    buildMessage += seoResult.renderedWithBrowser
      ? `; 已生成 sitemap.xml、robots.txt 及 ${seoResult.mdFiles.length} 个页面 md（${selectedOption.label}，浏览器渲染抓取）`
      : `; 已生成 sitemap.xml、robots.txt 及 ${seoResult.mdFiles.length} 个页面 md（${selectedOption.label}）`;
  }

  options.onStepComplete?.(
    1,
    totalSteps,
    '构建项目',
    buildMessage,
  );

  let cdnEntries;

  if (skipCdnAndDns) {
    cdnEntries = await resolveExistingCdnEntries(
      config,
      domains.map((entry) => entry.fullDomain),
    );
  } else {
    options.onStepStart?.(2, totalSteps, '配置 CDN');
    const cosOriginPath = `/${cosPrefix.replace(/\/$/, '')}`;
    cdnEntries = [];

    for (const entry of domains) {
      const cdnResult = await ensureCdnDomain({
        domain: entry.fullDomain,
        cosOriginPath,
        config,
        managedDns: entry.managedDns,
        dnsZone: entry.dnsZone,
        onVerificationRequired: options.onCdnVerificationRequired,
      });
      cdnEntries.push({
        domain: entry.fullDomain,
        cname: cdnResult.cname,
        created: cdnResult.created,
      });
    }

    const cdnSummary = cdnEntries
      .map(({ domain, created }) => `${domain}${created ? ' (新建)' : ''}`)
      .join(', ');
    options.onStepComplete?.(2, totalSteps, '配置 CDN', `CDN 域名已就绪: ${cdnSummary}`);

    options.onStepStart?.(3, totalSteps, '配置 DNS 解析');
    const dnsMessages: string[] = [];

    for (let i = 0; i < domains.length; i++) {
      const entry = domains[i];
      const cdnEntry = cdnEntries[i];

      if (!entry.managedDns) {
        dnsMessages.push(`${entry.fullDomain} → 手动 CNAME ${cdnEntry.cname}`);
        continue;
      }

      const dnsResult = await ensureCnameRecord({
        subdomain: entry.dnsHost,
        cnameTarget: cdnEntry.cname,
        config,
        dnsZone: entry.dnsZone,
      });
      const dnsLabel = entry.dnsHost === '@' ? '@' : entry.dnsHost;
      dnsMessages.push(
        dnsResult.action === 'skipped'
          ? `CNAME ${dnsLabel} 已正确指向 ${cdnEntry.cname}`
          : `CNAME ${dnsLabel} → ${cdnEntry.cname} (${dnsResult.action})`,
      );
    }

    options.onStepComplete?.(3, totalSteps, '配置 DNS 解析', dnsMessages.join('; '));
  }

  const uploadStep = skipCdnAndDns ? 2 : 4;
  options.onStepStart?.(uploadStep, totalSteps, '上传至 COS');
  await ensureBucketWebsite(config);
  const uploadResult = await uploadDirectory({
    localDir: outDir,
    remotePrefix: cosPrefix,
    config,
    clean,
  });
  options.onStepComplete?.(
    uploadStep,
    totalSteps,
    '上传至 COS',
    `上传完成 (${uploadResult.uploaded} 新文件, ${uploadResult.skipped} 跳过, ${formatBytes(uploadResult.totalBytes)})`,
  );

  const protocol = config.domain.protocol;
  const purgeUrls = domains.flatMap((entry) => [
    `${protocol}://${entry.fullDomain}/`,
    `${protocol}://${entry.fullDomain}/index.html`,
  ]);
  await purgeCdnCache(config, purgeUrls);

  const urls = domains.map((entry) => `${protocol}://${entry.fullDomain}`);

  return {
    url: urls[0],
    urls,
    cosPath: `cos://${config.cos.bucket}/${cosPrefix}`,
    cdnCname: cdnEntries[0].cname,
    cdnEntries,
  };
}
