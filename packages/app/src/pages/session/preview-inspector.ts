export const PREVIEW_INSPECTOR_CONFIG_REL_PATH = ".opencode/preview-inspector.config.mjs"

export type PreviewElementSelection = {
  url: string
  selector: string
  tagName: string
  id?: string
  className?: string
  text?: string
  html?: string
}

export const PREVIEW_INSPECTOR_MESSAGES = {
  ready: "oc-preview-inspector-ready",
  edit: "oc-preview-edit",
  selected: "oc-preview-element-selected",
  inject: "oc-preview-inject",
} as const

export function generateInspectorViteConfigContent() {
  return String.raw`import { defineConfig, mergeConfig } from "vite"

const candidates = ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"]

async function loadUserConfig() {
  for (const name of candidates) {
    try {
      const mod = await import(\`./\${name}\`)
      const cfg = mod.default ?? mod
      if (typeof cfg === "function") return await cfg({ command: "serve", mode: "development" })
      return cfg
    } catch {}
  }
  return {}
}

function opencodePreviewInspectorPlugin() {
  return {
    name: "opencode-preview-inspector",
    transformIndexHtml(html) {
      const origin = process.env.OPENCODE_UI_ORIGIN
      if (!origin) return html
      const tag = \`<script src="\${origin}/preview-inspector.js" crossorigin="anonymous" data-ui-origin="\${origin}"></script>\`
      if (html.includes("</head>")) return html.replace("</head>", \`\${tag}</head>\`)
      return \`\${tag}\${html}\`
    },
  }
}

export default defineConfig(async () => {
  const user = await loadUserConfig()
  return mergeConfig(user, { plugins: [opencodePreviewInspectorPlugin()] })
})
`
}

export function inspectorConfigDir(configPath: string) {
  const index = configPath.lastIndexOf("/")
  if (index === -1) return "."
  return configPath.slice(0, index)
}

export function buildInspectorConfigWriteCommand(input: {
  configPath: string
  content: string
}) {
  const dir = inspectorConfigDir(input.configPath)
  const payload = JSON.stringify(input.content)
  const path = input.configPath.replace(/\\/g, "/")
  return `node -e "require('fs').mkdirSync('${dir}',{recursive:true});require('fs').writeFileSync('${path}', ${payload}, 'utf8')"`
}

export function formatPreviewElementNote(input: PreviewElementSelection) {
  const label = input.id ? `${input.tagName}#${input.id}` : input.tagName
  const lines = [
    `The user selected a UI element in the preview (${input.url}):`,
    `- Element: ${label}`,
    `- Selector: ${input.selector}`,
  ]
  if (input.className) lines.push(`- Classes: ${input.className}`)
  if (input.text) lines.push(`- Text: ${input.text}`)
  if (input.html) lines.push(`- HTML: ${input.html}`)
  lines.push("Update the relevant source files to implement the requested change.")
  return lines.join("\n")
}

export function previewContextItemKey(item: PreviewElementSelection) {
  const digest = `${item.url}:${item.selector}:${item.html ?? ""}`
  return `preview:${digest.slice(0, 120)}`
}

export function injectPreviewInspector(iframe: HTMLIFrameElement | undefined, uiOrigin: string) {
  if (!iframe) return false
  try {
    const doc = iframe.contentDocument
    if (!doc || doc.querySelector("[data-oc-inspector]")) return true
    const script = doc.createElement("script")
    script.src = `${uiOrigin}/preview-inspector.js`
    script.crossOrigin = "anonymous"
    script.dataset.uiOrigin = uiOrigin
    script.dataset.ocInspector = "true"
    doc.head.appendChild(script)
    return true
  } catch {
    return false
  }
}
