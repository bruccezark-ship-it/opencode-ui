import type { ProjectConfig } from '../config/schema.js';
import { loadProjectConfig } from '../config/loader.js';
import {
  collectBrowserRouteDiscoveryOption,
  collectStaticRouteDiscoveryResults,
  pickDefaultRouteDiscoveryOption,
  routeDiscoveryOptionToSeoInput,
  shouldSkipBrowserRendering,
  shouldUseBrowserRouteDiscovery,
  type RouteDiscoveryOption,
  type RouteDiscoverySelectResult,
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
  ) => Promise<RouteDiscoverySelectResult | undefined>;
}

export interface BuildProjectWithSeoResult {
  outDir: string;
  message: string;
  buildCommand: string;
  buildDuration: number;
}

async function resolveSelectedRouteOption(
  staticOptions: RouteDiscoveryOption[],
  projectConfig: ProjectConfig,
  onRouteDiscoverySelect?: BuildProjectWithSeoOptions['onRouteDiscoverySelect'],
): Promise<RouteDiscoverySelectResult | undefined> {
  if (staticOptions.length === 0) {
    return undefined;
  }

  if (onRouteDiscoverySelect) {
    return onRouteDiscoverySelect(staticOptions);
  }

  if (staticOptions.length === 1) {
    return staticOptions[0];
  }

  return pickDefaultRouteDiscoveryOption(staticOptions, projectConfig.routeFile);
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

  options.onStatus?.('正在检测路由文件...');
  const staticOptions = await collectStaticRouteDiscoveryResults(options.projectRoot);
  const selection = await resolveSelectedRouteOption(
    staticOptions,
    projectConfig,
    options.onRouteDiscoverySelect,
  );

  let selectedOption: RouteDiscoveryOption | undefined;

  if (selection === 'browser') {
    selectedOption = await collectBrowserRouteDiscoveryOption({
      projectRoot: options.projectRoot,
      outDir: builtOutDir,
      projectConfig,
      onStatus: options.onStatus,
    });
  } else if (selection) {
    selectedOption = shouldUseBrowserRouteDiscovery(selection)
      ? await collectBrowserRouteDiscoveryOption({
          projectRoot: options.projectRoot,
          outDir: builtOutDir,
          projectConfig,
          onStatus: options.onStatus,
        })
      : selection;
    if (selectedOption && !shouldUseBrowserRouteDiscovery(selection)) {
      options.onStatus?.(`使用路由表: ${selectedOption.label}`);
    }
  } else {
    selectedOption = await collectBrowserRouteDiscoveryOption({
      projectRoot: options.projectRoot,
      outDir: builtOutDir,
      projectConfig,
      onStatus: options.onStatus,
    });
  }

  if (selectedOption) {
    const seoResult = await generateSeoArtifacts({
      projectRoot: options.projectRoot,
      outDir: builtOutDir,
      baseUrl: options.siteBaseUrl,
      onStatus: options.onStatus,
      crawlMaxPages: projectConfig.crawlMaxPages,
      crawlMaxDepth: projectConfig.crawlMaxDepth,
      skipBrowserRendering: shouldSkipBrowserRendering(selectedOption),
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
