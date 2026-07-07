import { describe, expect, test } from "bun:test"
import {
  buildInspectorConfigWriteCommand,
  formatPreviewElementNote,
  previewContextItemKey,
} from "./preview-inspector"

describe("formatPreviewElementNote", () => {
  test("describes selected preview element", () => {
    const note = formatPreviewElementNote({
      url: "http://localhost:5173",
      selector: "button.primary",
      tagName: "button",
      className: "primary",
      text: "Save",
      html: '<button class="primary">Save</button>',
    })

    expect(note).toContain("button.primary")
    expect(note).toContain("Save")
    expect(note).toContain("http://localhost:5173")
  })
})

describe("previewContextItemKey", () => {
  test("deduplicates by selector and html", () => {
    const key = previewContextItemKey({
      url: "http://localhost:5173",
      selector: "button.primary",
      tagName: "button",
      html: "<button>Save</button>",
    })

    expect(key.startsWith("preview:")).toBe(true)
  })
})

describe("buildInspectorConfigWriteCommand", () => {
  test("writes config via node", () => {
    const command = buildInspectorConfigWriteCommand({
      configPath: ".opencode/preview-inspector.config.mjs",
      content: "export default {}",
    })

    expect(command).toContain("writeFileSync")
    expect(command).toContain(".opencode/preview-inspector.config.mjs")
  })
})
