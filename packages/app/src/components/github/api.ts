import { GITHUB_API } from "./constants"

export type GitHubRepo = {
  id: number
  name: string
  fullName: string
  cloneUrl: string
  htmlUrl: string
  description: string | null
  updatedAt: string
  private: boolean
}

type GitHubRepoResponse = {
  id: number
  name: string
  full_name: string
  clone_url: string
  html_url: string
  description: string | null
  updated_at: string
  private: boolean
}

type GitHubUserResponse = {
  login: string
}

function mapRepo(repo: GitHubRepoResponse): GitHubRepo {
  return {
    id: repo.id,
    name: repo.name,
    fullName: repo.full_name,
    cloneUrl: repo.clone_url,
    htmlUrl: repo.html_url,
    description: repo.description,
    updatedAt: repo.updated_at,
    private: repo.private,
  }
}

async function githubFetch<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(body || `GitHub API error (${response.status})`)
  }

  return response.json() as Promise<T>
}

export async function fetchGitHubUser(token: string) {
  return githubFetch<GitHubUserResponse>(token, "/user")
}

export async function fetchPublicRepos(token: string) {
  const repos: GitHubRepo[] = []
  let page = 1

  while (page <= 10) {
    const batch = await githubFetch<GitHubRepoResponse[]>(
      token,
      `/user/repos?visibility=public&affiliation=owner&sort=updated&per_page=100&page=${page}`,
    )
    if (batch.length === 0) break
    repos.push(...batch.map(mapRepo))
    if (batch.length < 100) break
    page += 1
  }

  return repos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
