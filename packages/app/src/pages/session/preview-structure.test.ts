import { describe, expect, test } from "bun:test"
import { fileText, loadProjectStructure, parseScriptCwd } from "./preview-structure"

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
})
