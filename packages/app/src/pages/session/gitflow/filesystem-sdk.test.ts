import { describe, expect, test } from "bun:test"
import { createSdkGitflowFileSystem } from "@/pages/session/gitflow/filesystem-sdk"

describe("createSdkGitflowFileSystem", () => {
  test("exists uses parent listing and ignores empty read payloads", async () => {
    const files = new Map<string, string>([
      ["package.json", '{"name":"demo"}'],
      ["pnpm-lock.yaml", "lockfileVersion: 9\n"],
      ["src/routes.tsx", "export const routes = []"],
      ["src/App.tsx", "export default function App() {}"],
    ])

    const dirs: Record<string, Array<{ name: string; type?: string }>> = {
      "": [
        { name: "package.json", type: "file" },
        { name: "pnpm-lock.yaml", type: "file" },
        { name: "src", type: "directory" },
      ],
      src: [
        { name: "routes.tsx", type: "file" },
        { name: "App.tsx", type: "file" },
      ],
    }

    const fs = createSdkGitflowFileSystem({
      async read(path) {
        return files.get(path) ?? ""
      },
      async list(path) {
        return dirs[path] ?? []
      },
    })

    expect(await fs.exists("package-lock.json")).toBe(false)
    expect(await fs.exists("pnpm-lock.yaml")).toBe(true)
    expect(await fs.exists("src/routes.tsx")).toBe(true)
    expect(await fs.exists("src/router.tsx")).toBe(false)
    expect(await fs.exists("src/routes.ts")).toBe(false)
    expect(await fs.exists("src")).toBe(true)
  })
})
