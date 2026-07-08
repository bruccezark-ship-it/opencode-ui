import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildBrowserInstallHint,
  getPlaywrightCoreVersion,
  resolvePlaywrightCliPath,
  resetBrowserInstallState,
} from './browser-launcher.js';

describe('browser-launcher', () => {
  beforeEach(() => {
    resetBrowserInstallState();
    delete process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
    delete process.env.OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL;
  });

  it('returns playwright-core version', () => {
    expect(getPlaywrightCoreVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('resolves playwright-core cli path', () => {
    expect(resolvePlaywrightCliPath()).toMatch(/cli\.js$/);
  });

  it('mentions manual fallback in hint', () => {
    const hint = buildBrowserInstallHint();
    expect(hint).toContain('playwright-core@');
    expect(hint).toContain('install chromium');
    expect(hint).toContain('OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL');
  });
});
