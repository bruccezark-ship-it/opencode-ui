import { Button } from "@opencode-ai/ui/button"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { Dialog } from "@opencode-ai/ui/dialog"
import { TextField } from "@opencode-ai/ui/text-field"
import {
  buildPromptConfig,
  createGitflowConfig,
  generateGitflowFiles,
  GITFLOW_OUTPUT_PATHS,
  parseRoutesFromContent,
  resolveGitflowCommands,
  runGitflowDetection,
  type DetectResult,
  type GitflowPackageManager,
} from "@opencode-ai/gitflow-core"
import { createEffect, createMemo, createSignal, For, Match, onCleanup, Show, Switch } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { useSDK } from "@/context/sdk"
import { createSdkGitflowFileSystem, basenameFromProjectPath } from "@/pages/session/gitflow/filesystem-sdk"
import { writeGitflowFiles } from "@/pages/session/gitflow/write-files"
import { showToast } from "@/utils/toast"

type DialogGitflowProps = {
  projectRoot: string
  projectRelativeDir?: string
  readFile: (path: string) => Promise<string | undefined>
  listFiles: (path: string) => Promise<Array<{ name: string; type?: string }>>
}

type Phase = "loading" | "form" | "success" | "error"

export function DialogGitflow(props: DialogGitflowProps) {
  const dialog = useDialog()
  const language = useLanguage()
  const sdk = useSDK()

  const [phase, setPhase] = createSignal<Phase>("loading")
  const [detected, setDetected] = createSignal<DetectResult | undefined>()
  const [error, setError] = createSignal<string | undefined>()
  const [generating, setGenerating] = createSignal(false)
  const [parsedRoutes, setParsedRoutes] = createSignal<string[]>([])
  const [parsedRoutesLoading, setParsedRoutesLoading] = createSignal(false)
  const [parsedRoutesError, setParsedRoutesError] = createSignal<string | undefined>()

  const [store, setStore] = createStore({
    routesFile: "",
    branch: "master",
    domain: "",
    protocol: "https" as "http" | "https",
    nodeVersion: "",
    pythonVersion: "",
    subprojectPackageManager: "pnpm" as GitflowPackageManager,
    pnpmVersion: "",
    npmVersion: "",
    yarnVersion: "",
  })

  const isMonorepo = createMemo(() => {
    const d = detected()
    return Boolean(d?.isWorkspace && d?.isSubproject)
  })

  const routeCandidates = createMemo(() => detected()?.routeCandidates ?? [])
  const hasMultipleRoutes = createMemo(() => routeCandidates().length > 1)

  const allowedPackageManagers = createMemo((): GitflowPackageManager[] =>
    isMonorepo() ? ["npm", "pnpm"] : ["npm", "pnpm", "yarn"],
  )

  const promptPreview = createMemo(() => {
    const d = detected()
    if (!d) return undefined
    return buildPromptConfig(d, {
      routesFile: store.routesFile,
      branch: store.branch,
      domain: store.domain,
      protocol: store.protocol,
      nodeVersion: store.nodeVersion,
      pythonVersion: store.pythonVersion,
      subprojectPackageManager: store.subprojectPackageManager,
      pnpmVersion: store.pnpmVersion,
      npmVersion: store.npmVersion,
      yarnVersion: store.yarnVersion,
    })
  })

  const commands = createMemo(() => {
    const d = detected()
    if (!d) return undefined
    return resolveGitflowCommands(d, store.subprojectPackageManager)
  })

  createEffect(() => {
    void loadDetection()
  })

  createEffect(() => {
    const routesFile = store.routesFile.trim()
    const d = detected()
    if (!routesFile || !d || phase() !== "form") {
      setParsedRoutes([])
      setParsedRoutesError(undefined)
      setParsedRoutesLoading(false)
      return
    }

    let cancelled = false
    setParsedRoutesLoading(true)
    setParsedRoutesError(undefined)

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const prefix = props.projectRelativeDir?.replace(/^\/+|\/+$/g, "") ?? ""
          const path = prefix ? `${prefix}/${routesFile.replace(/^\/+/, "")}` : routesFile
          const content = await props.readFile(path)
          if (cancelled) return

          if (!content) {
            setParsedRoutes([])
            setParsedRoutesError(language.t("session.preview.gitflow.parsedRoutes.fileMissing"))
            return
          }

          const result = parseRoutesFromContent(content, d.framework)
          if (cancelled) return

          setParsedRoutes(result.paths)
          setParsedRoutesError(
            result.paths.length > 0
              ? undefined
              : result.error ?? language.t("session.preview.gitflow.parsedRoutes.empty"),
          )
        } catch {
          if (cancelled) return
          setParsedRoutes([])
          setParsedRoutesError(language.t("session.preview.gitflow.parsedRoutes.failed"))
        } finally {
          if (!cancelled) setParsedRoutesLoading(false)
        }
      })()
    }, 300)

    onCleanup(() => {
      cancelled = true
      window.clearTimeout(timer)
    })
  })

  async function loadDetection() {
    setPhase("loading")
    setError(undefined)
    try {
      const fs = createSdkGitflowFileSystem({
        read: props.readFile,
        list: props.listFiles,
      })
      const result = await runGitflowDetection(fs, props.projectRelativeDir ?? "")
      const relative = props.projectRelativeDir?.replace(/^\/+|\/+$/g, "") ?? ""
      const displayName = relative ? undefined : basenameFromProjectPath(props.projectRoot)
      const detectedResult =
        displayName && result.projectDirName !== displayName
          ? { ...result, projectDirName: displayName, defaultDomain: `www.${displayName}.com` }
          : result
      setDetected(detectedResult)

      const defaults = createGitflowConfig(detectedResult)
      setStore({
        routesFile: defaults.routesFile,
        branch: defaults.branch,
        domain: defaults.domain,
        protocol: defaults.protocol,
        nodeVersion: defaults.nodeVersion,
        pythonVersion: defaults.pythonVersion,
        subprojectPackageManager: defaults.subprojectPackageManager,
        pnpmVersion: defaults.pnpmVersion,
        npmVersion: defaults.npmVersion,
        yarnVersion: defaults.yarnVersion,
      })
      setPhase("form")
    } catch (err) {
      setError(err instanceof Error ? err.message : language.t("session.preview.gitflow.detectFailed"))
      setPhase("error")
    }
  }

  function selectPackageManager(pm: GitflowPackageManager) {
    const d = detected()
    if (!d) {
      setStore("subprojectPackageManager", pm)
      return
    }
    setStore({
      subprojectPackageManager: pm,
      pnpmVersion: d.packageManagerVersions.pnpm,
      npmVersion: d.packageManagerVersions.npm,
      yarnVersion: d.packageManagerVersions.yarn,
    })
  }

  async function generate() {
    const d = detected()
    if (!d) return

    setGenerating(true)
    try {
      const cfg = createGitflowConfig(d, {
        routesFile: store.routesFile,
        branch: store.branch,
        domain: store.domain,
        protocol: store.protocol,
        nodeVersion: store.nodeVersion,
        pythonVersion: store.pythonVersion,
        subprojectPackageManager: store.subprojectPackageManager,
        pnpmVersion: store.pnpmVersion,
        npmVersion: store.npmVersion,
        yarnVersion: store.yarnVersion,
      })

      const files = generateGitflowFiles(cfg)
      await writeGitflowFiles({
        client: sdk().client,
        directory: sdk().directory,
        projectRoot: props.projectRoot,
        projectRelativeDir: props.projectRelativeDir,
        files: {
          [GITFLOW_OUTPUT_PATHS.workflow]: files.workflow,
          [GITFLOW_OUTPUT_PATHS.sitemapScript]: files.sitemapScript,
          [GITFLOW_OUTPUT_PATHS.htmlMdScript]: files.htmlMdScript,
        },
      })

      setPhase("success")
      showToast({
        variant: "success",
        title: language.t("session.preview.gitflow.success"),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("session.preview.gitflow.failed"),
        description: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setGenerating(false)
    }
  }

  function close() {
    dialog.close()
  }

  const detectionSummary = createMemo(() => {
    const d = detected()
    if (!d) return []

    const items = [
      { label: language.t("session.preview.gitflow.framework"), value: d.framework },
      { label: language.t("session.preview.gitflow.bundler"), value: d.bundler },
      { label: language.t("session.preview.gitflow.language"), value: d.language },
      {
        label: language.t("session.preview.gitflow.routeCandidates"),
        value: d.routeCandidates.join(", ") || language.t("session.preview.gitflow.notFound"),
      },
      { label: language.t("session.preview.gitflow.projectDir"), value: d.projectDirName },
      { label: language.t("session.preview.gitflow.defaultDomain"), value: d.defaultDomain },
    ]

    if (d.isWorkspace && d.isSubproject) {
      items.push(
        { label: language.t("session.preview.gitflow.monorepoType"), value: "pnpm workspace" },
        { label: language.t("session.preview.gitflow.workspaceRoot"), value: d.workspaceRoot || "." },
        { label: language.t("session.preview.gitflow.monorepo"), value: d.subprojectPath },
        {
          label: language.t("session.preview.gitflow.packageName"),
          value: d.packageName || language.t("session.preview.gitflow.notSet"),
        },
      )
    }

    items.push(
      {
        label: language.t("session.preview.gitflow.packageManager"),
        value: `${d.subprojectPackageManager} @ ${d.packageManagerVersions[d.subprojectPackageManager]}`,
      },
      { label: "Node.js", value: d.nodeVersion },
      { label: "Python", value: d.pythonVersion },
    )

    return items
  })

  return (
    <Dialog
      title={language.t("session.preview.gitflow.title")}
      class="w-full max-w-[600px] mx-auto [&_[data-slot=dialog-body]]:flex [&_[data-slot=dialog-body]]:min-h-0 [&_[data-slot=dialog-body]]:overflow-visible"
    >
      <div class="flex min-h-0 flex-1 flex-col">
        <div class="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 pt-0 pb-2">
          <Switch>
            <Match when={phase() === "loading"}>
              <div class="text-12-regular text-text-weak">{language.t("session.preview.gitflow.detecting")}</div>
            </Match>

            <Match when={phase() === "error"}>
              <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/20 px-3 py-2 text-12-regular text-text-weak whitespace-pre-wrap">
                {error()}
              </div>
            </Match>

            <Match when={phase() === "form" || phase() === "success"}>
              <Show when={detected()?.isWorkspace && !detected()?.isSubproject && detected()?.bundler !== "Vite"}>
                <div class="rounded-lg border border-border-warning-base bg-surface-warning-base/20 px-3 py-2 text-12-regular text-text-weak">
                  <div>{language.t("session.preview.gitflow.workspaceWarning")}</div>
                  <div>{language.t("session.preview.gitflow.workspaceWarningExample")}</div>
                </div>
              </Show>

              <Show when={phase() === "form"}>
                <div class="rounded-lg border border-border-weaker-base bg-surface-base px-3 py-2">
                  <div class="text-12-medium text-text-base mb-2">{language.t("session.preview.gitflow.detection")}</div>
                  <div class="grid grid-cols-2 gap-x-4 gap-y-1 text-12-regular text-text-weak">
                    <For each={detectionSummary()}>
                      {(item) => (
                        <>
                          <span>{item.label}</span>
                          <span class="text-text-base break-all">{item.value}</span>
                        </>
                      )}
                    </For>
                  </div>
                </div>

                <div class="text-12-medium text-text-base">{language.t("session.preview.gitflow.configure")}</div>

                <Show when={hasMultipleRoutes()}>
                  <div class="flex flex-col gap-2">
                    <label class="text-12-medium text-text-weak">
                      {language.t("session.preview.gitflow.routesFileSelect")}
                    </label>
                    <div class="flex flex-col gap-1">
                      <For each={routeCandidates()}>
                        {(candidate, index) => (
                          <Button
                            type="button"
                            size="small"
                            variant={store.routesFile === candidate ? "primary" : "ghost"}
                            class="justify-start font-mono"
                            onClick={() => setStore("routesFile", candidate)}
                          >
                            {index() + 1}. {candidate}
                          </Button>
                        )}
                      </For>
                    </div>
                  </div>
                </Show>

                <TextField
                  label={
                    hasMultipleRoutes()
                      ? language.t("session.preview.gitflow.routesFileCustom")
                      : language.t("session.preview.gitflow.routesFile")
                  }
                  value={store.routesFile}
                  onChange={(value) => setStore("routesFile", value)}
                />

                <Show when={store.routesFile.trim()}>
                  <div class="rounded-lg border border-border-weaker-base bg-surface-base px-3 py-3 flex flex-col gap-2">
                    <div class="text-12-medium text-text-base">
                      {language.t("session.preview.gitflow.parsedRoutes.title")}
                    </div>
                    <Show when={parsedRoutesLoading()}>
                      <div class="text-12-regular text-text-weak">
                        {language.t("session.preview.gitflow.parsedRoutes.loading")}
                      </div>
                    </Show>
                    <Show when={!parsedRoutesLoading() && parsedRoutesError()}>
                      <div class="text-12-regular text-text-warning">{parsedRoutesError()}</div>
                    </Show>
                    <Show when={!parsedRoutesLoading() && parsedRoutes().length > 0}>
                      <div class="text-11-regular text-text-weak">
                        {language.t("session.preview.gitflow.parsedRoutes.count", {
                          count: parsedRoutes().length,
                        })}
                      </div>
                      <div class="flex flex-wrap gap-1.5">
                        <For each={parsedRoutes()}>
                          {(path) => (
                            <code class="rounded-md bg-surface-raised-base px-2 py-0.5 text-11-regular font-mono text-text-base">
                              {path}
                            </code>
                          )}
                        </For>
                      </div>
                    </Show>
                  </div>
                </Show>

                <div class="grid grid-cols-2 gap-3">
                  <TextField
                    label={language.t("session.preview.gitflow.branch")}
                    value={store.branch}
                    onChange={(value) => setStore("branch", value)}
                  />
                  <TextField
                    label={language.t("session.preview.gitflow.domain")}
                    value={store.domain}
                    onChange={(value) => setStore("domain", value)}
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-12-medium text-text-weak">{language.t("session.preview.gitflow.protocol")}</label>
                  <div class="flex gap-2">
                    <Button
                      type="button"
                      size="small"
                      variant={store.protocol === "https" ? "primary" : "ghost"}
                      onClick={() => setStore("protocol", "https")}
                    >
                      HTTPS
                    </Button>
                    <Button
                      type="button"
                      size="small"
                      variant={store.protocol === "http" ? "primary" : "ghost"}
                      onClick={() => setStore("protocol", "http")}
                    >
                      HTTP
                    </Button>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <TextField
                    label="Node.js"
                    value={store.nodeVersion}
                    onChange={(value) => setStore("nodeVersion", value)}
                  />
                  <TextField
                    label="Python"
                    value={store.pythonVersion}
                    onChange={(value) => setStore("pythonVersion", value)}
                  />
                </div>

                <div class="flex flex-col gap-2">
                  <label class="text-12-medium text-text-weak">
                    {isMonorepo()
                      ? language.t("session.preview.gitflow.subprojectPackageManager")
                      : language.t("session.preview.gitflow.packageManager")}
                  </label>
                  <div class="flex gap-2">
                    <For each={allowedPackageManagers()}>
                      {(pm) => (
                        <Button
                          type="button"
                          size="small"
                          variant={store.subprojectPackageManager === pm ? "primary" : "ghost"}
                          onClick={() => selectPackageManager(pm)}
                        >
                          {pm}
                        </Button>
                      )}
                    </For>
                  </div>
                </div>

                <Show when={store.subprojectPackageManager === "pnpm"}>
                  <TextField
                    label="pnpm"
                    value={store.pnpmVersion}
                    onChange={(value) => setStore("pnpmVersion", value)}
                  />
                </Show>
                <Show when={store.subprojectPackageManager === "npm"}>
                  <TextField
                    label="npm"
                    value={store.npmVersion}
                    onChange={(value) => setStore("npmVersion", value)}
                  />
                </Show>
                <Show when={store.subprojectPackageManager === "yarn"}>
                  <TextField
                    label="yarn"
                    value={store.yarnVersion}
                    onChange={(value) => setStore("yarnVersion", value)}
                  />
                </Show>

                <Show when={commands()}>
                  {(cmds) => (
                    <div class="rounded-lg border border-border-weaker-base bg-surface-base px-3 py-3 flex flex-col gap-2">
                      <div class="text-12-medium text-text-base">
                        {language.t("session.preview.gitflow.commandsTitle")}
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-11-medium text-text-weak">
                          {language.t("session.preview.gitflow.installCmd")}
                        </span>
                        <code class="text-12-regular text-text-base break-all font-mono">{cmds().installCmd}</code>
                      </div>
                      <div class="flex flex-col gap-1">
                        <span class="text-11-medium text-text-weak">
                          {language.t("session.preview.gitflow.buildCmd")}
                        </span>
                        <code class="text-12-regular text-text-base break-all font-mono">{cmds().buildCmd}</code>
                      </div>
                      <Show when={cmds().installWorkingDirectory || cmds().buildWorkingDirectory}>
                        <div class="text-11-regular text-text-weak">
                          {language.t("session.preview.gitflow.workingDirectory", {
                            path: cmds().installWorkingDirectory || cmds().buildWorkingDirectory,
                          })}
                        </div>
                      </Show>
                    </div>
                  )}
                </Show>
              </Show>

              <Show when={phase() === "success"}>
                <div class="space-y-3 text-12-regular text-text-weak">
                  <div class="text-text-base">{language.t("session.preview.gitflow.successDetail")}</div>
                  <ul class="list-disc pl-5 space-y-1">
                    <li><code>{GITFLOW_OUTPUT_PATHS.workflow}</code></li>
                    <li><code>{GITFLOW_OUTPUT_PATHS.sitemapScript}</code></li>
                    <li><code>{GITFLOW_OUTPUT_PATHS.htmlMdScript}</code></li>
                  </ul>
                  <div class="text-12-medium text-text-base mt-4">{language.t("session.preview.gitflow.secretsTitle")}</div>
                  <div class="rounded-lg border border-border-weaker-base bg-surface-base px-3 py-2 font-mono text-11-regular">
                    <div>COS_SECRET_ID</div>
                    <div>COS_SECRET_KEY</div>
                    <div>COS_BUCKET</div>
                    <div>COS_REGION</div>
                    <div>COS_TARGET_PATH ({language.t("session.preview.gitflow.optional")})</div>
                    <Show when={promptPreview()?.domain}>
                      <div>
                        SITE_URL ({language.t("session.preview.gitflow.optional")}) — {promptPreview()?.protocol}://
                        {promptPreview()?.domain}
                      </div>
                    </Show>
                  </div>
                  <div>{language.t("session.preview.gitflow.pushHint", { branch: store.branch })}</div>
                </div>
              </Show>
            </Match>
          </Switch>
        </div>

        <div class="flex shrink-0 justify-end gap-2 border-t border-border-weaker-base px-6 pb-6 pt-4">
          <Button type="button" variant="ghost" size="large" onClick={close}>
            {phase() === "success" ? language.t("common.close") : language.t("common.cancel")}
          </Button>
          <Show when={phase() === "form"}>
            <Button
              type="button"
              variant="primary"
              size="large"
              disabled={generating() || !store.routesFile.trim()}
              onClick={() => void generate()}
            >
              {generating()
                ? language.t("session.preview.gitflow.generating")
                : language.t("session.preview.gitflow.generate")}
            </Button>
          </Show>
          <Show when={phase() === "error"}>
            <Button type="button" variant="primary" size="large" onClick={() => void loadDetection()}>
              {language.t("session.preview.gitflow.retry")}
            </Button>
          </Show>
        </div>
      </div>
    </Dialog>
  )
}
