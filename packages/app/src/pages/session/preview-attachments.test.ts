import { describe, expect, test } from "bun:test"
import {
  dataUrlBase64,
  previewAttachmentRelPath,
  resolvePreviewAttachmentSaveDir,
  resolvePreviewAttachmentWebPath,
  sanitizeAttachmentFilename,
  webSrcToPublicRelativePath,
} from "./preview-attachments"
import type { ProjectStructure } from "./preview-project"

const nodeStructure = (overrides: Partial<ProjectStructure> = {}): ProjectStructure => ({
  kind: "node",
  rootDir: "apps/sidaier",
  rootFiles: ["public", "package.json"],
  workspaceRootFiles: [],
  packageJson: { scripts: { dev: "vite" } },
  workspacePackageJson: null,
  viteConfig: "export default {}",
  workspaceRootDir: "",
  packagePath: "apps/sidaier",
  ...overrides,
})

describe("preview-attachments", () => {
  test("dataUrlBase64 strips the data url prefix", () => {
    expect(dataUrlBase64("data:image/png;base64,AAA")).toBe("AAA")
  })

  test("sanitizeAttachmentFilename keeps safe characters", () => {
    expect(sanitizeAttachmentFilename("logo v2 (1).png")).toBe("logo_v2_1_.png")
  })

  test("resolvePreviewAttachmentSaveDir prefers public/images for vite projects", () => {
    expect(resolvePreviewAttachmentSaveDir(nodeStructure())).toBe("public/images")
  })

  test("webSrcToPublicRelativePath maps web paths to public files", () => {
    expect(webSrcToPublicRelativePath("/images/git-push.png")).toBe("public/images/git-push.png")
  })

  test("previewAttachmentRelPath stores attachments under public/images", () => {
    expect(
      previewAttachmentRelPath({
        structure: nodeStructure(),
        attachment: {
          id: "img001234567890",
          filename: "git-push.png",
        },
      }),
    ).toBe("apps/sidaier/public/images/git-push.png")
  })

  test("previewAttachmentRelPath prefers the selected element asset path", () => {
    expect(
      previewAttachmentRelPath({
        structure: nodeStructure(),
        attachment: {
          id: "img001234567890",
          filename: "upload.png",
        },
        targetElement: {
          selector: "img.hero",
          tag: "img",
          text: "",
          left: 0,
          top: 0,
          width: 100,
          height: 100,
          assetSrc: "/images/git-push.png",
        },
      }),
    ).toBe("apps/sidaier/public/images/git-push.png")
  })

  test("resolvePreviewAttachmentWebPath exposes vite public urls", () => {
    expect(resolvePreviewAttachmentWebPath("apps/sidaier/public/images/git-push.png")).toBeUndefined()
    expect(resolvePreviewAttachmentWebPath("public/images/git-push.png")).toBe("/images/git-push.png")
  })
})
