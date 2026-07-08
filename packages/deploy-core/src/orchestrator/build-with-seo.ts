import type { ProjectConfig } from '../config/schema.js';
import { loadProjectConfig } from '../config/loader.js';
import {
  collectRouteDiscoveryResults,
  pickDefaultRouteDiscoveryOption,
  routeDiscoveryOptionToSeoInput,
  type RouteDiscoveryOption,
} from '../routes/route-discovery.js';
import { generateSeoArtifacts } from '../seo/generator.js';
import { buildProjectDist } from './project-build.js';

export interface BuildProjectWithSeoOptions {
  projectRoot: string;
  siteBaseUrl: string;
  projectConfig?: ProjectConfig;
  onStatus?: (message: string) => void;
  onRouteDiscoverySelect?: (
    options: RouteDiscoveryOption[],
  ) => Promise<RouteDiscoveryOption | undefined>;
}

export interface BuildProjectWithSeoResult {
  outDir: string;
  message: string;
  buildCommand: string;
  buildDuration: number;
}

export async function buildProjectWithSeo(
  options: BuildProjectWithSeoOptions,
): Promise<BuildProjectWithSeoResult> {
  const projectConfig = options.projectConfig ?? (await loadProjectConfig(options.projectRoot));
  const {
    outDir: builtOutDir,
    message: baseBuildMessage,
    buildCommand,
    buildResult,
  } = await buildProjectDist(options.projectRoot, projectConfig);

  let message = baseBuildMessage;

  const discoveryOptions = await collectRouteDiscoveryResults({
    projectRoot: options.projectRoot,
    outDir: builtOutDir,
    projectConfig,
    onStatus: options.onStatus,
  });

  const selectedOption =
    discoveryOptions.length === 1
      ? discoveryOptions[0]
      : options.onRouteDiscoverySelect
        ? await options.onRouteDiscoverySelect(discoveryOptions)
        : pickDefaultRouteDiscoveryOption(discoveryOptions, projectConfig.routeFile);

  if (selectedOption) {
    const seoResult = await generateSeoArtifacts({
      projectRoot: options.projectRoot,
      outDir: builtOutDir,
      baseUrl: options.siteBaseUrl,
      onStatus: options.onStatus,
      crawlMaxPages: projectConfig.crawlMaxPages,
      crawlMaxDepth: projectConfig.crawlMaxDepth,
      ...routeDiscoveryOptionToSeoInput(selectedOption),
    });
    message += seoResult.renderedWithBrowser
      ? `; 已生成 sitemap.xml、robots.txt 及 ${seoResult.mdFiles.length} 个页面 md（${selectedOption.label}，浏览器渲染抓取）`
      : `; 已生成 sitemap.xml、robots.txt 及 ${seoResult.mdFiles.length} 个页面 md（${selectedOption.label}）`;
  }

  return {
    outDir: builtOutDir,
    message,
    buildCommand,
    buildDuration: buildResult.duration,
  };
}
