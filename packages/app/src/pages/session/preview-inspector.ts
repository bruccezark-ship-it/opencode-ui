import type { ProjectStructure } from "@/pages/session/preview-project"
import { joinPath } from "@/pages/session/preview-structure"

export const PREVIEW_OUTLINE_MESSAGE = "opencode-preview-outline"
export const PREVIEW_PARENT_READY = "opencode-preview-parent-ready"
export const PREVIEW_CAPTURE_REQUEST = "opencode-preview-capture-request"
export const PREVIEW_CAPTURE_RESULT = "opencode-preview-capture-result"
export const PREVIEW_QUERY_LOCATION = "opencode-preview-query-location"
export const PREVIEW_LOCATION_RESULT = "opencode-preview-location-result"
export const PREVIEW_PROXY_PATH = "/__opencode_preview__"

export type PreviewStroke = {
  type: "freehand"
  points: Array<{ x: number; y: number }>
  color: string
  width: number
}

export type PreviewRectMark = {
  type: "rect"
  left: number
  top: number
  width: number
  height: number
  color: string
  strokeWidth: number
}

export type PreviewMark = PreviewStroke | PreviewRectMark

export type PreviewTargetElement = {
  selector: string
  tag: string
  text: string
  left: number
  top: number
  width: number
  height: number
}

export const PREVIEW_SELECTION_PADDING = 24

export const PREVIEW_MAGIC_COLORS = [
  { id: "red", hex: "#E5484D" },
  { id: "blue", hex: "#0090FF" },
  { id: "green", hex: "#30A46C" },
  { id: "yellow", hex: "#F5D90A" },
  { id: "purple", hex: "#8E4EC6" },
  { id: "orange", hex: "#F76808" },
] as const

export type PreviewMagicColorId = (typeof PREVIEW_MAGIC_COLORS)[number]["id"]

export type PreviewCaptureRect = {
  left: number
  top: number
  width: number
  height: number
}

export function fullPreviewCaptureRect(width: number, height: number): PreviewCaptureRect {
  return { left: 0, top: 0, width, height }
}

export function computeSelectionBounds(
  marks: PreviewMark[],
  viewport: { width: number; height: number },
  padding = PREVIEW_SELECTION_PADDING,
): PreviewCaptureRect | undefined {
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity

  for (const mark of marks) {
    if (mark.type === "rect") {
      left = Math.min(left, mark.left)
      top = Math.min(top, mark.top)
      right = Math.max(right, mark.left + mark.width)
      bottom = Math.max(bottom, mark.top + mark.height)
      continue
    }

    const half = mark.width / 2
    for (const point of mark.points) {
      left = Math.min(left, point.x - half)
      top = Math.min(top, point.y - half)
      right = Math.max(right, point.x + half)
      bottom = Math.max(bottom, point.y + half)
    }
  }

  if (!Number.isFinite(left) || !Number.isFinite(top)) return undefined

  const padded = {
    left: Math.max(0, left - padding),
    top: Math.max(0, top - padding),
    right: Math.min(viewport.width, right + padding),
    bottom: Math.min(viewport.height, bottom + padding),
  }

  const width = padded.right - padded.left
  const height = padded.bottom - padded.top
  if (width < 4 || height < 4) return undefined

  return {
    left: padded.left,
    top: padded.top,
    width,
    height,
  }
}

export function selectionCenter(rect: PreviewCaptureRect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  }
}

