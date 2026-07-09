import { describe, expect, test } from "bun:test"
import { buildGitflowManifest, resolveServeProjectRoot } from "./write-files"

const BASE64_CHUNK_SIZE = 1200

function splitBase64(value: string) {
  const chunks: string[] = []
  for (let i = 0; i < value.length; i += BASE64_CHUNK_SIZE) {
    chunks.push(value.slice(i, i + BASE64_CHUNK_SIZE))
  }
  return chunks.length > 0 ? chunks : [""]
}

describe("gitflow serve writer", () => {
  test("manifest keeps project-relative file paths", () => {
    const manifest = buildGitflowManifest({
      ".github/workflows/deploy-cos.yml": "name: deploy\n",
      "scripts/generate-sitemap.mjs": "export {}\n",
    })

    expect(Object.keys(manifest)).toEqual([
      ".github/workflows/deploy-cos.yml",
      "scripts/generate-sitemap.mjs",
    ])
    expect(typeof manifest[".github/workflows/deploy-cos.yml"]).toBe("string")
  })

  test("serve project root prefers sdk directory plus relative package path", () => {
    expect(
      resolveServeProjectRoot("D:/pnpm_workspace", "D:/pnpm_workspace/apps/pnpmvite", "apps/pnpmvite"),
    ).toBe("D:/pnpm_workspace/apps/pnpmvite")
    expect(resolveServeProjectRoot("D:/pnpm_workspace/apps/pnpmvite", "D:/pnpm_workspace/apps/pnpmvite")).toBe(
      "D:/pnpm_workspace/apps/pnpmvite",
    )
  })

  test("large manifests are split into safe pty command chunks", () => {
    const manifest = buildGitflowManifest({
      "scripts/generate-html-md.mjs": "A".repeat(12_000),
    })
    const payload = Buffer.from(JSON.stringify(manifest), "utf8").toString("base64")
    const chunks = splitBase64(payload)

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      const script = `require("fs").appendFileSync("manifest.b64", ${JSON.stringify(chunk)})`
      expect(script.length).toBeLessThan(8_191)
    }
  })
})
