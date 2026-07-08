# COS 发布服务（deploy-server）

OpenWeb UI 内置的 COS 发布 CLI。每次发布时由 Web UI 通过 opencode PTY 启动，执行完毕后进程自动退出，**无需常驻后台服务**。

发布核心逻辑位于同仓库的 [`packages/deploy-core`](../deploy-core/)。

## 工作原理

```
用户点击「COS发布」
    ↓
Web UI 通过 opencode SDK 创建 PTY 进程
    ↓
node dist/cli.js deploy --project-root ... --mode subdomain --target my-app
    ↓
CLI 输出 @@DEPLOY@@{json} 进度事件 → Web UI 解析并展示
    ↓
（如需 CDN 验证）Web UI 发送 @@DEPLOY_INPUT@@{action}
    ↓
发布完成，PTY 进程退出
```

## 功能

- 检测 Vite 项目并执行 `vite build`
- 自动生成 SEO 产物（sitemap.xml、robots.txt、页面 md）
- 上传构建产物至腾讯云 COS
- 自动配置 CDN 加速域名与 DNSPod CNAME
- 支持 CDN 域名归属 TXT 验证（交互式）
- 通过 stdout 输出 JSON 事件，供 Web UI 实时展示进度

## 前置要求

| 依赖 | 说明 |
|------|------|
| [Bun](https://bun.sh) >= 1.3.14 | 安装依赖、编译发布包 |
| [Node.js](https://nodejs.org) >= 20 | **运行**发布 CLI（Windows 上 Playwright 需用 Node） |
| `~/.opencode-deploy/config.json` | 腾讯云账号、COS 存储桶等全局配置 |
| Vite 项目 | 目标项目必须是可构建的 Vite 项目 |

### 初始化配置

```bash
# 交互式配置
node packages/deploy-server/dist/cli.js config

# 或输出配置模板
node packages/deploy-server/dist/cli.js config --init
```

配置文件路径：

| 系统 | 路径 |
|------|------|
| Linux / macOS | `~/.opencode-deploy/config.json` |
| Windows | `C:\Users\<用户名>\.opencode-deploy\config.json` |

项目级可选配置：`<project-root>/.opencode-deployrc`

## 安装

在仓库根目录：

```bash
bun install
```

`postinstall` 会自动：

1. 编译 `deploy-core` 与 `deploy-server`（输出 `dist/cli.js`）
2. 安装 Chromium 到 `packages/deploy-server/browsers/`

手动重新编译：

```bash
bun run build:deploy
```

### Chromium（SEO 抓取）

```
packages/deploy-server/browsers/
```

```bash
bun run setup-browser
```

跳过安装：`SKIP_BROWSER_SETUP=1 bun install`

| 环境变量 | 说明 |
|----------|------|
| `PLAYWRIGHT_BROWSERS_PATH` | Chromium 目录 |
| `OPENCODE_DEPLOY_SKIP_BROWSER_INSTALL` | 设为 `1` 禁用运行时下载 |

## Web UI 配置

在 `packages/app/.env` 中设置：

```bash
VITE_DEPLOY_CLI_SCRIPT=D:/opencodewebui_v0/opencode-ui/packages/deploy-server/src/cli.ts
```

Web UI 会自动用 `node dist/cli.js` 执行（可继续填写 `src/cli.ts` 路径）。

PTY 执行示例：

```bash
node packages/deploy-server/dist/cli.js deploy --project-root <worktree> --mode domain --target example.com
```

### 联调步骤

```bash
# 终端 1
opencode serve --port 4096 --cors http://localhost:3000

# 终端 2
bun run dev
```

## 命令行用法

```bash
cd packages/deploy-server

# 初始化全局配置
node dist/cli.js config

# 检查配置与项目
node dist/cli.js status --project-root D:\projects\my-app

# 预览发布计划
node dist/cli.js preview --project-root D:\projects\my-app --mode subdomain --target my-app

# 执行发布
node dist/cli.js deploy --project-root D:\projects\my-app --mode subdomain --target my-app
```

### 子命令

| 子命令 | 说明 |
|--------|------|
| `config` | 交互式初始化 `~/.opencode-deploy/config.json` |
| `status` | 检查配置与 Vite 项目 |
| `preview` | 预览发布计划 |
| `deploy` | 执行完整发布流程 |

### 通用参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `--project-root` | 是 | Vite 项目根目录绝对路径 |
| `--mode` | preview/deploy 必填 | `subdomain` 或 `domain` |
| `--target` | preview/deploy 必填 | 子域名标识或完整域名 |
| `--protocol` | 否 | `http` / `https` |
| `--cdn-https` | 否 | 开启 CDN HTTPS |
| `--cert-id` | 否 | CDN HTTPS 证书 ID |
| `--no-clean` | 否 | 不清理 COS 远程多余文件 |

## 输出协议

```
@@DEPLOY@@{"type":"step-start","step":1,"total":4,"name":"构建项目"}
@@DEPLOY@@{"type":"status","message":"收到验证请求，正在检查 DNS TXT 记录..."}
@@DEPLOY@@{"type":"cdn-verification","sessionId":"...","record":{...}}
@@DEPLOY@@{"type":"complete","result":{...}}
```

stdin 验证输入：

```
@@DEPLOY_INPUT@@{"action":"verify"}
@@DEPLOY_INPUT@@{"action":"refresh"}
@@DEPLOY_INPUT@@{"action":"cancel"}
```

Web UI 通过 PTY WebSocket 发送 stdin，并备用写入项目目录 `.opencode-deploy-input`。

## 目录结构

```
packages/
├── deploy-core/          # COS/CDN/DNS/SEO 核心逻辑
│   └── src/
└── deploy-server/
    ├── browsers/         # Chromium（git 忽略）
    ├── dist/             # 编译后的 CLI（git 忽略）
    ├── scripts/
    └── src/
        ├── cli.ts
        ├── config-command.ts
        ├── deploy-service.ts
        ├── protocol.ts
        └── stdin-bridge.ts
```

## 项目级配置（可选）

```json
{
  "subdomain": "my-app",
  "buildCommand": "vite build",
  "outputDir": "dist",
  "cleanRemote": true
}
```

保存为 `.opencode-deployrc`。

## 常见问题

### 未配置 VITE_DEPLOY_CLI_SCRIPT

在 `packages/app/.env` 中设置 CLI 路径，重启 `bun run dev`。

### 未找到发布配置

```bash
node packages/deploy-server/dist/cli.js config
```

### 浏览器抓取卡住

确认使用 Node 运行 `dist/cli.js`，并执行 `bun run setup-browser`。

### CDN 验证无响应

确认 opencode serve 机器已安装 Node.js；添加 TXT 记录后点击「开始验证」，界面应显示 DNS 检查进度。

### 编译失败

```bash
bun run build:deploy
```
