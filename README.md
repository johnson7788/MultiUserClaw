# MultiUserClaw - 多用户 AI Claw平台

基于nanobot改造的轻量级 AI 助手框架，支持多租户隔离部署、多平台渠道接入、工具调用、定时任务和 Web 实时通信。

🔔：simple_web分支是简单的单用户的Web界面。如果单用户的页面测试使用，可以使用simple_web分支。

🔔：nanobot010分支是nanobot的0.1.0版本

🔔：当前的main分支是nanobot的0.1.4版本

---

对原项目nanobot部分文件进行了修改，如果需要对nanobot进行更新，只需要保持这些文件不变即可。
  - 改造 nanobot/providers/litellm_provider.py：
    - 新增一个模式：当检测到环境变量 NANOBOT_LLM_PROXY_URL 时，所有 LLM 请求发往该 Proxy
    - 不需要 api_key，改用 X-Container-Token（一个一次性 token，仅用于标识容器身份，不含任何 LLM 密钥信息）
  - 改造 nanobot/config/schema.py：增加is_proxy_mode的配置
  - nanobot/web 新增Web目录
  - nanobot/agent/tools下的web.py新增get_wechat_article使用文件xng_search.py
  - nanobot/cli/commands.py 新增if config.is_proxy_mode检测
  - nanobot/channels/manager.py 启动web端管理
  - 新增platform作为控制容器的网关，每个用户单独创建容器进行管理
  - frontend前端页面进行显示

UPDATE:
- 首次支持plugins，多个Agent联合使用，更聪明，使用的是 ~/.nanobot/plugins/ or <workspace>/plugins/中的Plugins
- 支持文件管理，用户的文件上传和AI文件使用处理后下载
- 前端的输入优化，支持VLLM模型

## 目录

