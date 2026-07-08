import { describe, expect, test } from "bun:test"
import {
  climbPath,
  fileText,
  isWorkspaceRoot,
  loadProjectStructure,
  normalizeRelativePath,
  parseScriptCwd,
  relativeAppDirFromSdk,
} from "./preview-structure"
import { isPreviewStartable } from "./preview-project"

describe("fileText", () => {
  test("extracts text content from FileContent", () => {
    expect(fileText({ type: "text", content: '{"name":"demo"}' })).toBe('{"name":"demo"}')
    expect(fileText("plain")).toBe("plain")
    expect(fileText({ type: "binary", content: "abc" })).toBeUndefined()
  })
})

describe("parseScriptCwd", () => {
  test("reads bun --cwd path", () => {
    expect(parseScriptCwd("bun --cwd packages/app dev")).toBe("packages/app")
  })
})

describe("normalizeRelativePath", () => {
  test("resolves parent segments", () => {
    expect(normalizeRelativePath("../../packages/web")).toBe("packages/web")
    expect(normalizeRelativePath("packages/app")).toBe("packages/app")
  })
})

describe("relativeAppDirFromSdk", () => {
  test("computes sibling and same package paths", () => {
    expect(relativeAppDirFromSdk("packages/ui", "packages/web")).toBe("../web")
    expect(relativeAppDirFromSdk("packages/web", "packages/web")).toBe("")
    expect(relativeAppDirFromSdk("", "packages/app")).toBe("packages/app")
  })
})

describe("isWorkspaceRoot", () => {
  test("detects pnpm and npm workspaces", () => {
    expect(
      isWorkspaceRoot({
        rootDir: "",
        rootFiles: ["package.json", "pnpm-workspace.yaml"],
        packageJson: { scripts: {} },
        viteConfig: null,
      }),
    ).toBe(true)
    expect(
      isWorkspaceRoot({
        rootDir: "",
        rootFiles: ["package.json"],
        packageJson: { workspaces: { packages: ["packages/*"] } },
        viteConfig: null,
      }),
    ).toBe(true)
  })
})

