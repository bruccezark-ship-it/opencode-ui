# OpenWeb UI

从 [OpenCode](https://github.com/anomalyco/opencode) 独立提取的 Web UI，用于连接 `opencode serve` 后端。

## 项目结构

```
opencode-ui/
├── packages/
│   ├── app/            # Web UI 主应用（Vite + SolidJS）
│   ├── deploy-core/    # COS 发布核心逻辑（构建、CDN、DNS、SEO）
│   ├── deploy-server/  # COS 发布 CLI（按需执行，无常驻服务）
│   ├── ui/             # 基础 UI 组件库
│   ├── session-ui/     # 会话/消息 UI 组件
│   ├── sdk/js/         # OpenCode HTTP/SSE 客户端 SDK
│   ├── core/           # 精简工具模块（encode、path 等）
│   └── schema/         # 共享 Schema 定义
├── patches/            # 依赖补丁
└── package.json        # Monorepo 根配置
```

## 前置要求

- [Bun](https://bun.sh) >= 1.3.14
- [Node.js](https://nodejs.org) >= 20（COS 发布 CLI 在 Windows 上需用 Node 运行）
- 已安装并运行的 [OpenCode](https://opencode.ai) CLI（`opencode serve`）

## 快速开始

### 1. 安装依赖

```bash
bun install
```

`bun install` 会自动编译发布相关包（`deploy-core` + `deploy-server`）并安装 Chromium（首次约 150MB）。无网络环境可跳过浏览器安装：

```bash
SKIP_BROWSER_SETUP=1 bun install
```

### 2. 初始化 COS 发布配置（首次使用）

```bash
node packages/deploy-server/dist/cli.js config
```

配置保存在 `~/.opencode-deploy/config.json`。

### 3. 配置 Web UI 环境变量

在 `packages/app/` 下复制 `.env.example` 为 `.env`：

```bash
cp packages/app/.env.example packages/app/.env
```

### 4. 启动 opencode 后端

```bash
opencode serve --port 4096 --cors http://localhost:3000
```

### 5. 启动 Web UI

```bash
bun run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 环境变量

配置文件路径：`packages/app/.env`（**不是**仓库根目录）。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_OPENCODE_SERVER_HOST` | `localhost` | opencode serve 主机 |
| `VITE_OPENCODE_SERVER_PORT` | `4096` | opencode serve 端口 |
| `VITE_DEPLOY_CLI_SCRIPT` | — | COS 发布 CLI 脚本的**绝对路径**（opencode serve 所在机器可访问） |
| `VITE_PLAYWRIGHT_BROWSERS_PATH` | 自动推导 | Chromium 安装目录 |

示例：

```bash
VITE_OPENCODE_SERVER_HOST=localhost
VITE_OPENCODE_SERVER_PORT=4096
VITE_DEPLOY_CLI_SCRIPT=D:/opencodewebui_v0/opencode-ui/packages/deploy-server/src/cli.ts
```

## COS 发布

预览窗口中点击 **发布 → COS发布**，Web UI 通过 opencode PTY 按需启动发布 CLI，执行完毕后进程自动退出。

详细说明见 [packages/deploy-server/README.md](packages/deploy-server/README.md)。

## 可用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite 开发服务器（端口 3000） |
| `bun run build` | 构建生产版本到 `packages/app/dist/` |
| `bun run serve` | 预览生产构建 |
| `bun run build:deploy` | 编译 `deploy-core` 与 `deploy-server` |
| `bun run setup-browser` | 安装或更新 COS 发布用的 Chromium |

## 生产部署

```bash
bun run build
```

将 `packages/app/dist/` 部署到任意静态文件服务器。需确保同时可访问 `opencode serve` API。

## 连接方式

Web UI 通过 `@opencode-ai/sdk` 与 opencode serve 通信：

- **REST API**：会话、项目、配置等
- **SSE**：`/global/event` 实时事件流
- **WebSocket**：`/pty/*/connect` 终端连接

## 许可证

MIT（与原 OpenCode 项目一致）