function drawMark(ctx: CanvasRenderingContext2D, mark: PreviewMark, offset = { x: 0, y: 0 }) {
  if (mark.type === "rect") {
    const x = mark.left - offset.x
    const y = mark.top - offset.y
    ctx.save()
    ctx.fillStyle = mark.color + "33"
    ctx.fillRect(x, y, mark.width, mark.height)
    ctx.strokeStyle = mark.color
    ctx.lineWidth = mark.strokeWidth
    ctx.setLineDash([6, 4])
    ctx.strokeRect(x + mark.strokeWidth / 2, y + mark.strokeWidth / 2, mark.width - mark.strokeWidth, mark.height - mark.strokeWidth)
    ctx.restore()
    return
  }

  if (mark.points.length < 2) return
  ctx.strokeStyle = mark.color
  ctx.lineWidth = mark.width
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.beginPath()
  ctx.moveTo(mark.points[0].x - offset.x, mark.points[0].y - offset.y)
  for (let i = 1; i < mark.points.length; i++) {
    ctx.lineTo(mark.points[i].x - offset.x, mark.points[i].y - offset.y)
  }
  ctx.stroke()
}

export async function compositePreviewScreenshot(input: {
  baseDataUrl: string
  marks: PreviewMark[]
  width: number
  height: number
  crop?: PreviewCaptureRect
}) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const dpr = window.devicePixelRatio || 1
      const crop = input.crop
      const outputWidth = crop?.width ?? input.width
      const outputHeight = crop?.height ?? input.height
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(outputWidth * dpr))
      canvas.height = Math.max(1, Math.round(outputHeight * dpr))
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("canvas unavailable"))
        return
      }
      ctx.scale(dpr, dpr)

      if (crop) {
        ctx.drawImage(
          img,
          crop.left,
          crop.top,
          crop.width,
          crop.height,
          0,
          0,
          crop.width,
          crop.height,
        )
      } else {
        ctx.drawImage(img, 0, 0, input.width, input.height)
      }

      const offset = crop ? { x: crop.left, y: crop.top } : { x: 0, y: 0 }
      for (const mark of input.marks) drawMark(ctx, mark, offset)
      resolve(canvas.toDataURL("image/png"))
    }
    img.onerror = () => reject(new Error("screenshot load failed"))
    img.src = input.baseDataUrl
  })
}

export type PreviewOutlinePayload = {
  type: typeof PREVIEW_OUTLINE_MESSAGE
  url: string
  pathname: string
  title: string
  headings: Array<{ level: number; text: string; selector: string }>
  landmarks: Array<{ role: string; text: string; selector: string }>
  capturedAt: number
}

export type PreviewCaptureResultPayload = {
  type: typeof PREVIEW_CAPTURE_RESULT
  requestId: string
  url: string
  pathname: string
  dataUrl?: string
  error?: string
  outline?: Pick<PreviewOutlinePayload, "headings" | "landmarks" | "title">
  targetElement?: PreviewTargetElement
}

export type PreviewCaptureRequestPayload = {
  type: typeof PREVIEW_CAPTURE_REQUEST
  requestId: string
  rect: PreviewCaptureRect
  queryPoint?: { x: number; y: number }
}

const ENTRY_CANDIDATES = [
  "src/App.tsx",
  "src/App.jsx",
  "src/App.vue",
  "src/main.tsx",
  "src/main.ts",
  "src/main.jsx",
  "src/main.js",
  "src/index.tsx",
  "src/index.ts",
  "src/pages/index.tsx",
  "src/pages/index.vue",
  "app/page.tsx",
  "pages/index.tsx",
  "index.html",
] as const

function normalizePathname(pathname: string) {
  const value = pathname.replace(/\/+$/, "") || "/"
  return value.startsWith("/") ? value : `/${value}`
}

