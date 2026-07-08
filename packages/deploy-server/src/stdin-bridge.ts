import { existsSync, readFileSync, unlinkSync, watchFile } from "node:fs"
import { DEPLOY_INPUT_MARKER } from "./protocol.js"

export type DeployInputAction = {
  action: "verify" | "refresh" | "cancel"
}

function parseDeployInputLine(line: string): DeployInputAction | undefined {
  const trimmed = line.trim()
  if (!trimmed.startsWith(DEPLOY_INPUT_MARKER)) return

  try {
    return JSON.parse(trimmed.slice(DEPLOY_INPUT_MARKER.length)) as DeployInputAction
  } catch {
    return undefined
  }
}

export function createStdinBridge(options: { inputFile?: string } = {}) {
  const queue: DeployInputAction[] = []
  const waiters: Array<(value: DeployInputAction) => void> = []
  let pending = ""
  let inputOffset = 0

  const enqueue = (parsed: DeployInputAction) => {
    const waiter = waiters.shift()
    if (waiter) waiter(parsed)
    else queue.push(parsed)
  }

  const ingest = (chunk: string) => {
    if (!chunk) return
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""

    for (const line of lines) {
      const parsed = parseDeployInputLine(line)
      if (parsed) enqueue(parsed)
    }
  }

  const onData = (chunk: Buffer | string) => {
    ingest(chunk.toString())
  }

  process.stdin.setEncoding("utf8")
  process.stdin.on("data", onData)
  process.stdin.resume()

  let stopFileWatch: (() => void) | undefined
  const inputFile = options.inputFile
  if (inputFile) {
    try {
      if (existsSync(inputFile)) unlinkSync(inputFile)
    } catch {
      // ignore
    }

    watchFile(inputFile, { interval: 250 }, () => {
      try {
        if (!existsSync(inputFile)) return
        const content = readFileSync(inputFile, "utf8")
        const chunk = content.slice(inputOffset)
        inputOffset = content.length
        ingest(chunk)
      } catch {
        // ignore read races
      }
    })

    stopFileWatch = () => {
      try {
        if (existsSync(inputFile)) unlinkSync(inputFile)
      } catch {
        // ignore
      }
    }
  }

  const next = () =>
    new Promise<DeployInputAction>((resolve) => {
      const queued = queue.shift()
      if (queued) {
        resolve(queued)
        return
      }
      waiters.push(resolve)
    })

  const close = () => {
    process.stdin.removeListener("data", onData)
    process.stdin.pause()
    stopFileWatch?.()
  }

  return { next, close }
}
