import type { SseEvent } from "./types.js"

export const DEPLOY_EVENT_MARKER = "@@DEPLOY@@"
export const DEPLOY_INPUT_MARKER = "@@DEPLOY_INPUT@@"

export function emitEvent(event: SseEvent | { type: "result"; data: unknown }): Promise<void> {
  const line = `${DEPLOY_EVENT_MARKER}${JSON.stringify(event)}\n`
  return new Promise((resolve, reject) => {
    process.stdout.write(line, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}

export async function drainDeployOutput(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdout.write("", () => resolve())
  })
}

export function parseEventLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed.startsWith(DEPLOY_EVENT_MARKER)) return
  return JSON.parse(trimmed.slice(DEPLOY_EVENT_MARKER.length)) as SseEvent | { type: "result"; data: unknown }
}

export function formatInputLine(payload: unknown) {
  return `${DEPLOY_INPUT_MARKER}${JSON.stringify(payload)}\n`
}
