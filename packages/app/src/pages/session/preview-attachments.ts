import type { ImageAttachmentPart } from "@/context/prompt"
import type { DirectorySDK } from "@/context/sdk"
import { projectRelativePath, type PreviewTargetElement } from "@/pages/session/preview-inspector"
import { writeHostBinaryFiles } from "@/pages/session/gitflow/write-files"
import type { ProjectStructure } from "@/pages/session/preview-project"
import { joinPath } from "@/pages/session/preview-structure"

export const PREVIEW_ATTACHMENTS_FALLBACK_DIR = ".opencode-preview-attachments"
export const PREVIEW_ATTACHMENTS_PUBLIC_DIR = "public/images"

export function dataUrlBase64(dataUrl: string) {
  const idx = dataUrl.indexOf(",")
  return idx === -1 ? dataUrl : dataUrl.slice(idx + 1)
}

export function sanitizeAttachmentFilename(filename: string) {
  const trimmed = filename.trim()
  const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return safe || "attachment"
}

function structureHasPublicDir(structure: ProjectStructure) {
  const files = new Set([...structure.rootFiles, ...structure.workspaceRootFiles].map((name) => name.toLowerCase()))
  return files.has("public")
}

export function resolvePreviewAttachmentSaveDir(structure: ProjectStructure) {
  if (structureHasPublicDir(structure)) return PREVIEW_ATTACHMENTS_PUBLIC_DIR
  return PREVIEW_ATTACHMENTS_FALLBACK_DIR
}

export function webSrcToPublicRelativePath(src: string) {
  const value = src.trim()
  if (!value || value.startsWith("data:") || /^https?:\/\//i.test(value)) return undefined

  try {
    if (value.startsWith("/")) {
      return joinPath("public", new URL(value, "http://localhost").pathname.replace(/^\/+/, ""))
    }
  } catch {
    // fall through for relative paths
  }

  const cleaned = value.replace(/^\.\/+/, "").replace(/^\/+/, "")
  if (!cleaned || cleaned.includes("..")) return undefined
  if (cleaned.startsWith("public/")) return cleaned
  return joinPath("public", cleaned)
}

export function resolvePreviewAttachmentWebPath(relPath: string) {
  const normalized = relPath.replace(/\\/g, "/").replace(/^\/+/, "")
  if (normalized.startsWith("public/")) {
    return `/${normalized.slice("public/".length)}`
  }
  return undefined
}

export function resolvePreviewAttachmentSavePath(input: {
  structure: ProjectStructure
  attachment: Pick<ImageAttachmentPart, "id" | "filename">
  targetElement?: PreviewTargetElement
}) {
  const fallbackDir = resolvePreviewAttachmentSaveDir(input.structure)
  const safeName = sanitizeAttachmentFilename(input.attachment.filename)

  if (input.targetElement?.assetSrc) {
    const fromTarget = webSrcToPublicRelativePath(input.targetElement.assetSrc)
    if (fromTarget) return projectRelativePath(input.structure, fromTarget)
  }

  return projectRelativePath(input.structure, joinPath(fallbackDir, safeName))
}

export function previewAttachmentRelPath(input: {
  structure: ProjectStructure
  attachment: Pick<ImageAttachmentPart, "id" | "filename">
  targetElement?: PreviewTargetElement
}) {
  return resolvePreviewAttachmentSavePath(input)
}

export async function savePreviewAttachmentsToHost(input: {
  client: DirectorySDK["client"]
  directory: string
  projectRoot: string
  projectRelativeDir?: string
  structure?: ProjectStructure
  targetElement?: PreviewTargetElement
  attachments: ImageAttachmentPart[]
}) {
  if (input.attachments.length === 0) return input.attachments

  const structure =
    input.structure ??
    ({
      kind: "unknown",
      rootDir: "",
      rootFiles: [],
      workspaceRootFiles: [],
      packageJson: null,
      workspacePackageJson: null,
      viteConfig: null,
      workspaceRootDir: "",
      packagePath: input.projectRelativeDir ?? "",
    } satisfies ProjectStructure)

  const files: Record<string, string> = {}
  const pathById = new Map<string, string>()
  const usedPaths = new Set<string>()

  for (const attachment of input.attachments) {
    let rel = previewAttachmentRelPath({
      structure,
      attachment,
      targetElement: input.targetElement,
    })

    if (usedPaths.has(rel)) {
      const safeName = sanitizeAttachmentFilename(attachment.filename)
      const ext = safeName.includes(".") ? safeName.slice(safeName.lastIndexOf(".")) : ""
      const stem = ext ? safeName.slice(0, -ext.length) : safeName
      rel = projectRelativePath(
        structure,
        joinPath(
          resolvePreviewAttachmentSaveDir(structure),
          `${stem}-${attachment.id.slice(0, 8)}${ext}`,
        ),
      )
    }

    usedPaths.add(rel)
    files[rel] = dataUrlBase64(attachment.dataUrl)
    pathById.set(attachment.id, rel)
  }

  await writeHostBinaryFiles({
    client: input.client,
    directory: input.directory,
    projectRoot: input.projectRoot,
    projectRelativeDir: input.projectRelativeDir,
    files,
  })

  return input.attachments.map((attachment) => ({
    ...attachment,
    sourcePath: pathById.get(attachment.id),
  }))
}
