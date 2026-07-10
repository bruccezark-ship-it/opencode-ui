import { describe, expect, test } from "bun:test"
import {
  buildPreviewMagicPrompt,
  buildPreviewProxyUrl,
  computeSelectionBounds,
  injectInspectorScriptIntoHtml,
  normalizeCaptureRect,
  resolveEffectivePreviewUrl,
  resolvePreviewSourceFiles,
  resolvePreviewUrlFromProxy,
  sanitizePreviewUrl,
} from "./preview-inspector"
import type { ProjectStructure } from "./preview-project"

const structure = (overrides: Partial<ProjectStructure> = {}): ProjectStructure => ({
  kind: "node",
  rootDir: "packages/app",
  rootFiles: ["index.html", "vite.config.ts"],
  workspaceRootFiles: [],
  packageJson: { scripts: { dev: "vite" } },
  workspacePackageJson: null,
  viteConfig: "export default {}",
  workspaceRootDir: "",
  packagePath: "packages/app",
  ...overrides,
})

describe("preview-inspector", () => {
  test("resolvePreviewSourceFiles maps route paths to page files", () => {
    const files = resolvePreviewSourceFiles({
      url: "http://localhost:5173/about",
      structure: structure(),
    })
    expect(files[0]).toBe("packages/app/src/pages/about.tsx")
    expect(files).toContain("packages/app/src/App.tsx")
  })

  test("resolvePreviewSourceFiles resolves proxy urls before mapping routes", () => {
    const proxy = buildPreviewProxyUrl("http://localhost:3000", "http://localhost:5173/about")
    const files = resolvePreviewSourceFiles({
      url: proxy,
      structure: structure(),
    })
    expect(files[0]).toBe("packages/app/src/pages/about.tsx")
  })

  test("resolveEffectivePreviewUrl prefers live pathname over root capture url", () => {
    const proxyRoot = buildPreviewProxyUrl("http://localhost:3000", "http://localhost:5173/")
    expect(
      resolveEffectivePreviewUrl({
        baseUrl: "http://localhost:5173/",
        outlineUrl: "http://localhost:5173/dashboard",
        captureUrl: proxyRoot,
        pathname: "/dashboard",
      }),
    ).toBe("http://localhost:5173/dashboard")
  })

  test("resolveEffectivePreviewUrl unwraps proxy outline urls", () => {
    const proxy = buildPreviewProxyUrl("http://localhost:3000", "http://localhost:5173/settings/profile")
    expect(
      resolveEffectivePreviewUrl({
        baseUrl: "http://localhost:5173/",
        outlineUrl: proxy,
      }),
    ).toBe("http://localhost:5173/settings/profile")
  })

  test("normalizeCaptureRect rejects tiny selections", () => {
    expect(
      normalizeCaptureRect({
        startX: 10,
        startY: 10,
        endX: 12,
        endY: 12,
        boundsWidth: 800,
        boundsHeight: 600,
      }),
    ).toBeUndefined()
  })

  test("normalizeCaptureRect clamps to bounds", () => {
    expect(
      normalizeCaptureRect({
        startX: -10,
        startY: 20,
        endX: 900,
        endY: 120,
        boundsWidth: 800,
        boundsHeight: 600,
      }),
    ).toEqual({ left: 0, top: 20, width: 800, height: 100 })
  })

  test("computeSelectionBounds expands freehand marks with padding", () => {
    const bounds = computeSelectionBounds(
      [
        {
          type: "freehand",
          points: [
            { x: 100, y: 100 },
            { x: 150, y: 120 },
          ],
          color: "#E5484D",
          width: 4,
        },
      ],
      { width: 800, height: 600 },
      10,
    )
    expect(bounds).toEqual({ left: 88, top: 88, width: 74, height: 44 })
  })

  test("computeSelectionBounds supports rect marks", () => {
    const bounds = computeSelectionBounds(
      [
        {
          type: "rect",
          left: 20,
          top: 30,
          width: 100,
          height: 50,
          color: "#0090FF",
          strokeWidth: 2,
        },
      ],
      { width: 800, height: 600 },
      0,
    )
    expect(bounds).toEqual({ left: 20, top: 30, width: 100, height: 50 })
  })

  test("buildPreviewMagicPrompt includes color, target element, and selection bounds", () => {
    const prompt = buildPreviewMagicPrompt({
      userPrompt: "把按钮改成红色",
      previewUrl: "http://localhost:5173/",
      sourceFiles: ["packages/app/src/App.tsx"],
      selectColorLabel: "红色",
      selectionRect: { left: 10, top: 20, width: 120, height: 40 },
      targetElement: {
        selector: "button#submit",
        tag: "button",
        text: "立即开始",
        left: 12,
        top: 22,
        width: 116,
        height: 36,
      },
      outline: {
        title: "Demo",
        headings: [{ level: 1, text: "Welcome", selector: "h1" }],
        landmarks: [],
      },
    })
    expect(prompt).toContain("根据提示词修改图中 红色 标记的目标区域")
    expect(prompt).toContain("目标元素：button#submit [button]，文本「立即开始」")
    expect(prompt).toContain("选区范围：x=10 y=20 宽=120 高=40")
    expect(prompt).toContain("把按钮改成红色")
  })

  test("buildPreviewMagicPrompt mentions reference attachments", () => {
    const prompt = buildPreviewMagicPrompt({
      userPrompt: "将选区图片替换为该图片",
      previewUrl: "http://localhost:5173/",
      sourceFiles: ["packages/app/src/App.tsx"],
      selectColorLabel: "红色",
      referenceAttachments: [{ filename: "logo.png" }],
    })
    expect(prompt).toContain("参考附件")
    expect(prompt).toContain("logo.png")
    expect(prompt).toContain("第 2 张及之后的图片")
  })

  test("buildPreviewMagicPrompt mentions saved host attachment paths", () => {
    const prompt = buildPreviewMagicPrompt({
      userPrompt: "将选区图片替换为该图片",
      previewUrl: "http://localhost:5173/",
      sourceFiles: ["packages/app/src/App.tsx"],
      selectColorLabel: "红色",
      referenceAttachments: [
        {
          filename: "git-push.png",
          path: "apps/sidaier/public/images/git-push.png",
          webPath: "/images/git-push.png",
        },
      ],
    })
    expect(prompt).toContain("不要尝试用 write/edit 工具保存或生成 PNG/JPG 等二进制图片")
    expect(prompt).toContain("apps/sidaier/public/images/git-push.png")
    expect(prompt).toContain("Web 引用路径：/images/git-push.png")
    expect(prompt).toContain("无需再次写入二进制内容")
  })

  test("sanitizePreviewUrl strips nested proxy paths on preview origin", () => {
    expect(sanitizePreviewUrl("http://localhost:5173/__opencode_preview__/localhost/5173/about")).toBe(
      "http://localhost:5173/about",
    )
  })

  test("buildPreviewProxyUrl wraps preview url with path prefix", () => {
    const proxy = buildPreviewProxyUrl("http://localhost:3000", "http://localhost:5173/about")
    expect(proxy).toBe("http://localhost:3000/__opencode_preview__/localhost/5173/about")
    expect(resolvePreviewUrlFromProxy(proxy)).toBe("http://localhost:5173/about")
  })

  test("buildPreviewProxyUrl does not double-wrap proxy urls", () => {
    const proxy = buildPreviewProxyUrl("http://localhost:3000", "http://localhost:5173/about")
    expect(buildPreviewProxyUrl("http://localhost:3000", proxy)).toBe(proxy)
  })

  test("injectInspectorScriptIntoHtml adds script once", () => {
    const html = "<html><head></head><body><div>app</div></body></html>"
    const next = injectInspectorScriptIntoHtml(html)
    expect(next).toContain("opencode-preview-inspector.js")
    expect(injectInspectorScriptIntoHtml(next)).toBe(next)
  })
})
