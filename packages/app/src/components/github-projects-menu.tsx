import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { Icon } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { IconButtonV2 } from "@opencode-ai/ui/v2/icon-button-v2"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { TooltipV2 } from "@opencode-ai/ui/v2/tooltip-v2"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useGlobal } from "@/context/global"
import { useLanguage } from "@/context/language"
import { useServer } from "@/context/server"
import { useServerSDK } from "@/context/server-sdk"
import { useServerSync } from "@/context/server-sync"
import { useSettings } from "@/context/settings"
import { fetchPublicRepos, type GitHubRepo } from "@/components/github/api"
import { useGitHubAuth } from "@/components/github/auth"
import { resolveGitHubProjectPath } from "@/components/github/clone-repo"
import { resolveGitHubWorkingDirectory } from "@/components/github/target-directory"
import { showToast } from "@/utils/toast"

export function GitHubProjectsMenu() {
  const language = useLanguage()
  const server = useServer()
  const serverSDK = useServerSDK()
  const serverSync = useServerSync()
  const params = useParams()
  const global = useGlobal()
  const navigate = useNavigate()
  const dialog = useDialog()
  const settings = useSettings()
  const github = useGitHubAuth()
  const isV2 = createMemo(() => settings.general.newLayoutDesigns())

  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const [opening, setOpening] = createSignal<string | undefined>()

  const visible = createMemo(() => server.isLocal() && !!server.current)

  const [repos, { refetch }] = createResource(
    () => (open() && github.connected() ? github.store().token : undefined),
    async (token) => fetchPublicRepos(token!),
  )

  const filtered = createMemo(() => {
    const items = repos() ?? []
    const value = query().trim().toLowerCase()
    if (!value) return items
    return items.filter(
      (repo) =>
        repo.name.toLowerCase().includes(value) ||
        repo.fullName.toLowerCase().includes(value) ||
        (repo.description?.toLowerCase().includes(value) ?? false),
    )
  })

  const openConnectDialog = () => {
    void import("@/components/dialog-github-connect").then((module) => {
      dialog.show(() => <module.DialogGitHubConnect onConnected={() => void refetch()} />)
    })
  }

  const ensureConnected = () => {
    if (github.connected()) return true
    openConnectDialog()
    return false
  }

  const openRepo = async (repo: GitHubRepo) => {
    if (opening()) return
    setOpening(repo.fullName)
    setOpen(false)

    try {
      const conn = server.current
      if (!conn) return

      const working = await resolveGitHubWorkingDirectory({
        slug: params.dir,
        fallbackDirectory: server.projects.last() ?? undefined,
        serverSync,
        serverSDK: serverSDK(),
      })
      if (!working) throw new Error(language.t("github.open.missingDirectory"))

      const serverCtx = global.ensureServerCtx(conn)
      const sdk = serverCtx.sdk.ensureDirSdkContext(working.contextDirectory)

      const projectPath = await resolveGitHubProjectPath({
        client: sdk.client,
        serveDirectory: working.contextDirectory,
        targetDirectory: working.targetDirectory,
        repoName: repo.name,
        cloneUrl: repo.cloneUrl,
      })

      serverCtx.projects.open(projectPath)
      serverCtx.projects.touch(projectPath)
      navigate(`/${base64Encode(projectPath)}/session`)
    } catch (error) {
      showToast({
        variant: "error",
        title: language.t("github.open.failed"),
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setOpening(undefined)
    }
  }

  const handleOpenChange = (next: boolean) => {
    if (next && !ensureConnected()) return
    setOpen(next)
    if (next) {
      setQuery("")
      void refetch()
    }
  }

  return (
    <Show when={visible()}>
      <DropdownMenu gutter={4} placement="bottom-end" open={open()} onOpenChange={handleOpenChange}>
        <Show
          when={!isV2()}
          fallback={
            <TooltipV2 placement="bottom" value={language.t("github.menu.tooltip")}>
              <DropdownMenu.Trigger
                as={IconButtonV2}
                variant="ghost-muted"
                size="large"
                class="!w-9 shrink-0"
                icon={<Icon name="github" size="small" />}
                aria-label={language.t("github.menu.tooltip")}
              />
            </TooltipV2>
          }
        >
          <Tooltip placement="bottom" value={language.t("github.menu.tooltip")}>
            <DropdownMenu.Trigger
              as={IconButton}
              icon="github"
              variant="ghost"
              class="titlebar-icon w-8 h-6 p-0 box-border shrink-0"
              aria-label={language.t("github.menu.tooltip")}
            />
          </Tooltip>
        </Show>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="w-[320px] max-h-[420px] overflow-hidden p-0">
            <div class="border-b border-border-weak-base p-2">
              <div class="flex items-center justify-between gap-2 px-1 pb-2">
                <div class="min-w-0">
                  <div class="text-12-medium text-text-strong">{language.t("github.menu.title")}</div>
                  <Show when={github.store().username}>
                    <div class="truncate text-11-regular text-text-weak">@{github.store().username}</div>
                  </Show>
                </div>
                <Show when={github.connected()}>
                  <button
                    type="button"
                    class="shrink-0 text-11-regular text-text-weak hover:text-text-base"
                    onClick={() => {
                      github.disconnect()
                      setOpen(false)
                    }}
                  >
                    {language.t("github.menu.disconnect")}
                  </button>
                </Show>
              </div>
              <TextField
                placeholder={language.t("github.menu.search")}
                value={query()}
                onChange={setQuery}
              />
            </div>
            <div class="max-h-[320px] overflow-y-auto p-1">
              <Show
                when={!repos.loading}
                fallback={
                  <div class="flex items-center justify-center gap-2 px-3 py-6 text-14-regular text-text-weak">
                    <Spinner />
                    <span>{language.t("github.menu.loading")}</span>
                  </div>
                }
              >
                <Show
                  when={!repos.error}
                  fallback={
                    <div class="px-3 py-4 text-14-regular text-text-critical-base">
                      {repos.error instanceof Error ? repos.error.message : String(repos.error)}
                    </div>
                  }
                >
                  <Show
                    when={filtered().length > 0}
                    fallback={<div class="px-3 py-4 text-14-regular text-text-weak">{language.t("github.menu.empty")}</div>}
                  >
                    <For each={filtered()}>
                      {(repo) => (
                        <DropdownMenu.Item
                          disabled={!!opening()}
                          onSelect={() => void openRepo(repo)}
                          class="flex flex-col items-start gap-0.5 py-2"
                        >
                          <div class="flex w-full items-center gap-2">
                            <Icon name="github" size="small" class="text-icon-weak shrink-0" />
                            <DropdownMenu.ItemLabel class="truncate">{repo.fullName}</DropdownMenu.ItemLabel>
                            <Show when={opening() === repo.fullName}>
                              <Spinner class="ml-auto size-3.5 shrink-0" />
                            </Show>
                          </div>
                          <Show when={repo.description}>
                            <div class="pl-6 text-11-regular text-text-weak line-clamp-2">{repo.description}</div>
                          </Show>
                        </DropdownMenu.Item>
                      )}
                    </For>
                  </Show>
                </Show>
              </Show>
            </div>
            <Show when={!github.connected()}>
              <div class="border-t border-border-weak-base p-2">
                <DropdownMenu.Item onSelect={openConnectDialog}>{language.t("github.connect.action")}</DropdownMenu.Item>
              </div>
            </Show>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
    </Show>
  )
}
