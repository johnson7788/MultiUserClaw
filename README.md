# MultiUserClaw - 多用户 AI Claw平台。

基于Openclaw（其它分支有nanobot)改造的轻量级 AI 助手框架，支持多租户隔离部署、多平台渠道接入、工具调用、定时任务和 Web 实时通信。

在线体验地址，可以直接注册一个账号即可使用，或者使用账号admin，密码:welcome，进行测试
https://agent.minitool.fun:13080/

🔔：simple_web分支是简单的单用户的Web界面。如果单用户的页面测试使用，可以使用simple_web分支。

🔔：nanobot014分支是nanobot的0.1.4版本
🔔：nanobot014v3分支是nanobot的0.1.4 post v3版本
🔔：openclaw_oldfrontend分支是基于openclaw版本的旧版本前端, 🦞 OpenClaw 2026.3.3 (eae1484)
🔔：当前的main分支是openclaw新版本前端

---

  - 新增platform作为控制容器的网关，每个用户单独创建容器进行管理
  - frontend前端页面进行显示

UPDATE:
- 首次支持plugins，多个Agent联合使用，更聪明，使用的是 ~/.nanobot/plugins/ or <workspace>/plugins/中的Plugins
- 支持文件管理，用户的文件上传和AI文件使用处理后下载
- 前端的输入优化，支持VLLM模型

## 目录

