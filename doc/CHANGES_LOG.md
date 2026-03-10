# 变更日志

## 2026-03-05: Nanobot → OpenClaw Bridge 替换

### 概述

将原有的 Nanobot（Python）Agent 替换为 OpenClaw（TypeScript），通过新增 Bridge 适配层实现 API 兼容，保持前端和 Platform 网关无感切换。

### 架构变化

```
替换前：
  Frontend → Platform Gateway → Nanobot (Python, port 18080)

替换后：
  Frontend → Platform Gateway → Bridge Server (Express, port 18080)
                                      ↓ (内部 WebSocket)
                                OpenClaw Gateway (port 18789)
                                      ↓
                                LLM Provider
```

### 新增文件（openclaw/bridge/）

| 文件 | 说明 |
|------|------|
| `bridge/config.ts` | 环境变量解析，生成 openclaw 配置文件（~/.openclaw/openclaw.json） |
| `bridge/gateway-client.ts` | WebSocket 客户端，封装与 OpenClaw Gateway 的连接和 RPC 调用 |
| `bridge/server.ts` | Express HTTP 服务器主入口，挂载所有路由 |
| `bridge/start.ts` | 启动入口：启动 openclaw gateway 子进程 → 等待就绪 → 启动 bridge 服务器 |
| `bridge/websocket.ts` | WebSocket 处理器（/ws/{session_id}），转换 openclaw 聊天事件为 nanobot 格式 |
| `bridge/utils.ts` | 通用工具函数（asyncHandler、session key 转换、文本提取等） |
| `bridge/types.d.ts` | unzipper 模块类型声明 |
| `bridge/routes/chat.ts` | POST /api/chat 和 /api/chat/stream（SSE 流式响应） |
| `bridge/routes/sessions.ts` | GET/DELETE /api/sessions 会话管理 |
| `bridge/routes/status.ts` | GET /api/status 和 /api/ping |
| `bridge/routes/files.ts` | 文件上传/下载/列表/删除（直接文件系统实现） |
| `bridge/routes/workspace.ts` | 工作区浏览/上传/下载/删除/创建目录 |
| `bridge/routes/skills.ts` | 技能列表/上传/下载/删除（支持 zip 打包） |
| `bridge/routes/commands.ts` | 命令列表（内置 + 插件 + 技能） |
| `bridge/routes/plugins.ts` | 插件列表/删除 |
| `bridge/routes/cron.ts` | 定时任务 CRUD（通过 gateway RPC） |
| `bridge/routes/marketplaces.ts` | 市场管理 CRUD（git clone + 文件系统） |
| `bridge/package.json` | Bridge 依赖（express, ws, multer, mime-types, archiver, unzipper） |
| `tsconfig.bridge.json` | Bridge TypeScript 编译配置 |
| `Dockerfile.bridge` | Docker 镜像构建文件 |
| `bridge-entrypoint.sh` | Docker 入口脚本 |

### 修改的文件

| 文件 | 修改内容 |
|------|----------|
| `platform/app/config.py` | `nanobot_image` 默认值改为 `"openclaw-bridge:latest"` |
| `platform/app/container/manager.py` | 容器启动命令改为 `node bridge/dist/start.js`，volume 挂载路径改为 `/root/.openclaw/` |
| `start_local.py` | "nanobot" 服务改为 "bridge"，启动方式改为 `tsx bridge/start.ts`，超时增加到 120s |
| `deploy_docker.py` | 镜像构建改为 `openclaw-bridge:latest`，使用 `openclaw/Dockerfile.bridge` |
| `prepare.py` | 去掉 nanobot Python 依赖检查，改为检查 openclaw（pnpm install）和 bridge（npm install）依赖 |
| `check_status.py` | 用户容器健康检查从 python3 改为 node（fetch API） |

### 关键技术细节

#### OpenClaw 配置格式（~/.openclaw/openclaw.json）

```json
{
  "models": {
    "mode": "replace",
    "providers": {
      "platform-proxy": {
        "baseUrl": "http://localhost:8080/llm/v1",
        "api": "openai-completions",
        "apiKey": "<token>",
        "models": [{ "id": "<model>", "name": "<model>" }]
      }
    }
  },
  "agents": { "defaults": { "model": "platform-proxy/<model>" } },
  "gateway": { "mode": "local", "port": 18789, "bind": "loopback", "auth": { "mode": "none" } }
}
```

注意事项：
- Provider 字段用 `api: "openai-completions"`（不是 `type: "openai"`）
- Model 必须同时有 `id` 和 `name`
- Agent model 引用格式为 `"provider-name/model-id"`
- Gateway 必须设置 `mode: "local"`

#### 设备身份认证（Device Identity）

即使 gateway 配置 `auth.mode = "none"`，连接时仍需提供设备身份（Ed25519 密钥对 + 签名）。

流程：
1. 客户端生成临时 Ed25519 密钥对
2. 收到 `connect.challenge` 事件，提取 nonce
3. 构建 v3 payload 字符串（`v3|deviceId|clientId|mode|role|scopes|timestamp|token|nonce|platform|deviceFamily`）
4. 用私钥签名 payload
5. 在 connect 请求中携带 `device` 对象（id, publicKey, signature, signedAt, nonce）

`client.id` 必须是预定义值之一（如 `"gateway-client"`），不能自定义。

### 调试过程中遇到的问题

1. **配置格式错误**：`type` → `api`，缺少 `name`，`provider` 字段无效
2. **Gateway 模式未设置**：必须显式设置 `mode: "local"`
3. **Connect 参数 schema 不匹配**：需要嵌套 `client` 对象，包含 `minProtocol/maxProtocol`
4. **设备身份必需**：auth=none 模式下 `sharedAuthOk` 为 false，无法跳过设备身份验证
5. **Client ID 校验**：必须使用 `GATEWAY_CLIENT_IDS` 中定义的值


  前端（8 个文件）：
  - lib/api.ts — 所有 /api/nanobot/ → /api/openclaw/，localStorage keys 改名
  - lib/store.ts — nanobotReady → openclawReady
  - app/page.tsx — UI 文本和变量名
  - app/layout.tsx — 页面标题 → "OpenClaw"
  - app/help/page.tsx — 帮助文档文本
  - app/status/page.tsx — 错误信息和命令
  - app/plugins/page.tsx — 路径和文本
  - app/login/page.tsx + app/register/page.tsx — 登录/注册标题
  - components/Header.tsx — 头部显示和状态变量
  - types/index.ts — 注释

  平台 Gateway（5 个文件）：
  - routes/proxy.py — 路由前缀 /api/openclaw，配置引用
  - config.py — dev_openclaw_url、openclaw_image、网络名等
  - main.py — 服务名
  - llm_proxy/service.py — 配置引用
  - container/manager.py — 容器/卷名

  基础设施（2 个文件）：
  - Dockerfile — .openclaw 目录、入口点
  - start_local.py — Docker 容器名、环境变量、UI 文本

openclaw/Dockerfile.bridge 已经包含了完整的 openclaw 主程序（COPY . . + pnpm build），不是只有
  bridge


  Chat 页面

  - 输入框左侧新增 📎 附件按钮，支持选择多个文件
  - 支持粘贴图片（Ctrl+V / Cmd+V）
  - 文件预览区：图片显示缩略图，文件显示名称和大小，可单独删除
  - 发送逻辑：
    - 图片（image/*）→ base64 编码作为 attachment 直接发给网关
    - 其他文件（PDF/文档等）→ 先上传到 workspace/uploads/ 目录，然后在消息中插入 [附件: workspace/uploads/xxx.pdf] 引用路径，Agent
  可通过文件系统工具读取处理
