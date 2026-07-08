import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execa } from 'execa';
import type { Browser, LaunchOptions } from 'playwright-core';

type ChromiumType = {
  launch: (options?: LaunchOptions) => Promise<Browser>;
  executablePath: () => string;
};

export interface LaunchBrowserOptions {
  onStatus?: (message: string) => void;
}

let browserInstallAttempted = false;

export function getPlaywrightCoreVersion(): string {
  const require = createRequire(import.meta.url);
  return require('playwright-core/package.json').version as string;
}

export function resolvePlaywrightCliPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('playwright-core/package.json');
  return join(dirname(packageJsonPath), 'cli.js');
}

function getBundledExecutable(chromium: ChromiumType): string | undefined {
  try {
    const executablePath = chromium.executablePath();
    return executablePath && existsSync(executablePath) ? executablePath : undefined;
  } catch {
    return undefined;
  }
}

function getExpectedExecutablePath(chromium: ChromiumType): string {
  try {
    return chromium.executablePath();
  } catch {
    return '(未知)';
  }
}

function shouldAutoInstallBrowser(): boolean {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return false;
  }

  if (process.env.OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL === '1') {
    return false;
  }

  return !browserInstallAttempted;
}

async function runPlaywrightCli(args: string[], label: string, onStatus?: (message: string) => void): Promise<void> {
  const cliPath = resolvePlaywrightCliPath();
  onStatus?.(label);

  await execa(process.execPath, [cliPath, ...args], {
    stdio: 'inherit',
    timeout: 600_000,
  });
}

export async function installPlaywrightChromium(onStatus?: (message: string) => void): Promise<void> {
  await runPlaywrightCli(
    ['install', 'chromium'],
    '正在自动下载 Chromium（首次约 150MB，请稍候）...',
    onStatus,
  );

  if (process.platform === 'linux') {
    try {
      await runPlaywrightCli(
        ['install-deps', 'chromium'],
        '正在安装 Chromium 系统依赖（Linux）...',
        onStatus,
      );
    } catch {
      onStatus?.('系统依赖安装未完成，将尝试直接启动浏览器（若失败请手动执行 install-deps）');
    }
  }
}

async function tryLaunchBrowser(chromium: ChromiumType): Promise<Browser> {
  const attempts: Array<{ label: string; options: LaunchOptions }> = [];
  const envExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  const launchArgs = ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'];
  const launchDefaults: LaunchOptions = {
    headless: true,
    timeout: 60_000,
    args: launchArgs,
  };

  if (envExecutable) {
    attempts.push({
      label: 'PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH',
      options: { ...launchDefaults, executablePath: envExecutable },
    });
  }

  const bundled = getBundledExecutable(chromium);
  if (bundled) {
    attempts.push({
      label: 'playwright-bundled-chromium',
      options: { ...launchDefaults, executablePath: bundled },
    });
  }

  for (const channel of ['chrome', 'msedge', 'chrome-beta'] as const) {
    attempts.push({ label: `channel:${channel}`, options: { ...launchDefaults, channel } });
  }

  attempts.push({ label: 'default', options: launchDefaults });

  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await chromium.launch(attempt.options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${attempt.label}: ${message}`);
    }
  }

  const bundledPath = getExpectedExecutablePath(chromium);
  const bundledExists = bundledPath !== '(未知)' && existsSync(bundledPath);

  throw new Error(
    [
      '无法启动浏览器以抓取 SPA 页面内容。',
      `期望的 Chromium 路径: ${bundledPath}${bundledExists ? '' : ' (不存在)'}`,
      '',
      '尝试记录:',
      ...errors.slice(0, 5),
    ].join('\n'),
  );
}

export function buildBrowserInstallHint(): string {
  const version = getPlaywrightCoreVersion();
  return [
    '自动安装浏览器后仍无法启动。',
    `可手动执行: npx playwright-core@${version} install chromium`,
    process.platform === 'linux' ? 'Linux 还需: npx playwright-core install-deps chromium' : '',
    '或设置 PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH 指向 Chrome/Chromium 可执行文件。',
    '禁用自动安装: OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL=1',
  ]
    .filter(Boolean)
    .join('\n');
}

export async function launchHeadlessBrowser(
  chromium: ChromiumType,
  options: LaunchBrowserOptions = {},
): Promise<Browser> {
  const onStatus = options.onStatus ?? ((message: string) => console.log(`  ${message}`));

  try {
    return await tryLaunchBrowser(chromium);
  } catch (firstError) {
    if (!shouldAutoInstallBrowser()) {
      throw firstError;
    }

    browserInstallAttempted = true;
    onStatus('未检测到可用浏览器，正在自动安装适配的 Chromium...');

    try {
      await installPlaywrightChromium(onStatus);
      onStatus('Chromium 安装完成，正在重试...');
      return await tryLaunchBrowser(chromium);
    } catch (installOrLaunchError) {
      const detail =
        installOrLaunchError instanceof Error ? installOrLaunchError.message : String(installOrLaunchError);
      throw new Error(`${buildBrowserInstallHint()}\n\n${detail}`);
    }
  }
}

/** 测试用：重置自动安装状态 */
export function resetBrowserInstallState(): void {
  browserInstallAttempted = false;
}