1. [多租户部署（Docker Compose）](#1-多租户部署docker-compose)
2. [单用户本地运行](#2-单用户本地运行)
3. [整体架构](#3-整体架构)
4. [Agent 系统](#4-agent-系统)
5. [工具系统](#5-工具系统)
6. [Provider 系统](#6-provider-系统)
7. [Session 系统](#7-session-系统)
8. [消息总线](#8-消息总线)
9. [Channel 系统](#9-channel-系统)
10. [Web Channel 与 WebSocket](#10-web-channel-与-websocket)
11. [Cron 与 Heartbeat](#11-cron-与-heartbeat)
12. [配置系统](#12-配置系统)
13. [CLI 命令](#13-cli-命令)
14. [前端](#14-前端)
15. [文件索引](#15-文件索引)

---

## 界面示例截图
多个用户的聊天页面和它们独自隔离的容器环境
![multi_users_chat.png](doc/multi_users_chat.png)
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

帮助页面
![help_page.png](doc/help_page.png)

Agent browser skill使用
![agent_browser1.png](doc/agent_browser1.png)
![agent_browser2.png](doc/agent_browser2.png)

## 1. 多租户部署（Docker Compose）

多租户模式下，每个用户拥有独立的 nanobot 容器，数据完全隔离。用户无需管理 API Key，只需注册登录即可使用。

### 1.1 架构

```
浏览器 ──► frontend:3000 ──(JS请求)──► gateway（platform项目):8080 ──► 用户容器(nanobot)
                                            ↕                   ↓
                                       postgres:5432      gateway/llm/v1
                                       (用户/配额)         (注入API Key)
                                                               ↓
                                                         实际 LLM 提供商
```

- **Frontend**：Next.js Web 界面，用户注册、登录、聊天
- **Gateway**：平台网关，负责认证、用户容器管理、LLM 代理、配额控制
- **用户容器**：每个用户一个独立的 nanobot 实例，自动创建，数据隔离
- **PostgreSQL**：存储用户账户、容器元数据、用量记录

### 1.2 前置条件

- Docker & Docker Compose
- 至少一个 LLM 提供商的 API Key

### 1.3 配置 `.env` 文件

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

### 1.4 支持的模型

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


### 1.5 构建与启动

方式1:一键部署或者一键测试脚本

python prepare.py 使用uv准备python环境，检查是否安装docker，检查docker镜像是否下载，然后自动下载

python deploy_docker.py --build-only  构建docker镜像

python start_local.py 一键测试，在本地运行。最好提前配置好python环境，和docker环境，会使用docker启动postgres数据库和创建用户的容器

python deploy_docker.py  一键部署到服务器，可以仔细查看下配置信息。

启动后使用check_status.py检查服务是否正常

python check_status.py

方式2:手动启动

```bash
# 1. 构建 nanobot 基础镜像（用户容器使用）
docker build -t nanobot:latest .

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

### 1.6 使用

1. 打开浏览器访问 `http://localhost:3080`
2. 注册账号并登录
3. 开始聊天 — Gateway 会自动为你创建隔离的 nanobot 容器

### 1.7 服务端口

| 服务 | 端口 | 说明 |
|------|------|------|
| Frontend | 3000 | Web 界面 |
| Gateway | 8080 | API 网关（浏览器直接请求） |
| PostgreSQL | 5432 | 内部，不对外暴露 |

### 1.8 数据持久化

| 数据 | 存储方式 |
|------|---------|
| 用户账户、配额、容器元数据 | PostgreSQL（`pgdata` volume） |
| 用户工作区和会话 | Docker named volumes（`nanobot-workspace-{id}`, `nanobot-sessions-{id}`） |

### 1.9 安全设计

- API Key 仅存在于 Gateway 环境变量中，用户容器内无任何密钥
- 用户容器运行在 `internal` 网络，无法直接访问互联网或 LLM API
- LLM 请求通过容器 token 认证后由 Gateway 代理转发
- 每日 token 配额控制（free: 100K, basic: 1M, pro: 10M）

### 1.10 常用运维命令

```bash
# 查看所有容器（包括用户容器）
docker ps -a --filter "name=nanobot"

# 查看某个用户容器的日志
docker logs -f nanobot-user-xxxxxxxx

# 重建 gateway（修改后端代码后）
docker compose build --no-cache gateway && docker compose up -d

# 重建 frontend（修改前端代码或 API 地址后）
docker compose build --no-cache frontend && docker compose up -d

# 完全重置（删除所有数据）
docker compose down -v
docker rm -f $(docker ps -a --filter "name=nanobot-user-" -q) 2>/dev/null
```

---

## 2. 单用户本地运行(测试)

适合个人使用或者测试，无需 Docker，直接在本机运行。

### 2.1 配置

编辑 `~/.nanobot/config.json`，只需配置模型和对应 provider 的 key：

```json
{
  "agents": {
    "defaults": {
      "model": "dashscope/qwen3-coder-plus"
    }
  },
  "providers": {
    "dashscope": {
      "apiKey": "sk-xxxx",
      "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
  }
}
```

### 2.2 运行

```bash
# 单条消息测试
nanobot agent -m 'hello'

# 交互式聊天
nanobot agent

# Web 界面（后端 + 数据库+ 管理容器的API端 + 前端）
nanobot web                      # 后端，默认端口 18080
docker run -d \
  --name postgres \
  -e POSTGRES_USER=nanobot \
  -e POSTGRES_PASSWORD=nanobot \
  -e POSTGRES_DB=nanobot_platform \
  -v pgdata:/var/lib/postgresql/data \
  -p 5432:5432 \
  postgres:16-alpine
cd platform
export PLATFORM_DATABASE_URL="postgresql+asyncpg://nanobot:nanobot@localhost:5432/nanobot_platform"
python -m app.main
cd frontend && npm run dev       # 前端，默认端口 3000
```

### 2.3 清空历史

```bash
rm ~/.nanobot/sessions/cli_direct.jsonl
```

### 截图

![chat.png](doc/chat.png)
![chat2.png](doc/chat2.png)
![cron_job.png](doc/cron_job.png)
![cron_status.png](doc/cron_status.png)

---

## 3. 整体架构

```
                          ┌─────────────────┐
                          │   Chat Channels  │
                          │ Telegram/Discord │
                          │ Feishu/Slack/QQ  │
                          │ Email/DingTalk   │
                          │ WhatsApp/Mochat  │
                          │     Web(WS)      │
                          └────────┬─────────┘
                                   │ _handle_message()
                                   ▼
                     ┌──────────────────────────┐
                     │   MessageBus (inbound)    │
                     │    asyncio.Queue          │
                     └────────────┬─────────────┘
                                  │ consume_inbound()
                                  ▼
                     ┌──────────────────────────┐
                     │       AgentLoop           │
                     │  ┌────────────────────┐   │
                     │  │  ContextBuilder     │   │
                     │  │  (system prompt +   │   │
                     │  │   memory + skills   │   │
                     │  │   + history)        │   │
                     │  └────────┬───────────┘   │
                     │           ▼               │
                     │  ┌────────────────────┐   │
                     │  │  LiteLLMProvider    │   │
                     │  │  (12+ providers)    │   │
                     │  └────────┬───────────┘   │
                     │           ▼               │
                     │  ┌────────────────────┐   │
                     │  │  Tool Execution     │   │
                     │  │  read/write/exec/   │   │
                     │  │  web/message/spawn  │   │
                     │  └────────────────────┘   │
                     └────────────┬─────────────┘
                                  │ publish_outbound()
                                  ▼
                     ┌──────────────────────────┐
                     │   MessageBus (outbound)   │
                     └────────────┬─────────────┘
                                  │ _dispatch_outbound()
                                  ▼
                     ┌──────────────────────────┐
                     │    ChannelManager         │
                     │    route by msg.channel   │
                     └────────────┬─────────────┘
                                  │ channel.send(msg)
                                  ▼
                          ┌───────────────┐
                          │  用户收到回复   │
                          └───────────────┘

辅助服务：
  CronService ──────► agent.process_direct() ──► 回复投递
  HeartbeatService ──► agent.process_direct() ──► HEARTBEAT.md 任务
  SubagentManager ──► 后台子任务 ──► 结果通过 bus 通知主 agent
  SessionManager ◄──► JSONL 文件 (~/.nanobot/sessions/)
```

**运行模式：**

| 模式 | 启动方式 | 说明 |
|------|---------|------|
| 多租户 | `docker compose up -d` | Gateway + Frontend + PostgreSQL，每用户独立容器 |
| Web | `nanobot web` | 单用户 Web 界面，含 WebSocket 支持 |
| Gateway | `nanobot gateway` | 完整模式：AgentLoop + 所有 Channel + Cron + Heartbeat |
| Agent | `nanobot agent` | 独立 CLI 交互，不走 MessageBus |

---

## 4. Agent 系统

### 4.1 AgentLoop (`nanobot/agent/loop.py`)

核心处理引擎，实现 ReAct 模式的工具调用循环。

**两种执行方式：**

| 方法 | 模式 | 用途 |
|------|------|------|
| `run()` | 长驻 | 从 bus.inbound 持续消费消息，处理后发到 bus.outbound |
| `process_direct()` | 单次 | CLI/Cron 直接调用，同步返回结果 |

**消息处理流程 (`_process_message`)：**

```
1. 获取/创建 Session (SessionManager.get_or_create)
2. ContextBuilder.build_messages() 组装上下文
3. 循环（最多 max_iterations=20 次）:
   ├─ 调用 LLM (provider.chat)
   ├─ 有 tool_calls → 执行工具 → 追加结果 → 继续循环
   └─ 无 tool_calls → 获得最终回复 → 跳出
4. 保存 user + assistant 消息到 Session
5. 返回 OutboundMessage
```

**上下文组装 (`ContextBuilder`, `nanobot/agent/context.py`)：**

```
System Prompt = 核心身份 + 行为准则 + 运行时信息
              + Bootstrap 文件 (AGENTS.md, SOUL.md, USER.md, ...)
              + 长期记忆 (memory/MEMORY.md)
              + 今日笔记 (memory/YYYY-MM-DD.md)
              + Always-on Skills (全文嵌入)
              + Skills 摘要 (XML 列表，agent 按需 read_file 加载)
              + Channel/ChatID 上下文
```

支持多模态：媒体文件（图片）会被 base64 编码为 OpenAI vision 格式。

### 4.2 记忆系统 (`nanobot/agent/memory.py`)

基于文件的两层记忆：

| 层级 | 文件 | 说明 |
|------|------|------|
| 长期 | `{workspace}/memory/MEMORY.md` | 持久化事实、偏好 |
| 每日 | `{workspace}/memory/YYYY-MM-DD.md` | 按日期记录，支持追加 |

`get_memory_context()` 返回合并的记忆上下文，嵌入 system prompt。

### 4.3 技能系统 (`nanobot/agent/skills.py`)

Markdown 格式的指令文件，教 agent 特定能力。

**加载优先级：** 用户目录 (`{workspace}/skills/`) > 内置目录 (`nanobot/skills/`)

**渐进加载模式：**
- `always=true` 的技能 → 全文嵌入 system prompt
- 其余技能 → XML 摘要列出名称和描述，agent 需要时通过 `read_file` 按需加载

**需求检查：** 技能 frontmatter 可声明依赖（`bins`: CLI 工具, `env`: 环境变量），未满足时标为 `available="false"`。

**内置技能：** `github`, `weather`, `summarize`, `tmux`, `skill-creator`, `cron`

### 4.4 子代理 (`nanobot/agent/subagent.py`)

通过 `spawn` 工具启动后台任务：

- 独立上下文（不共享主 agent 对话历史）
- 受限工具集（无 `message`、`spawn`，防止级联）
- 最多 15 次迭代
- 完成后发布 `channel="system"` 消息到 bus → 主 agent 接收处理后转发给用户

---

## 5. 工具系统

### 5.1 工具基类 (`nanobot/agent/tools/base.py`)

```python
class Tool(ABC):
    name: str                    # 工具名
    description: str             # 功能描述
    parameters: dict             # JSON Schema 参数定义
    async execute(**kwargs) -> str  # 执行工具
    to_schema() -> dict          # 转为 OpenAI function calling 格式
```

内置参数校验：支持类型、枚举、范围、必填字段、嵌套对象等 JSON Schema 校验。

### 5.2 工具注册表 (`nanobot/agent/tools/registry.py`)

动态注册/注销，`get_definitions()` 生成 OpenAI 函数定义。`execute()` 先校验参数再执行，出错返回错误字符串（不抛异常）。

### 5.3 工具列表

| 工具 | 文件 | 参数 | 说明 |
|------|------|------|------|
| `read_file` | `tools/filesystem.py` | `path` | 读取文件，支持 workspace 限制 |
| `write_file` | `tools/filesystem.py` | `path`, `content` | 写入文件，自动创建目录 |
| `edit_file` | `tools/filesystem.py` | `path`, `old_text`, `new_text` | 搜索替换；`old_text` 出现 >1 次时拒绝执行（防歧义） |
| `list_dir` | `tools/filesystem.py` | `path` | 列出目录内容 |
| `exec` | `tools/shell.py` | `command`, `working_dir` | 执行 shell 命令。**安全拦截**：拒绝 `rm -rf`/`format`/`dd`/关机等危险操作。超时 60s，输出截断 10000 字符 |
| `web_search` | `tools/web.py` | `query`, `count` | Brave Search API 搜索 |
| `web_fetch` | `tools/web.py` | `url`, `extractMode`, `maxChars` | 抓取网页，`readability-lxml` 提取正文，支持 HTML→Markdown |
| `message` | `tools/message.py` | `content`, `channel`, `chat_id` | 向指定渠道发消息（通过 bus） |
| `spawn` | `tools/spawn.py` | `task`, `label` | 启动后台子代理，立即返回 |
| `cron` | `tools/cron.py` | `action`, `message`, `every_seconds`, `cron_expr`, `job_id` | 管理定时任务 CRUD |

---

## 6. Provider 系统

### 6.1 统一接口 (`nanobot/providers/base.py`)

```python
class LLMProvider(ABC):
    async def chat(messages, tools, model, max_tokens, temperature) -> LLMResponse

@dataclass
class LLMResponse:
    content: str | None
    tool_calls: list[ToolCallRequest]
    finish_reason: str
    usage: dict
    reasoning_content: str | None  # 支持 DeepSeek-R1/Kimi 思维链
```

### 6.2 Provider 注册表 (`nanobot/providers/registry.py`)

数据驱动的声明式注册表。每个 provider 是一个 `ProviderSpec` 数据类，包含关键字匹配、LiteLLM 前缀、环境变量配置、模型参数覆写等。

| Provider | 类型 | 关键字 | 说明 |
|----------|------|--------|------|
| `openrouter` | 网关 | openrouter | 通过 `sk-or-` key 前缀自动检测 |
| `aihubmix` | 网关 | aihubmix | 去除模型前缀后重新加前缀 |
| `anthropic` | 标准 | anthropic, claude | |
| `openai` | 标准 | openai, gpt | |
| `deepseek` | 标准 | deepseek | |
| `gemini` | 标准 | gemini | |
| `zhipu` | 标准 | zhipu, glm | 智谱 AI |
| `dashscope` | 标准 | qwen, dashscope | 阿里通义千问 |
| `moonshot` | 标准 | moonshot, kimi | Kimi K2.5 temperature 覆写 |
| `minimax` | 标准 | minimax | |
| `vllm` | 本地 | vllm | 任意 OpenAI 兼容本地服务 |
| `groq` | 辅助 | groq | 主要用于 Whisper 语音转文字 |

### 6.3 LiteLLMProvider (`nanobot/providers/litellm_provider.py`)

通过 LiteLLM 统一调用所有 provider：

1. **模型解析 (`_resolve_model`)：** 网关模式加前缀，标准模式自动匹配 provider 前缀
2. **调用：** `litellm.acompletion()` + 模型级参数覆写
3. **响应解析：** 提取 content、tool_calls、reasoning_content、usage
4. **错误处理：** 优雅降级，出错返回包含错误信息的 LLMResponse

---

## 7. Session 系统 (`nanobot/session/manager.py`)

### 存储格式

JSONL 文件，位于 `~/.nanobot/sessions/`：

```jsonl
{"_type": "metadata", "created_at": "...", "updated_at": "...", "metadata": {}}
{"role": "user", "content": "你好", "timestamp": "2024-01-01T12:00:00"}
{"role": "assistant", "content": "你好！有什么...", "timestamp": "2024-01-01T12:00:01"}
```

### Session Key 格式

`"{channel}:{chat_id}"`，例如：

| Key | 含义 |
|-----|------|
| `telegram:12345` | Telegram 用户 |
| `web:default` | Web 默认会话 |
| `web:1707123456789` | Web 时间戳会话 |
| `cron:abc123` | 定时任务 |
| `cli:default` | CLI 交互 |

### 关键方法

| 方法 | 说明 |
|------|------|
| `get_or_create(key)` | 缓存优先 → 磁盘读取 → 新建 |
| `save(session)` | 全量写入 JSONL |
| `delete(key)` | 删除缓存和文件 |
| `list_sessions()` | 扫描所有 .jsonl，仅读 metadata 行，按 updated_at 倒序 |
| `get_history(max_messages=50)` | 返回最近 N 条消息（LLM 格式） |

---

## 8. 消息总线 (`nanobot/bus/`)

### 事件类型 (`bus/events.py`)

```python
@dataclass
class InboundMessage:     # 渠道 → Agent
    channel, sender_id, chat_id, content, timestamp, media, metadata
    session_key: str  # property: "{channel}:{chat_id}"

@dataclass
class OutboundMessage:    # Agent → 渠道
    channel, chat_id, content, reply_to, media, metadata
```

### 消息队列 (`bus/queue.py`)

两个 `asyncio.Queue` 实现解耦：

```
Channel ──publish_inbound()──► [inbound] ──consume_inbound()──► AgentLoop
AgentLoop ──publish_outbound()──► [outbound] ──consume_outbound()──► ChannelManager
```

---

## 9. Channel 系统

### 9.1 BaseChannel (`nanobot/channels/base.py`)

所有渠道的抽象基类：

```python
class BaseChannel(ABC):
    name: str
    async def start()               # 连接并持续监听
    async def stop()                 # 清理资源
    async def send(msg)              # 发送出站消息
    def is_allowed(sender_id)        # 检查 allow_from 权限
    async def _handle_message(...)   # 权限检查 + 发布到 bus.inbound
```

### 9.2 ChannelManager (`nanobot/channels/manager.py`)

- `_init_channels()`：根据配置惰性导入并初始化各渠道（缺少 SDK 不会崩溃）
- `start_all()`：启动出站分发协程 + 并行启动所有渠道
- `_dispatch_outbound()`：从 bus.outbound 消费，按 `msg.channel` 路由到对应渠道的 `send()`
- `stop_all()`：取消分发任务，逐个停止渠道

### 9.3 已支持渠道

| 渠道 | 文件 | 协议 |
|------|------|------|
| Telegram | `channels/telegram.py` | python-telegram-bot SDK, 支持语音转文字 (Groq Whisper) |
| WhatsApp | `channels/whatsapp.py` | WebSocket 连接 Node.js bridge |
| Discord | `channels/discord.py` | Gateway WebSocket + REST API |
| Feishu | `channels/feishu.py` | lark-oapi SDK WebSocket |
| DingTalk | `channels/dingtalk.py` | dingtalk-stream SDK |
| Email | `channels/email.py` | IMAP 轮询 + SMTP 发送 |
| Slack | `channels/slack.py` | Socket Mode + Web API |
| QQ | `channels/qq.py` | qq-botpy SDK |
| Mochat | `channels/mochat.py` | Socket.IO + HTTP 轮询 |
| **Web** | **`channels/web.py`** | **FastAPI + WebSocket** |

---

## 10. Web Channel 与 WebSocket

### 10.1 设计动机

Web 前端像其他渠道一样工作：**提交任务 → 关闭浏览器 → 稍后回来查看结果。**

Session 的 JSONL 文件已经持久化了所有消息，不需要额外的"离线队列"。用户重连时，前端从 session history 获取完整对话即可。

### 10.2 架构

```
nanobot web
  ├── AgentLoop (消费 MessageBus)
  ├── CronService + HeartbeatService
  └── ChannelManager
      ├── TelegramChannel, DiscordChannel, ...
      └── WebChannel
          ├── FastAPI HTTP 服务器 (sessions, status, cron 端点)
          └── WebSocket /ws/{session_id} (实时推送)
```

### 10.3 消息流

**发送消息：**

```
浏览器
  → WebSocket {"type":"message","content":"..."}
  → WebChannel._handle_message()
  → bus.publish_inbound()
  → AgentLoop 处理（可能调用工具、多轮迭代）
  → bus.publish_outbound()
  → ChannelManager._dispatch_outbound()
  → WebChannel.send()
  → WebSocket {"type":"message","role":"assistant","content":"..."}
```

**离线重连：**

```
浏览器重新打开
  → WebSocket 自动重连（指数退避 1s→2s→4s→...→30s）
  → 前端 GET /api/sessions/{key}
  → 获取完整对话历史（包括离线期间到达的回复）
  → 渲染到界面
```

### 10.4 WebSocket 协议

**客户端 → 服务端：**

```json
{"type": "message", "content": "你好"}
{"type": "ping"}
```

**服务端 → 客户端：**

```json
{"type": "message", "role": "assistant", "content": "你好！有什么可以帮助你的？"}
{"type": "status", "status": "thinking"}
{"type": "pong"}
```

---

## 11. Cron 与 Heartbeat

### 11.1 CronService (`nanobot/cron/service.py`)

基于 asyncio 的定时调度器。存储：`~/.nanobot/cron/jobs.json`

**调度类型：**

| 类型 | 字段 | 说明 |
|------|------|------|
| `at` | `at_ms` | 一次性，指定时间戳（执行后自动禁用/删除） |
| `every` | `every_ms` | 间隔执行（now + every_ms） |
| `cron` | `expr` | Cron 表达式（使用 `croniter` 计算下次执行） |

### 11.2 HeartbeatService (`nanobot/heartbeat/service.py`)

每 30 分钟唤醒 agent，读取 `{workspace}/HEARTBEAT.md`：

- 文件为空/仅包含标题 → 跳过
- 有实质内容 → 发送给 agent 处理

---

## 12. 配置系统

### 12.1 配置文件（单用户模式）

位置：`~/.nanobot/config.json`（camelCase JSON）

```json
{
  "agents": {
    "defaults": {
      "workspace": "~/.nanobot/workspace",
      "model": "dashscope/qwen3-coder-plus",
      "maxTokens": 8192,
      "temperature": 0.7,
      "maxToolIterations": 20
    }
  },
  "channels": {
    "telegram": { "enabled": true, "token": "..." },
    "web": { "enabled": false, "host": "0.0.0.0", "port": 18080 }
  },
  "providers": {
    "dashscope": {
      "apiKey": "sk-...",
      "apiBase": "https://dashscope.aliyuncs.com/compatible-mode/v1"
    }
  },
  "tools": {
    "web": { "search": { "apiKey": "..." } },
    "exec": { "timeout": 60 },
    "restrictToWorkspace": false
  }
}
```

### 12.2 平台配置（多租户模式）

通过 `.env` 文件和 `docker-compose.yml` 的环境变量配置，详见 [1.3 配置 .env 文件](#13-配置-env-文件)。

**环境变量覆写：** `NANOBOT_AGENTS__DEFAULTS__MODEL=xxx`（双下划线表示层级嵌套）
配置每个用户的LLM的token额度: platform/app/config.py
---

## 13. CLI 命令

| 命令 | 说明 |
|------|------|
| `nanobot onboard` | 初始化配置和工作区（创建 config.json + 模板文件） |
| `nanobot gateway -p 18790` | 启动完整网关 |
| `nanobot web -p 18080` | 启动 Web 界面（gateway + 自动启用 Web Channel） |
| `nanobot agent -m "..."` | 单条消息模式 |
| `nanobot agent` | 交互式 REPL（prompt_toolkit，支持历史、粘贴、Markdown 渲染） |
| `nanobot status` | 显示配置、工作区、API Key 状态 |
| `nanobot channels status` | 显示渠道启用状态 |
| `nanobot channels login` | WhatsApp QR 码连接 |
| `nanobot cron list\|add\|remove\|enable\|run` | 定时任务管理 |

---

## 14. 前端

Next.js 应用，暗色主题，位于 `frontend/` 目录。

### 14.1 技术栈

| 技术 | 用途 |
|------|------|
| Next.js | React 框架 |
| Tailwind CSS | 样式 |
| shadcn/ui | UI 组件库 |
| Zustand | 状态管理 |
| react-markdown | Markdown 渲染 |
| lucide-react | 图标 |

### 14.2 页面

| 路由 | 功能 |
|------|------|
| `/` | 聊天页面：左侧会话列表 + 右侧聊天区 + WebSocket 实时通信 |
| `/login` | 用户登录 |
| `/register` | 用户注册 |
| `/status` | 系统状态面板：配置、Provider、Channel、Cron 状态 |
| `/cron` | 定时任务管理：CRUD 表格 + 添加表单 |

---

## 15. 文件索引

```
nanobot/
├── Dockerfile                   # nanobot 基础镜像（用户容器使用）
├── docker-compose.yml           # 多租户部署编排
├── .env                         # API Key 配置（不提交到 git）
│
├── platform/                    # 多租户网关
│   ├── Dockerfile               # Gateway 镜像
│   ├── pyproject.toml           # Python 依赖
│   └── app/
│       ├── main.py              # FastAPI 应用入口
│       ├── config.py            # 平台配置（环境变量）
│       ├── auth/service.py      # 认证服务（JWT + bcrypt）
│       ├── container/manager.py # 用户容器生命周期管理
│       ├── llm_proxy/service.py # LLM 代理（Key 注入 + 配额）
│       ├── db/models.py         # 数据库模型
│       └── routes/              # API 路由
│           ├── auth.py          # 注册/登录/刷新 token
│           ├── proxy.py         # HTTP/WebSocket 代理到用户容器
│           ├── llm.py           # LLM 代理端点
│           └── admin.py         # 管理接口
│
├── frontend/                    # Web 前端
│   ├── Dockerfile               # Frontend 镜像
│   ├── .dockerignore            # 排除 .env.local 等开发文件
│   └── app/                     # Next.js 页面
│
├── nanobot/                     # 核心 Agent 框架
│   ├── agent/                   # AgentLoop + 上下文 + 记忆 + 技能
│   │   └── tools/               # 内置工具
│   ├── bus/                     # 消息总线
│   ├── channels/                # 渠道接入（10 个渠道）
│   ├── cli/commands.py          # CLI 命令
│   ├── config/                  # 配置加载
│   ├── cron/                    # 定时任务
│   ├── heartbeat/               # 心跳服务
│   ├── providers/               # LLM Provider 层
│   ├── session/                 # 会话管理
│   └── web/server.py            # Web 服务器
│
└── bridge/                      # WhatsApp Node.js 桥接
```

## 📬 联系方式

如有问题，请联系作者：
![weichat.png](doc/weichat.png)
