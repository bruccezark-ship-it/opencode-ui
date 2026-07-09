export type GitflowFramework = "React" | "Vue" | "General" | "Unknown"
export type GitflowBundler = "Vite" | "Webpack" | "Unknown"
export type GitflowLanguage = "TypeScript" | "JavaScript"
export type GitflowPackageManager = "npm" | "pnpm" | "yarn"

export type DetectResult = {
  framework: GitflowFramework
  bundler: GitflowBundler
  language: GitflowLanguage
  routeCandidates: string[]
  projectRoot: string
  subprojectPackageManager: GitflowPackageManager
  packageManagerSource?: string
  hasPackageLock: boolean
  nodeVersion: string
  pythonVersion: string
  projectDirName: string
  defaultDomain: string
  packageManagerVersions: Record<GitflowPackageManager, string>
  isWorkspace: boolean
  isSubproject: boolean
  workspaceRoot: string
  subprojectPath: string
  packageName: string
}

export type GitflowConfig = {
  routesFile: string
  branch: string
  domain: string
  protocol: "http" | "https"
  nodeVersion: string
  pythonVersion: string
  pnpmVersion: string
  npmVersion: string
  yarnVersion: string
  installCmd: string
  buildCmd: string
  installWorkingDirectory: string
  buildWorkingDirectory: string
  framework: GitflowFramework
  bundler: GitflowBundler
  language: GitflowLanguage
  isMonorepo: boolean
  subprojectPath: string
  packageName: string
  subprojectPackageManager: GitflowPackageManager
  hasPackageLock: boolean
  distDir: string
  sitemapScript: string
  htmlMdScript: string
}

export type GeneratedGitflowFiles = {
  workflow: string
  sitemapScript: string
  htmlMdScript: string
}

export type GitflowOutputPaths = {
  workflow: ".github/workflows/deploy-cos.yml"
  sitemapScript: "scripts/generate-sitemap.mjs"
  htmlMdScript: "scripts/generate-html-md.mjs"
}

export const GITFLOW_OUTPUT_PATHS: GitflowOutputPaths = {
  workflow: ".github/workflows/deploy-cos.yml",
  sitemapScript: "scripts/generate-sitemap.mjs",
  htmlMdScript: "scripts/generate-html-md.mjs",
}
