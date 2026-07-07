import { describe, expect, test } from "bun:test"
import { PREVIEW_PTY_TITLE } from "./preview-project"
import { findPreviewPty, stopPreviewDevServer } from "./preview-runner"

describe("findPreviewPty", () => {
  test("finds preview pty by title or id", async () => {
    const client = {
      pty: {
        list: async () => ({
          data: [
            { id: "other", title: "shell", status: "running" as const },
            { id: "preview-1", title: PREVIEW_PTY_TITLE, status: "running" as const },
          ],
        }),
      },
    }

    expect((await findPreviewPty(client as never))?.id).toBe("preview-1")
    expect((await findPreviewPty(client as never, "other"))?.id).toBe("other")
  })
})

describe("stopPreviewDevServer", () => {
  test("removes preview pty session", async () => {
    let removed: string | undefined
    const client = {
      pty: {
        list: async () => ({
          data: [{ id: "preview-1", title: PREVIEW_PTY_TITLE, status: "running" as const }],
        }),
        remove: async ({ ptyID }: { ptyID: string }) => {
          removed = ptyID
        },
      },
    }

    expect(await stopPreviewDevServer({ client: client as never })).toBe(true)
    expect(removed).toBe("preview-1")
  })

  test("returns false when no preview pty exists", async () => {
    const client = {
      pty: {
        list: async () => ({ data: [] }),
        remove: async () => {},
      },
    }

    expect(await stopPreviewDevServer({ client: client as never })).toBe(false)
  })
})