function routeSegment(pathname: string) {
  const normalized = normalizePathname(pathname)
  if (normalized === "/") return ""
  return normalized.replace(/^\//, "")
}

function routeCandidates(segment: string) {
  if (!segment) return [] as string[]
  const clean = segment.split("?")[0]?.split("#")[0] ?? segment
  const parts = clean.split("/").filter(Boolean)
  const last = parts[parts.length - 1] ?? clean
  return [
    `src/pages/${clean}.tsx`,
    `src/pages/${clean}.jsx`,
    `src/pages/${clean}.vue`,
    `src/pages/${clean}/index.tsx`,
    `src/pages/${clean}/index.jsx`,
    `src/pages/${clean}/index.vue`,
    `src/routes/${clean}.tsx`,
    `src/routes/${clean}.jsx`,
    `pages/${clean}.tsx`,
    `pages/${clean}.jsx`,
    `pages/${clean}.vue`,
    `pages/${clean}/index.tsx`,
    `app/${clean}/page.tsx`,
    `app/${last}/page.tsx`,
    `${clean}.html`,
    `${clean}/index.html`,
  ]
}

export function projectRelativePath(structure: ProjectStructure, path: string) {
  const base = structure.rootDir || structure.packagePath || ""
  return base ? joinPath(base, path) : path
}

export function alignPreviewUrlOrigin(url: string, baseUrl: string) {
  try {
    const parsed = new URL(url)
    const base = new URL(baseUrl)
    const loopback = (host: string) => host === "localhost" || host === "127.0.0.1" || host === "[::1]"
    if (parsed.port === base.port && loopback(parsed.hostname) && loopback(base.hostname)) {
      parsed.protocol = base.protocol
      parsed.hostname = base.hostname
    }
    return parsed.toString()
  } catch {
    return url
  }
}

export function mergePreviewUrlPath(baseUrl: string, pathname: string, search = "", hash = "") {
  try {
    const base = new URL(baseUrl)
    base.pathname = pathname.startsWith("/") ? pathname : `/${pathname}`
    base.search = search
    base.hash = hash
    return base.toString()
  } catch {
    return baseUrl
  }
}

export function resolveEffectivePreviewUrl(input: {
  baseUrl: string
  outlineUrl?: string
  captureUrl?: string
  pathname?: string
}) {
  const base = alignPreviewUrlOrigin(resolvePreviewUrlFromProxy(input.baseUrl), input.baseUrl)

  let pathname = input.pathname
  let search = ""
  let hash = ""

  for (const candidate of [input.outlineUrl, input.captureUrl]) {
    if (!candidate) continue
    const resolved = alignPreviewUrlOrigin(resolvePreviewUrlFromProxy(candidate), base)
    try {
      const parsed = new URL(resolved)
      if (parsed.pathname && parsed.pathname !== "/") {
        pathname = parsed.pathname
        search = parsed.search
        hash = parsed.hash
        break
      }
    } catch {
      continue
    }
  }

  if (pathname && pathname !== "/") {
    return mergePreviewUrlPath(base, pathname, search, hash)
  }

  for (const candidate of [input.outlineUrl, input.captureUrl]) {
    if (!candidate) continue
    const resolved = alignPreviewUrlOrigin(resolvePreviewUrlFromProxy(candidate), base)
    try {
      return new URL(resolved).toString()
    } catch {
      continue
    }
  }

  return base
}

export function resolvePreviewSourceFiles(input: { url: string; structure: ProjectStructure }) {
  const pageUrl = resolvePreviewUrlFromProxy(input.url)
  let pathname = "/"
  try {
    pathname = normalizePathname(new URL(pageUrl).pathname)
  } catch {
    pathname = "/"
  }

  const segment = routeSegment(pathname)
  const ordered = new Set<string>()

  for (const candidate of routeCandidates(segment)) {
    ordered.add(projectRelativePath(input.structure, candidate))
  }

  for (const candidate of ENTRY_CANDIDATES) {
    ordered.add(projectRelativePath(input.structure, candidate))
  }

  if (input.structure.kind === "static") {
    if (segment) ordered.add(projectRelativePath(input.structure, `${segment}.html`))
    ordered.add(projectRelativePath(input.structure, "index.html"))
  }

  return [...ordered]
}

export function primaryPreviewSourceFile(input: { url: string; structure: ProjectStructure }) {
  return resolvePreviewSourceFiles(input)[0] ?? ""
}

export function normalizeCaptureRect(input: {
  startX: number
  startY: number
  endX: number
  endY: number
  boundsWidth: number
  boundsHeight: number
}): PreviewCaptureRect | undefined {
  const left = Math.max(0, Math.min(input.startX, input.endX))
  const top = Math.max(0, Math.min(input.startY, input.endY))
  const right = Math.min(input.boundsWidth, Math.max(input.startX, input.endX))
  const bottom = Math.min(input.boundsHeight, Math.max(input.startY, input.endY))
  const width = right - left
  const height = bottom - top
  if (width < 4 || height < 4) return undefined
  return { left, top, width, height }
}

export function buildPreviewMagicPrompt(input: {
  userPrompt: string
  previewUrl: string
  sourceFiles: string[]
  selectColorLabel: string
  selectionRect?: PreviewCaptureRect
  targetElement?: PreviewTargetElement
  outline?: PreviewOutlinePayload | PreviewCaptureResultPayload["outline"]
}) {
  const trimmed = input.userPrompt.trim()
  const primary = input.sourceFiles[0]
  const related = input.sourceFiles.slice(1, 4)

  const lines = [
    `根据提示词修改图中 ${input.selectColorLabel} 标记的目标区域。`,
    "",
    trimmed,
    "",
    `预览 URL：${input.previewUrl}`,
    primary ? `优先修改源文件：${primary}` : "请根据预览 URL 自行定位对应源文件。",
  ]

  if (input.targetElement) {
    const el = input.targetElement
    const label = el.text ? `，文本「${el.text}」` : ""
    lines.push(`目标元素：${el.selector} [${el.tag}]${label}`)
    lines.push(
      `元素位置：x=${Math.round(el.left)} y=${Math.round(el.top)} 宽=${Math.round(el.width)} 高=${Math.round(el.height)}`,
    )
  }

  if (input.selectionRect) {
    const rect = input.selectionRect
    lines.push(
      `选区范围：x=${Math.round(rect.left)} y=${Math.round(rect.top)} 宽=${Math.round(rect.width)} 高=${Math.round(rect.height)}`,
    )
  }

  if (related.length > 0) {
    lines.push(`相关候选文件：${related.join(", ")}`)
  }

  if (input.outline?.title) {
    lines.push(`页面标题：${input.outline.title}`)
  }

  lines.push(
    "",
    "截图已裁剪至选区附近，请优先修改目标元素及其直接相关的样式/文案/结构，避免改动圈选区域以外的内容。",
  )

  return lines.join("\n")
}

export function sanitizePreviewUrl(input: string) {
  const value = input.trim()
  if (!value) return ""
  return resolvePreviewUrlFromProxy(value)
}

export function buildPreviewProxyUrl(appOrigin: string, previewUrl: string) {
  const direct = sanitizePreviewUrl(previewUrl)
  let parsed: URL
  try {
    parsed = new URL(direct)
  } catch {
    return direct
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return direct

  const host = encodeURIComponent(parsed.hostname)
  const port = parsed.port || (parsed.protocol === "https:" ? "443" : "80")
  const path = `${parsed.pathname}${parsed.search}${parsed.hash}`
  const base = appOrigin.replace(/\/+$/, "")
  return `${base}${PREVIEW_PROXY_PATH}/${host}/${port}${path.startsWith("/") ? path : `/${path}`}`
}

export function resolvePreviewUrlFromProxy(input: string) {
  try {
    const parsed = new URL(input, "http://localhost")
    if (!parsed.pathname.startsWith(PREVIEW_PROXY_PATH)) return input

    const rest = parsed.pathname.slice(PREVIEW_PROXY_PATH.length)
    const parts = rest.split("/").filter(Boolean)
    if (parts.length < 2) return input

    const host = decodeURIComponent(parts[0])
    const port = parts[1]
    const path = parts.length > 2 ? `/${parts.slice(2).join("/")}` : "/"
    const numericPort = Number(port)
    const origin =
      numericPort === 80 || numericPort === 443
        ? `http://${host}`
        : `http://${host}:${port}`
    return `${origin}${path}${parsed.search}${parsed.hash}`
  } catch {
    return input
  }
}

export function requestPreviewLocation(input: { frame?: HTMLIFrameElement; timeoutMs?: number }) {
  const timeoutMs = input.timeoutMs ?? 800

  return new Promise<{ url: string; pathname: string } | undefined>((resolve) => {
    if (!input.frame?.contentWindow) {
      resolve(undefined)
      return
    }

    const requestId = crypto.randomUUID?.() ?? String(Date.now())

    const cleanup = (value?: { url: string; pathname: string }) => {
      window.clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      resolve(value)
    }

    const timer = window.setTimeout(() => cleanup(), timeoutMs)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== input.frame.contentWindow) return
      const data = event.data
      if (!data || typeof data !== "object") return
      if (data.type !== PREVIEW_LOCATION_RESULT || data.requestId !== requestId) return
      cleanup({ url: String(data.url ?? ""), pathname: String(data.pathname ?? "/") })
    }

    window.addEventListener("message", onMessage)
    input.frame.contentWindow.postMessage({ type: PREVIEW_QUERY_LOCATION, requestId }, "*")
  })
}