describe("loadProjectStructure", () => {
  test("finds vite app in monorepo subpackage", async () => {
    const files: Record<string, string> = {
      "package.json": JSON.stringify({
        scripts: { dev: "bun --cwd packages/app dev" },
        packageManager: "bun@1.3.14",
        workspaces: { packages: ["packages/*"] },
      }),
      "packages/app/package.json": JSON.stringify({
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "packages/app/vite.config.ts": "export default { server: { port: 3000 } }",
    }

    const list = async (path: string) => {
      if (path === "") {
        return [{ name: "package.json" }, { name: "packages", type: "directory" as const }]
      }
      if (path === "packages") {
        return [{ name: "app", type: "directory" as const }]
      }
      if (path === "packages/app") {
        return [{ name: "package.json" }, { name: "vite.config.ts" }]
      }
      return []
    }

    const read = async (path: string) => files[path]

    const structure = await loadProjectStructure(read, list)
    expect(structure.rootDir).toBe("packages/app")
    expect(structure.packageJson?.scripts?.dev).toBe("vite")
    expect(structure.workspacePackageJson?.scripts?.dev).toBe("bun --cwd packages/app dev")
    expect(structure.workspaceRootFiles).toEqual(["package.json", "packages"])
    expect(structure.viteConfig).toContain("port: 3000")
  })

  test("walks up to pnpm workspace when cwd package is not startable", async () => {
    const files: Record<string, string> = {
      "../../package.json": JSON.stringify({
        scripts: { dev: "pnpm --filter @demo/web dev" },
        packageManager: "pnpm@9.0.0",
      }),
      "../../pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "../../pnpm-lock.yaml": "",
      "../../packages/ui/package.json": JSON.stringify({
        name: "@demo/ui",
        scripts: { build: "tsup" },
      }),
      "../../packages/web/package.json": JSON.stringify({
        name: "@demo/web",
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "../../packages/web/vite.config.ts": "export default {}",
      "package.json": JSON.stringify({
        name: "@demo/ui",
        scripts: { build: "tsup" },
      }),
    }

    const list = async (path: string) => {
      if (path === "") return [{ name: "package.json" }]
      if (path === "../..") {
        return [
          { name: "package.json" },
          { name: "pnpm-workspace.yaml" },
          { name: "pnpm-lock.yaml" },
          { name: "packages", type: "directory" as const },
        ]
      }
      if (path === "../../packages") {
        return [
          { name: "ui", type: "directory" as const },
          { name: "web", type: "directory" as const },
        ]
      }
      if (path === "../../packages/web") return [{ name: "package.json" }, { name: "vite.config.ts" }]
      if (path === "../../packages/ui") return [{ name: "package.json" }]
      return []
    }

    const read = async (path: string) => files[path]

    const structure = await loadProjectStructure(read, list)
    expect(structure.workspaceRootDir).toBe("../..")
    expect(structure.packagePath).toBe("packages/web")
    expect(structure.rootDir).toBe("../web")
    expect(isPreviewStartable(structure)).toBe(true)
    expect(structure.packageJson?.scripts?.dev).toBe("vite")
  })

  test("detects runnable package in pnpm workspace from subpackage cwd", async () => {
    const files: Record<string, string> = {
      "../../package.json": JSON.stringify({
        packageManager: "pnpm@9.0.0",
        workspaces: { packages: ["packages/*"] },
      }),
      "../../pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "../../pnpm-lock.yaml": "",
      "../../packages/web/package.json": JSON.stringify({
        name: "@demo/web",
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "../../packages/web/vite.config.ts": "export default {}",
      "package.json": JSON.stringify({
        name: "@demo/web",
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "vite.config.ts": "export default {}",
    }

    const list = async (path: string) => {
      if (path === "") return [{ name: "package.json" }, { name: "vite.config.ts" }]
      if (path === "../..") {
        return [
          { name: "package.json" },
          { name: "pnpm-workspace.yaml" },
          { name: "pnpm-lock.yaml" },
          { name: "packages", type: "directory" as const },
        ]
      }
      if (path === "../../packages") return [{ name: "web", type: "directory" as const }]
      if (path === "../../packages/web") return [{ name: "package.json" }, { name: "vite.config.ts" }]
      return []
    }

    const read = async (path: string) => files[path]

    const structure = await loadProjectStructure(read, list)
    expect(climbPath(2)).toBe("../..")
    expect(structure.workspaceRootDir).toBe("../..")
    expect(structure.packagePath).toBe("packages/web")
    expect(structure.rootDir).toBe("")
    expect(isPreviewStartable(structure)).toBe(true)
  })

  test("uses worktree root access when parent traversal is unavailable", async () => {
    const worktreeFiles: Record<string, string> = {
      "package.json": JSON.stringify({
        packageManager: "pnpm@9.0.0",
        workspaces: { packages: ["packages/*"] },
      }),
      "pnpm-workspace.yaml": "packages:\n  - packages/*\n",
      "pnpm-lock.yaml": "",
      "packages/web/package.json": JSON.stringify({
        name: "@demo/web",
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "packages/web/vite.config.ts": "export default {}",
    }

    const localFiles: Record<string, string> = {
      "package.json": JSON.stringify({
        name: "@demo/web",
        scripts: { dev: "vite" },
        devDependencies: { vite: "7.1.4" },
      }),
      "vite.config.ts": "export default {}",
    }

    const list = async (path: string) => {
      if (path === "") return [{ name: "package.json" }, { name: "vite.config.ts" }]
      if (path === "../..") return []
      return []
    }

    const read = async (path: string) => localFiles[path]

    const listWorktree = async (path: string) => {
      if (path === "") {
        return [
          { name: "package.json" },
          { name: "pnpm-workspace.yaml" },
          { name: "pnpm-lock.yaml" },
          { name: "packages", type: "directory" as const },
        ]
      }
      if (path === "packages") return [{ name: "web", type: "directory" as const }]
      if (path === "packages/web") return [{ name: "package.json" }, { name: "vite.config.ts" }]
      return []
    }

    const readWorktree = async (path: string) => worktreeFiles[path]

    const structure = await loadProjectStructure(read, list, {
      worktreeRootDir: "../..",
      sdkPackagePath: "packages/web",
      readWorktree,
      listWorktree,
    })

    expect(structure.workspaceRootDir).toBe("../..")
    expect(structure.packagePath).toBe("packages/web")
    expect(structure.workspaceRootFiles).toContain("pnpm-workspace.yaml")
    expect(isPreviewStartable(structure)).toBe(true)
  })
})
