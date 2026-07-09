import type { GitflowFileSystem } from "@opencode-ai/gitflow-core"

function splitPath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  const parts = normalized.split("/").filter(Boolean)
  if (parts.length === 0) return { parent: "", name: "" }
  return { parent: parts.slice(0, -1).join("/"), name: parts[parts.length - 1]! }
}

export function createSdkGitflowFileSystem(input: {
  read: (path: string) => Promise<string | undefined>
  list: (path: string) => Promise<Array<{ name: string; type?: string }>>
}): GitflowFileSystem {
  async function listEntries(path: string) {
    try {
      return await input.list(path)
    } catch {
      return []
    }
  }

  return {
    async read(path) {
      const content = await input.read(path).catch(() => undefined)
      if (content === undefined || content === null) return undefined
      return content
    },
    async list(path) {
      const entries = await listEntries(path)
      return entries.map((entry) => entry.name)
    },
    async exists(path) {
      const { parent, name } = splitPath(path)
      if (!name) {
        const entries = await listEntries("")
        return entries.length > 0
      }

      const entries = await listEntries(parent)
      return entries.some((entry) => entry.name === name)
    },
    async isDirectory(path) {
      const { parent, name } = splitPath(path)
      if (!name) return true

      const entries = await listEntries(parent)
      const entry = entries.find((item) => item.name === name)
      if (entry?.type) return entry.type === "directory"

      try {
        await input.list(path)
        return true
      } catch {
        return false
      }
    },
  }
}

export function resolveGitflowProjectDir(worktree: string, rootDir?: string) {
  const base = worktree.replace(/\\/g, "/").replace(/\/+$/, "")
  const sub = rootDir?.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "") ?? ""
  return sub ? `${base}/${sub}` : base
}

export function basenameFromProjectPath(path: string) {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? ""
}
