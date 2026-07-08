import type { BuildResult } from '../builder/vite-builder.js';
import { build, formatDuration } from '../builder/vite-builder.js';
import type { ProjectConfig } from '../config/schema.js';
import { loadProjectConfig } from '../config/loader.js';
import {
  formatProjectStructureKind,
  resolveBuildCommand,
} from '../detector/build-command.js';
import { detectViteProject, resolveOutDir } from '../detector/vite-project.js';

export interface BuildProjectDistResult {
  outDir: string;
  buildResult: BuildResult;
  message: string;
  buildCommand: string;
}

export async function buildProjectDist(
  projectRoot: string,
  projectConfig?: ProjectConfig,
): Promise<BuildProjectDistResult> {
  await detectViteProject(projectRoot);
  const config = projectConfig ?? (await loadProjectConfig(projectRoot));
  const outDir = await resolveOutDir(projectRoot, config.outputDir);
  const { command, structure, source } = await resolveBuildCommand(projectRoot, config.buildCommand);

  const buildResult = await build({
    cwd: projectRoot,
    command,
    outDir,
    workspaceRoot: structure.workspaceRoot,
  });

  const sourceLabel =
    source === 'override'
      ? '自定义'
      : source === 'package.json'
        ? `package.json scripts.build (${structure.buildScript})`
        : '默认 vite build';

  return {
    outDir,
    buildResult,
    buildCommand: command,
    message: `构建完成 (${formatProjectStructureKind(structure.kind)}, ${command}, ${sourceLabel}, ${formatDuration(buildResult.duration)}, ${buildResult.fileCount} files)`,
  };
}
