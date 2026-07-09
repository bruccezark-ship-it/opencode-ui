import { createEffect, createMemo, createResource, createSignal, For, onCleanup, Show, untrack } from "solid-js"

import { createStore } from "solid-js/store"

import { useParams } from "@solidjs/router"

import { IconButton } from "@opencode-ai/ui/icon-button"

import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"

import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"

import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"

import { Icon } from "@opencode-ai/ui/v2/icon"

import { TextInputV2 } from "@opencode-ai/ui/v2/text-input-v2"

import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"

import { useLanguage } from "@/context/language"

import { useSDK } from "@/context/sdk"

import { useServerSDK } from "@/context/server-sdk"

import { useSync } from "@/context/sync"

import { useServerSync } from "@/context/server-sync"

import { useLocal } from "@/context/local"

import { sendFollowupDraft } from "@/components/prompt-input/submit"

import type { ImageAttachmentPart } from "@/context/prompt"

import { showToast } from "@/utils/toast"
import { formatServerError } from "@/utils/server-errors"

import { uuid } from "@/utils/uuid"

import {

  previewPhaseMessageKey,

  resolvePreviewStartPlan,

  type PreviewRunPhase,

} from "@/pages/session/preview-project"

import { ensurePreviewDevServer, stopPreviewDevServer, type PreviewStartError } from "@/pages/session/preview-runner"

import { fileText, loadProjectStructure, packagePathFromWorktree, relativePathFromTo } from "@/pages/session/preview-structure"

import {

  buildPreviewUrl,

  normalizePreviewUrl,

  previewHostFromServer,

  probePreviewUrl,

  resolvePreviewTarget,

} from "@/pages/session/preview-url"

import { PreviewCaptureOverlay } from "@/pages/session/preview-capture-overlay"

import {
  buildPreviewMagicPrompt,
  compositePreviewScreenshot,
  computeSelectionBounds,
  compressPreviewImage,
  fullPreviewCaptureRect,
  PREVIEW_MAGIC_COLORS,
  PREVIEW_OUTLINE_MESSAGE,
  PREVIEW_PARENT_READY,
  requestPreviewLocation,
  requestProxyPreviewCapture,
  resolveEffectivePreviewUrl,
  resolvePreviewSourceFiles,
  sanitizePreviewUrl,
  selectionCenter,
  type PreviewCaptureResultPayload,
  type PreviewMagicColorId,
  type PreviewMark,
  type PreviewOutlinePayload,
} from "@/pages/session/preview-inspector"

import { Persist, persisted } from "@/utils/persist"
import { useDialog } from "@opencode-ai/ui/context/dialog"



const PROBE_INTERVAL_MS = 3000



