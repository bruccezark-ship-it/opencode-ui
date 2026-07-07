import { describe, expect, test } from "bun:test"
import {
  buildPackageManagerRun,
  buildPreviewPtyLaunch,
  detectPackageManager,
  detectProjectKind,
  formatPreviewShellCommand,
  resolveDevScriptName,
  resolvePreviewStartPlan,
} from "./preview-project"

describe("detectProjectKind", () => {
  test("detects node, static, and python projects", () => {
    expect(detectProjectKind(["package.json"], { scripts: { dev: "vite" } })).toBe("node")
    expect(detectProjectKind(["index.html"], null)).toBe("static")
    expect(detectProjectKind(["manage.py"], null)).toBe("python")
  })
})

describe("detectPackageManager", () => {
  test("prefers lock files", () => {
    expect(detectPackageManager({ rootFiles: ["bun.lock"], packageJson: null })).toBe("bun")
    expect(detectPackageManager({ rootFiles: ["pnpm-lock.yaml"], packageJson: null })).toBe("pnpm")
  })

  test("uses workspace root lock files for monorepo subpackages", () => {
    expect(
      detectPackageManager({
        rootFiles: ["package.json"],
        workspaceRootFiles: ["package.json", "bun.lock"],
        packageJson: { scripts: { dev: "vite" } },
        workspacePackageJson: { packageManager: "bun@1.3.14" },
      }),
    ).toBe("bun")
  })
})

describe("resolveDevScriptName", () => {
  test("prefers dev script", () => {
    expect(resolveDevScriptName({ dev: "vite", start: "node server.js" })).toBe("dev")
    expect(resolveDevScriptName({ start: "node server.js" })).toBe("start")
  })
})

describe("buildPackageManagerRun", () => {
  test("builds bun and npm commands", () => {
    expect(buildPackageManagerRun("bun", "dev")).toEqual({ command: "bun", args: ["run", "dev"] })
    expect(buildPackageManagerRun("npm", "dev", ["--", "--host"])).toEqual({
      command: "npm",
      args: ["run", "dev", "--", "--host"],
    })
  })
})

describe("formatPreviewShellCommand", () => {
  test("wraps cwd and args", () => {
    expect(
      formatPreviewShellCommand({
        command: "bun",
        args: ["run", "dev", "--", "--port", "5173"],
        cwd: "packages/app",
      }),
    ).toBe('cd "packages/app" && bun run dev -- --port 5173')
  })
})

describe("buildPreviewPtyLaunch", () => {
  test("wraps commands for windows shell", () => {
    const launch = buildPreviewPtyLaunch(
      {
        kind: "node",
        label: "bun run dev",
        url: "http://localhost:5173",
        port: 5173,
        command: "bun",
        args: ["run", "dev"],
        env: { BROWSER: "none" },
      },
      "windows",
    )

    expect(launch.command).toBe("cmd.exe")
    expect(launch.args.slice(0, 3)).toEqual(["/d", "/s", "/c"])
    expect(launch.args[3]).toBe("bun run dev")
  })
})

describe("resolvePreviewStartPlan", () => {
  test("creates node dev plan", () => {
    const plan = resolvePreviewStartPlan({
      structure: {
        kind: "node",
        rootDir: "packages/app",
        rootFiles: ["package.json"],
        workspaceRootFiles: ["package.json", "bun.lock"],
        packageJson: { scripts: { dev: "vite" }, devDependencies: { vite: "6.0.0" } },
        workspacePackageJson: { packageManager: "bun@1.3.14" },
        viteConfig: null,
      },
      host: "localhost",
      remote: false,
      preview: { url: "http://localhost:5173", port: 5173 },
    })

    expect(plan).toEqual({
      kind: "node",
      label: "bun run dev (packages/app)",
      url: "http://localhost:5173",
      port: 5173,
      command: "bun",
      args: ["run", "dev"],
      cwd: "packages/app",
      env: { BROWSER: "none" },
      useInspector: true,
    })
  })

  test("starts from workspace root when dev script delegates to subpackage", () => {
    const plan = resolvePreviewStartPlan({
      structure: {
        kind: "node",
        rootDir: "packages/app",
        rootFiles: ["package.json", "vite.config.ts"],
        workspaceRootFiles: ["package.json", "bun.lock"],
        packageJson: { scripts: { dev: "vite" }, devDependencies: { vite: "6.0.0" } },
        workspacePackageJson: {
          scripts: { dev: "bun --cwd packages/app dev" },
          packageManager: "bun@1.3.14",
        },
        viteConfig: "export default { server: { port: 3000 } }",
      },
      host: "localhost",
      remote: false,
      preview: { url: "http://localhost:5173", port: 5173 },
    })

    expect(plan?.label).toBe("bun run dev")
    expect(plan?.cwd).toBeUndefined()
    expect(plan?.command).toBe("bun")
    expect(plan?.args).toEqual(["run", "dev", "--", "--port", "5173", "--strictPort"])
    expect(plan?.useInspector).toBe(true)
  })

  test("adds host flags for remote vite projects", () => {
    const plan = resolvePreviewStartPlan({
      structure: {
        kind: "node",
        rootDir: "",
        rootFiles: ["package.json"],
        workspaceRootFiles: ["package.json"],
        packageJson: { scripts: { dev: "vite" }, devDependencies: { vite: "6.0.0" } },
        workspacePackageJson: { scripts: { dev: "vite" }, devDependencies: { vite: "6.0.0" } },
        viteConfig: null,
      },
      host: "10.0.0.8",
      remote: true,
      preview: { url: "http://10.0.0.8:5173", port: 5173 },
    })

    expect(plan?.args).toEqual(["run", "dev", "--", "--host"])
    expect(plan?.env).toEqual({ BROWSER: "none", HOST: "0.0.0.0", NUXT_HOST: "0.0.0.0" })
  })
})
