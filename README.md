# OpenWeb UI

从 [OpenCode](https://github.com/anomalyco/opencode) 独立提取的 Web UI，用于连接 `opencode serve` 后端。

## 项目结构

```
openweb_ui/
├── packages/
│   ├── app/          # Web UI 主应用（Vite + SolidJS）
│   ├── ui/           # 基础 UI 组件库
│   ├── session-ui/   # 会话/消息 UI 组件
│   ├── sdk/js/       # OpenCode HTTP/SSE 客户端 SDK
│   ├── core/         # 精简工具模块（encode、path 等）
│   └── schema/       # 共享 Schema 定义
├── patches/          # 依赖补丁
└── package.json      # Monorepo 根配置
```

## 前置要求

- [Bun](https://bun.sh) >= 1.3.14
- 已安装并运行的 [OpenCode](https://opencode.ai) CLI（`opencode serve`）

## 快速开始

### 1. 安装依赖

```bash
bun install
```

### 2. 启动 opencode 后端

在另一个终端中启动 opencode serve：

```bash
opencode serve --port 4096
```

若前端与后端不同端口，需允许 CORS：

```bash
opencode serve --port 4096 --cors http://localhost:3000
```

### 3. 启动 Web UI 开发服务器

```bash
bun run dev
```

浏览器打开 [http://localhost:3000](http://localhost:3000)。

## 环境变量

复制 `.env.example` 为 `.env` 并按需修改：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `VITE_OPENCODE_SERVER_HOST` | `localhost` | opencode serve 主机 |
| `VITE_OPENCODE_SERVER_PORT` | `4096` | opencode serve 端口 |

开发模式下，UI 会连接 `http://<HOST>:<PORT>`。生产构建后，UI 默认连接同域（`location.origin`）。

## 可用命令

| 命令 | 说明 |
|------|------|
| `bun run dev` | 启动 Vite 开发服务器（端口 3000） |
| `bun run build` | 构建生产版本到 `packages/app/dist/` |
| `bun run serve` | 预览生产构建 |

## 生产部署

```bash
bun run build
```

将 `packages/app/dist/` 部署到任意静态文件服务器。需确保：

1. 同时运行 `opencode serve`，或
2. 将静态 UI 与 API 放在同一域名下（与 `opencode web` 一体化部署方式相同）

## 连接方式

Web UI 通过 `@opencode-ai/sdk` 与 opencode serve 通信：

- **REST API**：会话、项目、配置等
- **SSE**：`/global/event` 实时事件流
- **WebSocket**：`/pty/*/connect` 终端连接

认证可通过环境变量 `OPENCODE_SERVER_PASSWORD` 配置，或在 URL 中使用 `?auth_token=<base64>` 参数。

## 许可证

MIT（与原 OpenCode 项目一致）
