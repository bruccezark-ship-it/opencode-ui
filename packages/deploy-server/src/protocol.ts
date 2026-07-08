import type { SseEvent } from "./types.js"

export const DEPLOY_EVENT_MARKER = "@@DEPLOY@@"
export const DEPLOY_INPUT_MARKER = "@@DEPLOY_INPUT@@"

export function emitEvent(event: SseEvent | { type: "result"; data: unknown }) {
  process.stdout.write(`${DEPLOY_EVENT_MARKER}${JSON.stringify(event)}\n`)
}

export function parseEventLine(line: string) {
  const trimmed = line.trim()
  if (!trimmed.startsWith(DEPLOY_EVENT_MARKER)) return
  return JSON.parse(trimmed.slice(DEPLOY_EVENT_MARKER.length)) as SseEvent | { type: "result"; data: unknown }
}

export function formatInputLine(payload: unknown) {
  return `${DEPLOY_INPUT_MARKER}${JSON.stringify(payload)}\n`
}