export function SessionPreviewTab() {

  const language = useLanguage()
  const dialog = useDialog()
  const params = useParams<{ id?: string }>()
  const local = useLocal()
  const sync = useSync()
  const serverSync = useServerSync()

  const sdk = useSDK()

  const serverSDK = useServerSDK()



  const [store, setStore] = persisted(

    Persist.serverWorkspace(serverSDK().scope, sdk().directory, "preview-url"),

    createStore({

      override: "" as string,

      ptyId: "" as string,

      previewUrl: "" as string,

    }),

  )



  const [draft, setDraft] = createSignal("")

  const [reloadKey, setReloadKey] = createSignal(0)

  const [reachable, setReachable] = createSignal<boolean | undefined>()

  const [draftTouched, setDraftTouched] = createSignal(false)

  const [phase, setPhase] = createSignal<PreviewRunPhase>("idle")

  const [startError, setStartError] = createSignal<PreviewStartError | undefined>()

  const [startToken, setStartToken] = createSignal(0)

  const [autoStart, setAutoStart] = createSignal(true)

  const [stopping, setStopping] = createSignal(false)

  const [magicMode, setMagicMode] = createSignal(false)
  const [magicSending, setMagicSending] = createSignal(false)
  const [inspectorReady, setInspectorReady] = createSignal(false)
  const [previewOutline, setPreviewOutline] = createSignal<PreviewOutlinePayload | undefined>()
  const [livePreviewUrl, setLivePreviewUrl] = createSignal<string | undefined>()

  let previewFrame: HTMLIFrameElement | undefined



  const readFile = async (path: string) => {

    const result = await sdk().client.file.read({ path })

    return fileText(result.data)

  }



  const listFiles = async (path: string) => {

    const result = await sdk().client.file.list({ path })

    return result.data ?? []

  }



  const worktree = createMemo(() => sync().data.path?.worktree ?? sdk().directory)

  const worktreeRootDir = createMemo(() => relativePathFromTo(sdk().directory, worktree()))

  const sdkPackagePath = createMemo(() => packagePathFromWorktree(worktree(), sdk().directory))



  const readWorktreeFile = async (path: string) => {

    const root = worktree()

    if (root === sdk().directory) return readFile(path)

    const result = await sdk().client.file.read({ directory: root, path })

    return fileText(result.data)

  }



  const listWorktreeFiles = async (path: string) => {

    const root = worktree()

    if (root === sdk().directory) return listFiles(path)

    const result = await sdk().client.file.list({ directory: root, path })

    return result.data ?? []

  }



  const [projectStructure, { refetch: refetchStructure }] = createResource(

    () => `${serverSDK().scope}\0${sdk().directory}\0${worktree()}`,

    () =>
      loadProjectStructure(readFile, listFiles, {
        worktreeRootDir: worktreeRootDir(),
        sdkPackagePath: sdkPackagePath(),
        readWorktree: readWorktreeFile,
        listWorktree: listWorktreeFiles,
      }),

  )



  const previewHost = createMemo(() => previewHostFromServer(sdk().url))

  const remoteHost = createMemo(() => previewHost() !== "localhost")



  const previewTarget = createMemo(() => {

    const structure = projectStructure()

    if (!structure || structure.kind === "unknown") return

    return resolvePreviewTarget({

      kind: structure.kind,

      packageJson: structure.packageJson,

      viteConfig: structure.viteConfig,

      host: previewHost(),

      rootFiles: structure.rootFiles,

    })

  })



  const startPlan = createMemo(() => {

    const structure = projectStructure()

    const preview = previewTarget()

    if (!structure || !preview) return

    return resolvePreviewStartPlan({

      structure,

      host: previewHost(),

      remote: remoteHost(),

      preview,

    })

  })



  const activeUrl = createMemo(() => {
    const override = sanitizePreviewUrl(normalizePreviewUrl(store.override))
    if (override) return override

    const resolved = sanitizePreviewUrl(normalizePreviewUrl(store.previewUrl))
    if (resolved) return resolved

    if (!startPlan()) return ""

    return sanitizePreviewUrl(previewTarget()?.url ?? "")
  })



  createEffect(() => {

    if (draftTouched()) return

    const url = activeUrl()

    if (url) setDraft(url)

  })



  createEffect(() => {

    const url = activeUrl()

    if (!url) {

      setReachable(undefined)

      return

    }



    let cancelled = false

    const check = async () => {

      const ok = await probePreviewUrl(url)

      if (!cancelled) setReachable(ok)

    }



    void check()

    const timer = setInterval(() => {

      void check()

    }, PROBE_INTERVAL_MS)



    onCleanup(() => {

      cancelled = true

      clearInterval(timer)

    })

  })



  createEffect(() => {

    if (store.override) {

      setPhase("idle")

      return

    }



    if (!autoStart()) return



    const plan = startPlan()

    const structure = projectStructure()

    if (!plan || !structure || projectStructure.loading) return

    startToken()

    setStartError(undefined)



    const abort = new AbortController()

    const ptyId = untrack(() => store.ptyId) || undefined

    const storedUrl = untrack(() => store.previewUrl) || undefined



    void ensurePreviewDevServer({

      client: sdk().client,

      plan,

      serverUrl: sdk().url,

      ptyId,

      storedUrl,

      signal: abort.signal,

      onPhase: setPhase,

      onPtyId: (next) => {

        if (untrack(() => store.ptyId) !== next) setStore("ptyId", next)

      },

      onResolvedUrl: (url) => {

        if (untrack(() => store.previewUrl) !== url) setStore("previewUrl", url)

      },

      resolvePlanWithPort: (port) => {

        const preview = resolvePreviewTarget({

          kind: structure.kind,

          packageJson: structure.packageJson,

          viteConfig: structure.viteConfig,

          host: previewHost(),

          rootFiles: structure.rootFiles,

        })

        if (!preview) return plan

        return (

          resolvePreviewStartPlan({

            structure,

            host: previewHost(),

            remote: remoteHost(),

            preview: { url: buildPreviewUrl(previewHost(), port), port },

          }) ?? plan

        )

      },

      onError: setStartError,

    }).then((ready) => {

      if (abort.signal.aborted) return

      if (ready) setReloadKey((key) => key + 1)

    })



    onCleanup(() => abort.abort())

  })



  const commitUrl = () => {
    const next = sanitizePreviewUrl(normalizePreviewUrl(draft()))
    if (!next) return

    setStore("override", next)

    setDraft(next)

    setDraftTouched(false)

    setPhase("idle")

    setReloadKey((key) => key + 1)

  }



  const resetUrl = () => {

    setStore("override", "")

    setDraftTouched(false)

    setAutoStart(true)

    setStartToken((token) => token + 1)

    setReloadKey((key) => key + 1)

  }



  const refresh = () => {

    void refetchStructure()

    setAutoStart(true)

    setStartToken((token) => token + 1)

    setReloadKey((key) => key + 1)

  }



  const stopServer = async () => {

    if (stopping()) return

    setStopping(true)

    await stopPreviewDevServer({

      client: sdk().client,

      ptyId: store.ptyId || undefined,

    })

    setStore("ptyId", "")

    setStore("previewUrl", "")

    setAutoStart(false)

    setPhase("idle")

    setReachable(false)

    setStartError(undefined)

    setReloadKey((key) => key + 1)

    setStopping(false)

  }



  const openExternal = () => {

    const url = activeUrl()

    if (!url) return

    window.open(url, "_blank", "noopener,noreferrer")

  }

  const openCosPublish = () => {
    const root = worktree()
    void import("@/components/dialog-cos-publish").then((module) => {
      dialog.show(() => <module.DialogCosPublish projectRoot={root} />)
    })
  }

  const openServerPublish = () => {
    const root = worktree()
    void import("@/components/dialog-server-publish").then((module) => {
      dialog.show(() => <module.DialogServerPublish projectRoot={root} />)
    })
  }

  const [publishedDomains, setPublishedDomains] = createSignal<
    Array<{ domain: string; url: string; cosPath: string; publishedAt: string }>
  >([])
  const [domainsLoading, setDomainsLoading] = createSignal(false)

  const deployCtx = createMemo(() => ({
    client: sdk().client,
    serverUrl: sdk().url,
    directory: sdk().directory,
    projectRoot: worktree(),
  }))

  async function loadPublishedDomains() {
    setDomainsLoading(true)
    try {
      const { fetchDomainRegistry } = await import("@/pages/session/cos-deploy")
      const data = await fetchDomainRegistry(deployCtx())
      setPublishedDomains(data.domains)
    } catch {
      setPublishedDomains([])
    } finally {
      setDomainsLoading(false)
    }
  }

  const openCosUndeploy = (domain: string) => {
    const root = worktree()
    void import("@/components/dialog-cos-undeploy").then((module) => {
      dialog.show(() => (
        <module.DialogCosUndeploy
          projectRoot={root}
          domain={domain}
          onComplete={() => void loadPublishedDomains()}
        />
      ))
    })
  }

  const gitflowProjectRelative = createMemo(() => {
    const structure = projectStructure()
    if (!structure || structure.kind !== "node") return ""
    const path = structure.packagePath || structure.rootDir || ""
    return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "")
  })

  const gitflowProjectRoot = createMemo(() => {
    const relative = gitflowProjectRelative()
    const root = worktree()
    return relative ? `${root.replace(/\\/g, "/").replace(/\/+$/, "")}/${relative}` : root
  })

  const canGitflow = createMemo(() => {
    const structure = projectStructure()
    return structure?.kind === "node" && !projectStructure.loading
  })

  const openGitflow = () => {
    const root = gitflowProjectRoot()
    const relative = gitflowProjectRelative()
    void import("@/components/dialog-gitflow").then((module) => {
      dialog.show(() => (
        <module.DialogGitflow
          projectRoot={root}
          projectRelativeDir={relative || undefined}
          readFile={readWorktreeFile}
          listFiles={listWorktreeFiles}
        />
      ))
    })
  }



  const notifyInspector = () => {
    previewFrame?.contentWindow?.postMessage({ type: PREVIEW_PARENT_READY }, "*")
  }

  const magicColors = createMemo(() =>
    PREVIEW_MAGIC_COLORS.map((color) => ({
      id: color.id,
      hex: color.hex,
      label: language.t(`session.preview.magic.color.${color.id}`),
    })),
  )

  const requestPreviewCapture = (input: {
    previewUrl: string
    bounds: { width: number; height: number }
    selectionRect?: ReturnType<typeof computeSelectionBounds>
  }) => {
    const requestId = uuid()
    const queryPoint = input.selectionRect ? selectionCenter(input.selectionRect) : undefined
    return requestProxyPreviewCapture({
      previewUrl: input.previewUrl,
      appOrigin: window.location.origin,
      rect: fullPreviewCaptureRect(input.bounds.width, input.bounds.height),
      bounds: input.bounds,
      requestId,
      queryPoint,
    })
  }

  const handleMagicSubmit = async (input: {
    marks: PreviewMark[]
    color: string
    colorId: PreviewMagicColorId
    prompt: string
    bounds: { width: number; height: number }
  }) => {
    const sessionID = params.id
    if (!sessionID) {
      showToast({
        title: language.t("session.preview.magic.noSession"),
        variant: "error",
      })
      return
    }

    const currentAgent = local.agent.current()
    const currentModel = local.model.current()
    if (!currentAgent?.name || !currentModel) {
      showToast({
        title: language.t("session.preview.magic.noModel"),
        variant: "error",
      })
      return
    }

    const previewUrl = activeUrl()
    if (!previewUrl) return

    setMagicSending(true)

    try {
      const selectionRect = computeSelectionBounds(input.marks, input.bounds)
      if (!selectionRect) {
        throw new Error("preview-selection-empty")
      }

      const outline = previewOutline()
      const queried = await requestPreviewLocation({ frame: previewFrame })
      const draftUrl = sanitizePreviewUrl(normalizePreviewUrl(draft()))
      const pageUrl = resolveEffectivePreviewUrl({
        baseUrl: previewUrl,
        outlineUrl: queried?.url ?? outline?.url ?? (draftUrl !== previewUrl ? draftUrl : undefined),
        pathname: queried?.pathname ?? outline?.pathname,
      })

      const result = await requestPreviewCapture({
        previewUrl: pageUrl,
        bounds: input.bounds,
        selectionRect,
      })
      if (!result.dataUrl) {
        throw new Error(result.error || "preview-capture-empty")
      }

      const resolvedUrl = resolveEffectivePreviewUrl({
        baseUrl: previewUrl,
        outlineUrl: queried?.url ?? outline?.url ?? (draftUrl !== previewUrl ? draftUrl : undefined),
        captureUrl: result.url,
        pathname: result.pathname ?? queried?.pathname ?? outline?.pathname,
      })
      const markedDataUrl = await compositePreviewScreenshot({
        baseDataUrl: result.dataUrl,
        marks: input.marks,
        width: input.bounds.width,
        height: input.bounds.height,
        crop: selectionRect,
      })
      const dataUrl = await compressPreviewImage(markedDataUrl)

      const structure = projectStructure()
      const sourceFiles = structure ? resolvePreviewSourceFiles({ url: resolvedUrl, structure }) : []
      const selectColorLabel = language.t(`session.preview.magic.color.${input.colorId}`)
      const text = buildPreviewMagicPrompt({
        userPrompt: input.prompt,
        previewUrl: resolvedUrl,
        sourceFiles,
        selectColorLabel,
        selectionRect,
        targetElement: result.targetElement,
        outline: result.outline ?? previewOutline(),
      })

      const image: ImageAttachmentPart = {
        type: "image",
        id: uuid(),
        filename: "preview-marked.jpg",
        mime: "image/jpeg",
        dataUrl,
      }

      const context = sourceFiles.slice(0, 3).map((path) => ({
        key: `file:${path}`,
        type: "file" as const,
        path,
        preview: language.t("session.preview.magic.sourceFile", { path }),
      }))

      const ok = await sendFollowupDraft({
        client: sdk().client,
        sync: sync(),
        serverSync: serverSync(),
        draft: {
          sessionID,
          sessionDirectory: sdk().directory,
          prompt: [{ type: "text", content: text, start: 0, end: text.length }, image],
          context,
          agent: currentAgent.name,
          model: {
            providerID: currentModel.provider.id,
            modelID: currentModel.id,
          },
          variant: local.model.variant.current(),
          textMetadata: {
            "select-color": input.color,
            "select-bounds": selectionRect,
          },
        },
        optimisticBusy: true,
      })

      if (!ok) {
        showToast({
          title: language.t("session.preview.magic.sendFailed"),
          description: language.t("session.preview.magic.sendFailed.description"),
          variant: "error",
        })
        return
      }

      showToast({
        title: language.t("session.preview.magic.sent"),
      })
      exitMagicMode()
    } catch (error) {
      const message = formatServerError(error, language.t)
      const captureFailed =
        message.includes("preview-capture") ||
        message.includes("preview-selection") ||
        message.includes("screenshot") ||
        message.includes("Preview unavailable")
      showToast({
        title: language.t(
          captureFailed ? "session.preview.magic.captureFailed" : "session.preview.magic.sendFailed",
        ),
        description: captureFailed
          ? language.t("session.preview.magic.captureFailed.description")
          : message || language.t("session.preview.magic.sendFailed.description"),
        variant: "error",
      })
    } finally {
      setMagicSending(false)
    }
  }

  const statusKey = createMemo(() => previewPhaseMessageKey(phase()))

  const showIframe = createMemo(() => {
    const url = activeUrl()
    if (!url) return false
    if (store.override) return reachable() === true
    return phase() === "ready"
  })

  const iframeSrc = createMemo(() => activeUrl())

  const exitMagicMode = () => {
    setMagicMode(false)
  }

  const enterMagicMode = () => {
    setMagicMode(true)
  }

  const showStatusBar = createMemo(

    () => !showIframe() && (Boolean(statusKey()) || (!autoStart() && phase() === "idle" && Boolean(startPlan()))),

  )

  const canStopServer = createMemo(() => {

    if (store.override || !startPlan()) return false

    if (store.ptyId) return true

    const current = phase()

    return current === "starting" || current === "waiting" || current === "ready"

  })



  createEffect(() => {
    activeUrl()
    setMagicMode(false)
    setInspectorReady(false)
    setPreviewOutline(undefined)
  })

  createEffect(() => {
    activeUrl()
    reloadKey()
    if (!showIframe()) return

    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || typeof data !== "object") return
      if (data.type === PREVIEW_OUTLINE_MESSAGE) {
        setInspectorReady(true)
        setPreviewOutline(data as PreviewOutlinePayload)
      }
    }

    window.addEventListener("message", onMessage)
    onCleanup(() => window.removeEventListener("message", onMessage))
  })

  return (

    <div class="flex flex-col h-full overflow-hidden">

      <div class="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border-weaker-base bg-background-base">

        <div class="min-w-0 flex-1">

          <TextInputV2

            value={draft()}

            onInput={(event) => {

              setDraftTouched(true)

              setDraft(event.currentTarget.value)

            }}

            onKeyDown={(event) => {

              if (event.key !== "Enter") return

              event.preventDefault()

              commitUrl()

            }}

            placeholder={language.t("session.preview.urlPlaceholder")}

            aria-label={language.t("session.preview.urlPlaceholder")}

          />

        </div>

        <TooltipV2 value={language.t("session.preview.go")}>

          <IconButtonV2

            variant="ghost"

            size="small"

            icon={<Icon name="check" />}

            aria-label={language.t("session.preview.go")}

            onClick={commitUrl}

          />

        </TooltipV2>

        <Show when={store.override}>

          <TooltipV2 value={language.t("session.preview.reset")}>

            <IconButtonV2

              variant="ghost"

              size="small"

              icon={<Icon name="close" />}

              aria-label={language.t("session.preview.reset")}

              onClick={resetUrl}

            />

          </TooltipV2>

        </Show>

        <TooltipV2 value={language.t("session.preview.refresh")}>

          <IconButtonV2

            variant="ghost"

            size="small"

            icon={<Icon name="reset" />}

            aria-label={language.t("session.preview.refresh")}

            onClick={refresh}

          />

        </TooltipV2>

        <Show when={canStopServer()}>

          <TooltipV2 value={language.t("session.preview.stop")}>

            <IconButtonV2

              variant="ghost"

              size="small"

              icon={<Icon name="stop" />}

              aria-label={language.t("session.preview.stop")}

              disabled={stopping()}

              onClick={() => void stopServer()}

            />

          </TooltipV2>

        </Show>

        <DropdownMenu gutter={4} placement="bottom-end">
          <DropdownMenu.Trigger
            as={ButtonV2}
            size="small"
            variant="outline"
            class="shrink-0 gap-1 px-2 data-[expanded]:bg-surface-base-active"
            aria-label={language.t("session.preview.publish")}
          >
            {language.t("session.preview.publish")}
            <Icon name="chevron-down" size="small" class="text-icon-weak" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="min-w-[140px]">
              <DropdownMenu.Item onSelect={openCosPublish}>
                <DropdownMenu.ItemLabel>{language.t("session.preview.publishCos")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
              <DropdownMenu.Item onSelect={openServerPublish}>
                <DropdownMenu.ItemLabel>{language.t("session.preview.publishServer")}</DropdownMenu.ItemLabel>
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>

        <DropdownMenu gutter={4} placement="bottom-end" onOpenChange={(open) => open && void loadPublishedDomains()}>
          <DropdownMenu.Trigger
            as={ButtonV2}
            size="small"
            variant="outline"
            class="shrink-0 gap-1 px-2 data-[expanded]:bg-surface-base-active"
            aria-label={language.t("session.preview.undeploy")}
          >
            {language.t("session.preview.undeploy")}
            <Icon name="chevron-down" size="small" class="text-icon-weak" />
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content class="min-w-[220px] max-h-[280px] overflow-y-auto">
              <Show
                when={!domainsLoading()}
                fallback={
                  <div class="px-3 py-2 text-12-regular text-text-weak">
                    {language.t("session.preview.undeployCos.loading")}
                  </div>
                }
              >
                <Show
                  when={publishedDomains().length > 0}
                  fallback={
                    <div class="px-3 py-2 text-12-regular text-text-weak">
                      {language.t("session.preview.undeployCos.empty")}
                    </div>
                  }
                >
                  <For each={publishedDomains()}>
                    {(entry) => (
                      <DropdownMenu.Item onSelect={() => openCosUndeploy(entry.domain)}>
                        <DropdownMenu.ItemLabel>{entry.domain}</DropdownMenu.ItemLabel>
                        <DropdownMenu.ItemDescription>{entry.url}</DropdownMenu.ItemDescription>
                      </DropdownMenu.Item>
                    )}
                  </For>
                </Show>
              </Show>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu>

        <Show when={canGitflow()}>
          <TooltipV2 value={language.t("session.preview.gitflow")}>
            <ButtonV2
              size="small"
              variant="outline"
              class="shrink-0 gap-1 px-2"
              aria-label={language.t("session.preview.gitflow")}
              onClick={openGitflow}
            >
              <Icon name="branch" size="small" />
              {language.t("session.preview.gitflow")}
            </ButtonV2>
          </TooltipV2>
        </Show>

        <Show when={showIframe()}>
          <TooltipV2 value={language.t("session.preview.magic")}>
            <IconButtonV2
              variant={magicMode() ? "contrast" : "ghost"}
              size="small"
              icon={<Icon name="magic" />}
              aria-label={language.t("session.preview.magic")}
              aria-pressed={magicMode()}
              onClick={() => {
                if (magicMode()) exitMagicMode()
                else enterMagicMode()
              }}
            />
          </TooltipV2>
        </Show>

        <TooltipV2 value={language.t("session.preview.openExternal")}>

          <IconButton

            icon="expand"

            variant="ghost"

            size="small"

            aria-label={language.t("session.preview.openExternal")}

            onClick={openExternal}

          />

        </TooltipV2>

      </div>



      <Show

        when={!projectStructure.loading}

        fallback={

          <div class="flex-1 flex items-center justify-center px-6 text-center text-12-regular text-text-weak">

            {language.t("session.preview.detecting")}

          </div>

        }

      >

        <Show

          when={activeUrl()}

          fallback={

            <div class="flex-1 flex flex-col items-center justify-center px-6 text-center gap-2 text-12-regular text-text-weak">

              <Show

                when={projectStructure()?.kind === "node" && previewTarget() && !startPlan()}

                fallback={

                  <>

                    <div>{language.t("session.preview.noProject")}</div>

                    <div>{language.t("session.preview.noProjectHint")}</div>

                  </>

                }

              >

                <div>{language.t("session.preview.noDevScript")}</div>

              </Show>

            </div>

          }

        >

          {(url) => (

            <>

              <Show when={showStatusBar()}>

                <div class="shrink-0 px-3 py-2 text-12-regular text-text-weak border-b border-border-weaker-base bg-background-stronger">

                  <div>

                    {!autoStart() && phase() === "idle"

                      ? language.t("session.preview.stopped")

                      : language.t(statusKey()!)}

                  </div>

                  <Show when={phase() === "failed" && startError()}>

                    {(error) => (

                      <div class="mt-1 text-11-regular text-text-weaker space-y-0.5">

                        <Show when={error().command}>

                          <div class="truncate">{language.t("session.preview.command", { command: error().command! })}</div>

                        </Show>

                        <Show when={error().exitCode !== undefined}>

                          <div>{language.t("session.preview.exitCode", { code: String(error().exitCode) })}</div>

                        </Show>

                        <Show when={error().message}>

                          <div class="truncate">{error().message}</div>

                        </Show>

                      </div>

                    )}

                  </Show>

                </div>

              </Show>

              <Show when={showIframe()}>

                <div class="relative flex-1 min-h-0 w-full">

                  <iframe

                    ref={previewFrame}

                    key={`${reloadKey()}:${url()}`}

                    src={iframeSrc()}

                    title={language.t("session.tab.preview")}

                    class="absolute inset-0 w-full h-full border-0 bg-background-base"

                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"

                    onLoad={() => notifyInspector()}

                  />

                  <PreviewCaptureOverlay
                    active={magicMode()}
                    hint={language.t("session.preview.magic.hint")}
                    modeRectLabel={language.t("session.preview.magic.modeRect")}
                    modeFreehandLabel={language.t("session.preview.magic.modeFreehand")}
                    undoLabel={language.t("session.preview.magic.undo")}
                    clearLabel={language.t("session.preview.magic.clear")}
                    colors={magicColors()}
                    promptPlaceholder={language.t("session.preview.magic.promptPlaceholder")}
                    promptLabel={language.t("session.preview.magic.promptLabel")}
                    selectFirstHint={language.t("session.preview.magic.selectFirstHint")}
                    submitLabel={
                      magicSending()
                        ? language.t("session.preview.magic.sending")
                        : language.t("session.preview.magic.submit")
                    }
                    cancelLabel={language.t("common.cancel")}
                    sending={magicSending()}
                    onCancel={exitMagicMode}
                    onSubmit={(input) => void handleMagicSubmit(input)}
                  />

                </div>

              </Show>

            </>

          )}

        </Show>

      </Show>

    </div>

  )

}


