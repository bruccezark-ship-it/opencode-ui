import type { ServerSDK } from "@/context/server-sdk"
import type { useServerSync } from "@/context/server-sync"
import { decode64 } from "@/utils/base64"

export type GitHubWorkingDirectory = {
  contextDirectory: string
  targetDirectory: string
}

export async function resolveGitHubWorkingDirectory(input: {
  slug?: string
  fallbackDirectory?: string
  serverSync: ReturnType<typeof useServerSync>
  serverSDK: ServerSDK
}): Promise<GitHubWorkingDirectory | undefined> {
  const decoded = (input.slug ? decode64(input.slug) : input.fallbackDirectory)?.trim()
  if (!decoded) return

  const store = input.serverSync().peek(decoded, { bootstrap: false })
  const synced = store[0]?.path?.directory?.trim()
  if (synced) {
    return {
      contextDirectory: decoded,
      targetDirectory: synced,
    }
  }

  const pathResult = await input.serverSDK
    .ensureDirSdkContext(decoded)
    .client.path.get()
    .catch(() => undefined)

  return {
    contextDirectory: decoded,
    targetDirectory: pathResult?.data?.directory?.trim() || decoded,
  }
}
