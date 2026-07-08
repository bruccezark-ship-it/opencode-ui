# Web UI 主应用

OpenWeb UI 的前端应用，基于 Vite + SolidJS 构建，通过 `@opencode-ai/sdk` 连接 `opencode serve` 后端。

## 前置要求

- [Bun](https://bun.sh) >= 1.3.14
- 已运行的 `opencode serve`（默认 `localhost:4096`）

## 快速开始

### 1. 配置环境变量

复制 `.env.example` 为 `.env` 并按需修改：

```bash
cp .env.example .env
```

### 2. 启动开发服务器

在 monorepo 根目录：

```bash
bun run dev
```

或在本目录：

```bash
bun run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

修改代码后页面会自动热更新。

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_OPENCODE_SERVER_HOST` | `localhost` | opencode serve 主机 |
| `VITE_OPENCODE_SERVER_PORT` | `4096` | opencode serve 端口 |
| `VITE_DEPLOY_CLI_SCRIPT` | — | COS 发布 CLI 绝对路径（启用 COS 发布时必填） |
| `VITE_PLAYWRIGHT_BROWSERS_PATH` | 自动推导 | Chromium 目录，供 COS 发布 SEO 抓取使用 |

完整说明见仓库根目录 [README.md](../../README.md) 与 [deploy-server 文档](../deploy-server/README.md)。

## 可用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite 开发服务器（端口 3000） |
| `bun run build` | 构建生产版本到 `dist/` |
| `bun run serve` | 预览生产构建 |
| `bun run test:e2e:local` | 运行 Playwright 端到端测试 |

## 端到端测试

Playwright 会通过 `webServer` 自动启动 Vite 开发服务器，默认期望 opencode 后端运行在 `localhost:4096`。

```bash
bunx playwright install chromium
bun run test:e2e:local
bun run test:e2e:local -- --grep "settings"
```

可选环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PLAYWRIGHT_SERVER_HOST` | `localhost` | 测试时 opencode 后端主机 |
| `PLAYWRIGHT_SERVER_PORT` | `4096` | 测试时 opencode 后端端口 |
| `PLAYWRIGHT_PORT` | `3000` | Vite 开发服务器端口 |
| `PLAYWRIGHT_BASE_URL` | `http://localhost:<PORT>` | 覆盖测试基础 URL |

## 生产部署

```bash
bun run build
```

将 `dist/` 目录部署到任意静态文件托管服务。需确保用户浏览器能访问到 `opencode serve` API，或将 UI 与 API 部署在同一域名下。