export async function compressPreviewImage(dataUrl: string, maxDimension = 1280, quality = 0.82) {
  return new Promise<string>((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height))
      const width = Math.max(1, Math.round(img.width * scale))
      const height = Math.max(1, Math.round(img.height * scale))
      const canvas = document.createElement("canvas")
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext("2d")
      if (!ctx) {
        reject(new Error("canvas unavailable"))
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL("image/jpeg", quality))
    }
    img.onerror = () => reject(new Error("screenshot load failed"))
    img.src = dataUrl
  })
}

export function injectInspectorScriptIntoHtml(html: string) {
  if (html.includes("opencode-preview-inspector.js")) return html
  const script = `<script src="/opencode-preview-inspector.js"></script>`
  if (html.includes("</head>")) return html.replace("</head>", `${script}</head>`)
  if (html.includes("</body>")) return html.replace("</body>", `${script}</body>`)
  return `${html}${script}`
}

export function requestProxyPreviewCapture(input: {
  previewUrl: string
  appOrigin: string
  rect: PreviewCaptureRect
  bounds: { width: number; height: number }
  requestId: string
  queryPoint?: { x: number; y: number }
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? 15000

  return new Promise<PreviewCaptureResultPayload>((resolve, reject) => {
    const iframe = document.createElement("iframe")
    iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-modals")
    iframe.style.cssText = [
      "position:fixed",
      "left:-10000px",
      "top:0",
      "border:0",
      "visibility:hidden",
      `width:${Math.max(1, Math.round(input.bounds.width))}px`,
      `height:${Math.max(1, Math.round(input.bounds.height))}px`,
    ].join(";")

    const proxyUrl = buildPreviewProxyUrl(input.appOrigin, input.previewUrl)
    let captureRequested = false

    const cleanup = (error?: Error, result?: PreviewCaptureResultPayload) => {
      window.clearTimeout(timer)
      window.removeEventListener("message", onMessage)
      iframe.remove()
      if (error) reject(error)
      else resolve(result!)
    }

    const timer = window.setTimeout(() => cleanup(new Error("preview-capture-timeout")), timeoutMs)

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return
      const data = event.data
      if (!data || typeof data !== "object") return

      if (data.type === PREVIEW_OUTLINE_MESSAGE && !captureRequested) {
        captureRequested = true
        iframe.contentWindow?.postMessage(
          {
            type: PREVIEW_CAPTURE_REQUEST,
            requestId: input.requestId,
            rect: input.rect,
            queryPoint: input.queryPoint,
          },
          "*",
        )
        return
      }

      if (data.type === PREVIEW_CAPTURE_RESULT && data.requestId === input.requestId) {
        cleanup(undefined, data as PreviewCaptureResultPayload)
      }
    }

    window.addEventListener("message", onMessage)
    iframe.onload = () => {
      iframe.contentWindow?.postMessage({ type: PREVIEW_PARENT_READY }, "*")
    }
    document.body.appendChild(iframe)
    iframe.src = proxyUrl
  })
}
