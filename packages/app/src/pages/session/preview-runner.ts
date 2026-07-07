import type { DirectorySDK } from "@/context/sdk"
import { probePreviewUrl } from "@/pages/session/preview-url"
import {
  PREVIEW_PTY_TITLE,
  PREVIEW_START_TIMEOUT_MS,
  buildPreviewPtyLaunch,
  formatPreviewShellCommand,
  previewLaunchPlatform,
  type PreviewRunPhase,
  type PreviewStartPlan,
} from "@/pages/session/preview-project"

const PROBE_INTERVAL_MS = 2000
const PTY_STARTUP_CHECK_MS = 2000

export type PreviewStartError = {
  message: string
  command?: string
  exitCode?: number
}

export async function findPreviewPty(client: DirectorySDK["client"], ptyId?: string) {
  const response = await client.pty.list().catch(() => undefined)
  const items = response?.data ?? []
  if (ptyId) {
    const match = items.find((item) => item.id === ptyId)
    if (match) return match
  }
  return items.find((item) => item.title === PREVIEW_PTY_TITLE)
}

async function listRunningPreviewPty(client: DirectorySDK["client"], ptyId?: string) {
  const match = await findPreviewPty(client, ptyId)
  if (match?.status === "running") return match
}

async function verifyPreviewPty(client: DirectorySDK["client"], ptyId: string) {
  await new Promise((resolve) => setTimeout(resolve, PTY_STARTUP_CHECK_MS))
  const response = await client.pty.get({ ptyID: ptyId }).catch(() => undefined)
  const info = response?.data
  if (!info) return { ok: false as const, message: "PTY session not found" }
  if (info.status === "exited") {
    const code = info.exitCode
    return {
      ok: false as const,
      exitCode: code,
      message: code === undefined ? "Process exited immediately" : `Process exited with code ${code}`,
    }
  }
  return { ok: true as const }
}

async function waitForPreviewUrl(url: string, signal: AbortSignal) {
  const started = Date.now()
  while (!signal.aborted) {
    if (await probePreviewUrl(url)) return true
    if (Date.now() - started >= PREVIEW_START_TIMEOUT_MS) return false
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS))
  }
  return false
}

export async function ensurePreviewDevServer(input: {
  client: DirectorySDK["client"]
  plan: PreviewStartPlan
  serverUrl: string
  ptyId?: string
  signal: AbortSignal
  onPhase: (phase: PreviewRunPhase) => void
  onPtyId: (ptyId: string) => void
  onError?: (error: PreviewStartError) => void
}) {
  const displayCommand = formatPreviewShellCommand(input.plan)

  input.onPhase("checking")
  if (await probePreviewUrl(input.plan.url)) {
    input.onPhase("ready")
    return true
  }

  let active = await listRunningPreviewPty(input.client, input.ptyId)
  if (!active) {
    input.onPhase("starting")
    const platform = previewLaunchPlatform(input.serverUrl)
    const launch =
      platform === "windows"
        ? buildPreviewPtyLaunch(input.plan, platform)
        : {
            command: input.plan.command,
            args: input.plan.args,
            env: input.plan.env,
            cwd: input.plan.cwd,
          }

    const created = await input.client.pty
      .create({
        command: launch.command,
        args: launch.args,
        cwd: "cwd" in launch ? launch.cwd : undefined,
        title: PREVIEW_PTY_TITLE,
        env: launch.env,
      })
      .catch((error) => {
        console.error("[session-preview] failed to start dev server", error)
        input.onError?.({
          message: error instanceof Error ? error.message : "Failed to create PTY session",
          command: displayCommand,
        })
        return undefined
      })

    active = created?.data
    if (!active) {
      input.onPhase("failed")
      return false
    }
    input.onPtyId(active.id)

    const verified = await verifyPreviewPty(input.client, active.id)
    if (!verified.ok) {
      input.onError?.({
        message: verified.message,
        command: displayCommand,
        exitCode: verified.exitCode,
      })
      input.onPhase("failed")
      return false
    }
  } else {
    input.onPtyId(active.id)
  }

  input.onPhase("waiting")
  const ready = await waitForPreviewUrl(input.plan.url, input.signal)
  if (!ready) {
    input.onError?.({
      message: `Timed out waiting for ${input.plan.url}`,
      command: displayCommand,
    })
  }
  input.onPhase(ready ? "ready" : "failed")
  return ready
}

export async function stopPreviewDevServer(input: {
  client: DirectorySDK["client"]
  ptyId?: string
}) {
  const pty = await findPreviewPty(input.client, input.ptyId)
  if (!pty) return false

  await input.client.pty.remove({ ptyID: pty.id }).catch((error) => {
    console.error("[session-preview] failed to stop dev server", error)
  })
  return true
}