1. [运行流程概览](#1-运行流程概览)
2. [多租户部署（Docker Compose）](#2-多租户部署docker-compose)
3. [单用户本地运行](#3-单用户本地运行)
4. [整体架构](#4-整体架构)
5. [核心组件详解](#5-核心组件详解)
6. [安全设计](#6-安全设计)
7. [前端](#7-前端)
8. [文件索引](#8-文件索引)

---

## 界面示例截图
多个用户的聊天页面和它们独自隔离的容器环境
![openclaw1.png](doc/openclaw1.png)
![openclaw2.png](doc/openclaw2.png)
![multi_users_docker.png](doc/multi_users_docker.png)

交互式创建skills
![skill_create1.png](doc/skill_create1.png)
![skill_create2.png](doc/skill_create2.png)

管理自己的skills
![skill_page.png](doc/skill_page.png)

每个用户的容器隔离独立联网
![使用curl命令.png](doc/%E4%BD%BF%E7%94%A8curl%E5%91%BD%E4%BB%A4.png)

生成PPT的skill测试
![ppt1.png](doc/ppt1.png)
![ppt2.png](doc/ppt2.png)

支持插件的安装和使用
![plugins.png](doc/plugins.png)

```
用户在浏览器输入消息
    |
    v
[Frontend] Next.js (端口 3080)
    | WebSocket 连接
    v
[Platform Gateway] FastAPI (端口 8080)
    | 1. JWT 认证
    | 2. 查找/启动用户容器
    | 3. WebSocket 代理
    v
[用户容器] — 每个用户一个独立 Docker 容器
    |
    |  容器内部结构:
    |  ┌─────────────────────────────────────────┐
    |  │  Bridge (Node.js, 端口 18080)            │
    |  │    - HTTP API 服务器                      │
    |  │    - WebSocket 中继                       │
    |  │              |                            │
    |  │              v                            │
    |  │  OpenClaw Gateway (端口 18789, loopback)  │
    |  │    - Agent 处理引擎                       │
    |  │    - 工具调用 (bash/文件/搜索等)           │
    |  │    - Skills 系统                          │
    |  │    - Session 管理                         │
    |  └─────────────────────────────────────────┘
    |
    | Agent 需要调用 LLM 时:
    v
[Platform Gateway] /llm/v1/chat/completions
    | 1. 验证容器 Token
    | 2. 检查用户配额
    | 3. 根据模型名匹配 Provider
    | 4. 注入真实 API Key
    v
[LLM 提供商] (Anthropic / OpenAI / DashScope / DeepSeek / ...)
    |
    | 响应沿原路返回
    v
用户在浏览器看到回复
```

### 1.2 关键设计决策

| 决策 | 说明 |
|------|------|
| **OpenClaw 作为 Agent 核心** | 替代原有 nanobot Python Agent，使用 OpenClaw（TypeScript/Node.js）作为每个用户的 AI 运行时，功能更强大 |
| **Bridge 适配层** | 在 OpenClaw 外包装一层 Bridge，提供 HTTP API + WS 中继，适配平台的多租户管理 |
| **API Key 不进容器** | 所有 LLM API Key 只存在于 Gateway 环境变量中，容器通过 Token 代理访问 |
| **容器级隔离** | 每个用户独立容器、独立 Volume，互不干扰 |
| **按需创建** | 用户首次聊天时才创建容器，空闲 30 分钟暂停，30 天归档 |

---

## 2. 多租户部署（Docker Compose）

### 2.1 架构

```
浏览器 --> frontend:3000 --(JS请求)--> gateway(platform):8080 --> 用户容器(openclaw)
                                            |                   |
                                       postgres:5432      gateway/llm/v1
                                       (用户/配额)         (注入API Key)
                                                               |
                                                         实际 LLM 提供商
```

- **Frontend**：Next.js Web 界面，用户注册、登录、聊天
- **Gateway**：平台网关（Python FastAPI），负责认证、用户容器管理、LLM 代理、配额控制
- **用户容器**：每个用户一个独立的 OpenClaw 实例（通过 Bridge 启动），自动创建，数据隔离
- **PostgreSQL**：存储用户账户、容器元数据、用量记录

### 2.2 前置条件

- Docker & Docker Compose
- 至少一个 LLM 提供商的 API Key

### 2.3 配置 `.env` 文件

在项目根目录创建 `.env` 文件，填入你的 API Key 和配置：

```bash
# .env — docker compose 自动读取此文件

# ========== 必填：至少配置一个 LLM 提供商 ==========

# 阿里 DashScope（通义千问系列）
DASHSCOPE_API_KEY=sk-xxxxxxxxxxxx

# Anthropic（Claude 系列）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# OpenAI（GPT 系列）
OPENAI_API_KEY=sk-xxxxxxxxxxxx

# DeepSeek
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxx

# OpenRouter（支持路由到任意模型，作为兜底）
OPENROUTER_API_KEY=sk-or-xxxxxxxxxxxx

# AiHubMix
AIHUBMIX_API_KEY=sk-xxxxxxxxxxxx

# ========== 可选配置 ==========

# 默认模型（新用户容器使用此模型）
DEFAULT_MODEL=dashscope/qwen3-coder-plus

# JWT 密钥（生产环境务必修改）
JWT_SECRET=your-secure-random-string
```

### 2.4 支持的模型

配置对应的 API Key 后，用户可以使用以下模型：

| 提供商 | 模型示例 | `.env` 变量 |
|--------|---------|-------------|
| DashScope | `dashscope/qwen3-coder-plus`, `dashscope/qwen-turbo` | `DASHSCOPE_API_KEY` |
| Anthropic | `claude-sonnet-4-5`, `claude-opus-4-5` | `ANTHROPIC_API_KEY` |
| OpenAI | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | `OPENAI_API_KEY` |
| DeepSeek | `deepseek/deepseek-chat`, `deepseek/deepseek-reasoner` | `DEEPSEEK_API_KEY` |
| AiHubMix | `aihubmix/模型名` | `AIHUBMIX_API_KEY` |
| OpenRouter | `openrouter/任意模型`（兜底） | `OPENROUTER_API_KEY` |

Gateway 根据模型名自动匹配提供商并注入对应的 API Key，用户容器内不存储任何密钥。

### 2.5 构建与启动

**方式1：一键部署脚本**

```bash
# 准备环境（检查 Docker、下载镜像等）
python prepare.py

# 本地测试（启动 postgres + openclaw bridge + gateway + frontend）
python start_local.py

# 部署到服务器（指定 IP，自动构建镜像）
python deploy_docker.py --host=192.168.1.xxx

# 重新构建指定服务
python deploy_docker.py --rebuild openclaw,gateway,frontend --host 192.168.1.160

# 检查服务状态
python check_status.py
```

本地测试启动后：

```
本地开发环境已启动
        PostgreSQL  http://127.0.0.1:5432  (Docker 容器)
  OpenClaw Bridge   http://127.0.0.1:18080  (PID xxxxx)
  Platform Gateway  http://127.0.0.1:8080
      Frontend Dev  http://127.0.0.1:3080
```

**方式2：手动启动**

```bash
# 1. 构建 openclaw 基础镜像（包含 openclaw + bridge）
docker build -f openclaw/Dockerfile.bridge -t openclaw:latest openclaw/

# 2. 构建并启动所有服务
docker compose up -d --build

# 查看日志
docker compose logs -f
```

> **注意**：`frontend` 构建时需要指定 Gateway 的访问地址。默认为 `http://localhost:8080`。
> 如果从其他机器访问，需修改 `docker-compose.yml` 中的 `NEXT_PUBLIC_API_URL`：
> ```yaml
> frontend:
>   build:
>     context: ./frontend
>     args:
>       NEXT_PUBLIC_API_URL: http://你的服务器IP:8080
> ```

### 2.6 使用

1. 打开浏览器访问 `http://localhost:3080`
2. 注册账号并登录
3. 开始聊天 — Gateway 会自动为你创建隔离的 OpenClaw 容器

### 2.7 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Frontend | 3080 (映射 3000) | Web 界面 |
| Gateway | 8080 | API 网关（浏览器直接请求） |
| PostgreSQL | 15432 (映射 5432) | 内部数据库 |
| OpenClaw Bridge (容器内) | 18080 | 容器对外 HTTP + WS |
| OpenClaw Gateway (容器内) | 18789 | 容器内部 Agent 引擎 (loopback) |

### 2.8 数据持久化

| 数据 | 存储方式 |
|------|---------|
| 用户账户、配额、容器元数据 | PostgreSQL（`pgdata` volume） |
| 用户工作区和会话 | Docker named volumes + `/data/openclaw-users` |

### 2.9 常用运维命令

```bash
# 查看所有容器
docker ps -a --filter "name=openclaw"

# 查看某个用户容器的日志
docker logs -f openclaw-user-xxxxxxxx

# 重建 gateway（修改后端代码后）
docker compose build --no-cache gateway && docker compose up -d

# 重建 frontend（修改前端代码或 API 地址后）
docker compose build --no-cache frontend && docker compose up -d

# 完全重置（删除所有数据）
docker compose down -v
docker rm -f $(docker ps -a --filter "name=openclaw-user-" -q) 2>/dev/null
```

---

## 3. 单用户本地运行（测试）

适合个人使用或者测试，无需完整多租户架构。

### 3.1 运行

```bash
# 启动所有本地服务（推荐）
python start_local.py

# 或手动分别启动：
# 1. PostgreSQL
docker run -d --name postgres \
  -e POSTGRES_USER=nanobot \
  -e POSTGRES_PASSWORD=nanobot \
  -e POSTGRES_DB=nanobot_platform \
  -v pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Platform Gateway
cd platform
export PLATFORM_DATABASE_URL="postgresql+asyncpg://nanobot:nanobot@localhost:5432/nanobot_platform"
python -m app.main

# 3. Frontend
cd frontend && npm run dev
```

### 截图

![chat.png](doc/chat.png)
![chat2.png](doc/chat2.png)

---

## 4. 整体架构

```
                        ┌──────────────────────┐
                        │   浏览器 (Frontend)    │
                        │   Next.js :3080        │
                        └──────────┬───────────┘
                                   │ HTTP + WebSocket
                                   v
                        ┌──────────────────────┐
                        │  Platform Gateway     │
                        │  FastAPI :8080         │
                        │  ┌────────────────┐   │
                        │  │ Auth (JWT)      │   │
                        │  │ Container Mgr   │   │
                        │  │ LLM Proxy       │   │
                        │  │ Quota Control   │   │
                        │  └────────────────┘   │
                        └───┬──────────┬───────┘
                            │          │
                  ┌─────────┘          └──────────┐
                  v                               v
        ┌──────────────┐               ┌──────────────────┐
        │  PostgreSQL   │               │  用户容器 (N个)    │
        │  :5432        │               │  ┌──────────────┐ │
        │  用户/配额/    │               │  │ Bridge :18080│ │
        │  容器元数据    │               │  │  HTTP + WS   │ │
        └──────────────┘               │  └──────┬───────┘ │
                                       │         v         │
                                       │  ┌──────────────┐ │
                                       │  │ OpenClaw GW  │ │
                                       │  │ :18789       │ │
                                       │  │ (loopback)   │ │
                                       │  │              │ │
                                       │  │ Agent Engine │ │
                                       │  │ Tools/Skills │ │
                                       │  │ Sessions     │ │
                                       │  └──────────────┘ │
                                       └──────────────────┘
                                               │
                                    LLM 请求通过 Gateway 代理
                                               │
                                               v
                                    ┌──────────────────┐
                                    │  LLM Providers    │
                                    │  Anthropic/OpenAI │
                                    │  DashScope/...    │
                                    └──────────────────┘
```

---

## 5. 核心组件详解

### 5.1 OpenClaw Agent 引擎 (`openclaw/`)

OpenClaw 是一个功能丰富的 AI Agent 框架（TypeScript/Node.js），核心能力包括：

- **Agent Loop**：ReAct 模式的工具调用循环，支持多轮迭代
- **工具系统**：Bash 执行、文件读写、Web 搜索/抓取、消息发送等
- **Skills 系统**：Markdown 格式的技能文件，支持内置 + 用户自定义
- **Session 管理**：对话历史持久化
- **多 Provider 支持**：通过 OpenAI 兼容接口对接各种 LLM

### 5.2 Bridge 适配层 (`openclaw/bridge/`)

Bridge 是连接平台和 OpenClaw 的关键适配层，在每个用户容器内运行：

| 文件 | 职责 |
|------|------|
| `bridge/start.ts` | 启动入口：写入 OpenClaw 配置 → 启动 OpenClaw Gateway 子进程 → 等待就绪 → 启动 HTTP 服务 |
| `bridge/server.ts` | Express HTTP 服务器（端口 18080），挂载 REST API 路由 + WebSocket 中继 |
| `bridge/gateway-client.ts` | WebSocket 客户端，连接本地 OpenClaw Gateway（端口 18789），Ed25519 握手认证 |
| `bridge/config.ts` | 读取环境变量（代理URL、Token、模型），创建工作目录 |
| `bridge/routes/*.ts` | 各功能 API：sessions、skills、commands、plugins、cron、marketplace 等 |

**Bridge 启动流程：**

```
1. 读取环境变量 (NANOBOT_PROXY__URL, NANOBOT_PROXY__TOKEN, 模型名)
2. 写入 ~/.openclaw/openclaw.json（配置 LLM 代理、模型、Gateway 模式）
3. 启动 OpenClaw Gateway 子进程: node openclaw.mjs gateway run --port 18789 --bind loopback
4. 等待 Gateway WebSocket 就绪（最多 60 秒）
5. 建立 Bridge → Gateway 的 WS 连接（Ed25519 握手）
6. 启动 HTTP 服务器（0.0.0.0:18080），对外暴露 API
```

### 5.3 Platform Gateway (`platform/`)

Python FastAPI 应用，是整个平台的控制中心：

| 模块 | 文件 | 职责 |
|------|------|------|
| 认证 | `app/auth/service.py` | JWT + bcrypt，注册/登录/刷新 Token |
| 容器管理 | `app/container/manager.py` | Docker API 创建/暂停/归档/销毁用户容器 |
| LLM 代理 | `app/llm_proxy/service.py` | API Key 注入、配额检查、用量记录 |
| HTTP 代理 | `app/routes/proxy.py` | 转发 HTTP/WebSocket 请求到用户容器 |
| 数据库 | `app/db/models.py` | 用户、容器、用量 ORM 模型 |

**容器生命周期：**

```
用户首次聊天 → create_container()
  ├─ 在 DB 中占位（防并发）
  ├─ 创建 Docker Volume（workspace + sessions）
  ├─ 启动容器（资源限制：2GB RAM, 4 CPU）
  └─ 记录容器 IP、Token

空闲 30 分钟 → pause（暂停容器，释放 CPU）
再次访问    → unpause（秒级恢复）
空闲 30 天  → archive（归档）
用户删除    → destroy（移除容器，保留数据 Volume）
```

### 5.4 LLM 代理机制

容器内的 OpenClaw 调用 LLM 时，不直接访问 LLM API，而是请求 Gateway 代理：

```
容器内 OpenClaw
  → POST http://gateway:8080/llm/v1/chat/completions
    Authorization: Bearer <container-token>
    Body: { model: "claude-sonnet-4-5", messages: [...] }

Gateway 处理：
  1. 通过 container-token 查找用户
  2. 检查每日 Token 配额（free: 100K, basic: 1M, pro: 10M）
  3. 根据模型名匹配 Provider（claude→Anthropic, gpt→OpenAI, qwen→DashScope...）
  4. 注入对应的真实 API Key
  5. 调用 LLM，流式/非流式返回结果
  6. 记录 Token 用量
```

### 5.5 Skills 系统

技能文件位于 `openclaw/skills/`，每个技能是一个包含 `SKILL.md` 的目录。用户也可以在自己的工作区中创建自定义技能。

**管理接口（通过 Bridge API）：**

- `GET /api/skills` — 列出所有技能（内置 + 用户自定义）
- `POST /api/skills/upload` — 上传技能（ZIP 格式）
- `DELETE /api/skills/:name` — 删除用户自定义技能
- `GET /api/skills/:name/download` — 导出技能

---

## 6. 安全设计

| 层面 | 措施 |
|------|------|
| API Key 隔离 | 所有 LLM API Key 仅存在于 Gateway 环境变量中，用户容器内无任何密钥 |
| 容器隔离 | 每个用户独立 Docker 容器，独立 Volume，资源限制 |
| 认证链路 | 前端 JWT → Gateway → 容器 Token（一次性，仅标识容器身份） |
| 网络隔离 | 用户容器运行在 `openclaw-internal` 网络，通过 Gateway 代理访问 LLM |
| 配额控制 | 每日 Token 配额，按用户等级分层 |
| 容器内安全 | OpenClaw Gateway 仅监听 loopback（127.0.0.1），Bridge 握手使用 Ed25519 |

---

## 7. 前端

Next.js 应用，暗色主题，位于 `frontend/` 目录。

### 7.1 技术栈

| 技术 | 用途 |
|------|------|
| Next.js | React 框架 |
| Tailwind CSS | 样式 |
| shadcn/ui | UI 组件库 |
| Zustand | 状态管理 |
| react-markdown | Markdown 渲染 |
| lucide-react | 图标 |

### 7.2 页面

| 路由 | 功能 |
|------|------|
| `/` | 聊天页面：左侧会话列表 + 右侧聊天区 + WebSocket 实时通信 + 斜杠命令自动补全 |
| `/login` | 用户登录 |
| `/register` | 用户注册 |
| `/status` | 系统状态面板 |
| `/cron` | 定时任务管理 |

### 7.3 WebSocket 协议

**前端 → Gateway → Bridge → OpenClaw Gateway**（逐层代理）

```json
// 发送消息
{ "type": "req", "id": 1, "method": "chat.send", "params": { "sessionKey": "...", "message": "..." } }

// 接收回复 (事件推送)
{ "type": "event", "event": "chat.message.received", "payload": { "content": "..." } }

// 心跳
{ "type": "ping" } / { "type": "pong" }
```

---

## 8. 文件索引

```
项目根目录/
├── docker-compose.yml              # 多租户部署编排（postgres + gateway + frontend）
├── .env                            # API Key 配置（不提交到 git）
├── deploy_docker.py                # 一键部署脚本（支持本地/远程）
├── start_local.py                  # 本地开发启动脚本
├── prepare.py                      # 环境准备脚本
├── check_status.py                 # 服务状态检查
│
├── openclaw/                       # OpenClaw Agent 框架（TypeScript/Node.js）
│   ├── Dockerfile.bridge           # 构建镜像：openclaw + bridge
│   ├── openclaw.mjs                # OpenClaw CLI 入口
│   ├── package.json                # 依赖管理
│   ├── src/                        # OpenClaw 源码
│   │   ├── entry.ts                # 应用入口
│   │   ├── agents/                 # Agent 引擎（ReAct 循环、工具调用等）
│   │   ├── providers/              # LLM Provider 层
│   │   ├── sessions/               # 会话管理
│   │   ├── channels/               # 渠道系统
│   │   ├── gateway/                # Gateway 服务
│   │   ├── plugins/                # 插件系统
│   │   ├── memory/                 # 记忆系统
│   │   ├── cli/                    # CLI 命令
│   │   └── ...
│   ├── bridge/                     # Bridge 适配层（平台 ↔ OpenClaw 的桥梁）
│   │   ├── start.ts                # 启动入口
│   │   ├── server.ts               # HTTP 服务器 + WS 中继
│   │   ├── gateway-client.ts       # 连接本地 OpenClaw Gateway 的 WS 客户端
│   │   ├── config.ts               # 环境变量读取与配置写入
│   │   └── routes/                 # REST API 路由
│   │       ├── sessions.ts         # 会话管理 API
│   │       ├── skills.ts           # 技能管理 API
│   │       ├── commands.ts         # 命令 API
│   │       ├── plugins.ts          # 插件 API
│   │       ├── cron.ts             # 定时任务 API
│   │       └── marketplace.ts      # 市场 API
│   ├── skills/                     # 内置技能
│   └── dist/                       # 构建产物
│
├── platform/                       # 多租户网关（Python FastAPI）
│   ├── Dockerfile                  # Gateway 镜像
│   ├── pyproject.toml              # Python 依赖
│   └── app/
│       ├── main.py                 # FastAPI 应用入口
│       ├── config.py               # 平台配置（环境变量、配额等级）
│       ├── auth/service.py         # 认证服务（JWT + bcrypt）
│       ├── container/manager.py    # 用户容器生命周期管理
│       ├── llm_proxy/service.py    # LLM 代理（Key 注入 + 配额）
│       ├── db/models.py            # 数据库模型
│       └── routes/
│           ├── auth.py             # 注册/登录/刷新 Token
│           ├── proxy.py            # HTTP/WebSocket 代理到用户容器
│           ├── llm.py              # LLM 代理端点
│           └── admin.py            # 管理接口
│
├── frontend/                       # Web 前端（Next.js）
│   ├── Dockerfile                  # Frontend 镜像
│   ├── app/                        # Next.js 页面
│   └── lib/api.ts                  # API 客户端（HTTP + WebSocket）
│
└── bridge/                         # WhatsApp Node.js 桥接（旧版，已被 openclaw 内置替代）
```

## 📬 联系方式

如有问题，请联系作者：
![weichat.png](doc/weichat.png)
