import { useState, useEffect, useCallback } from 'react'
import {
  RefreshCw,
  Trash2,
  AlertCircle,
  Settings,
  Loader2,
  Plus,
  ChevronDown,
  ChevronUp,
  X,
  Save,
  CheckCircle,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type {
  ChannelsStatusResult,
  ChannelAccountSnapshot,
} from '../lib/api'
import {
  getChannelsStatus,
  getConfiguredChannels,
  getChannelConfig,
  saveChannelConfig,
  deleteChannelConfig,
} from '../lib/api'

// Static channel catalog — only real OpenClaw-supported channels
const CHANNEL_CATALOG: Array<{ id: string; label: string; description: string; icon: string }> = [
  { id: 'telegram', label: 'Telegram', description: '通过 Telegram Bot 接入', icon: '✈️' },
  { id: 'discord', label: 'Discord', description: '通过 Discord Bot 接入', icon: '🎮' },
  { id: 'whatsapp', label: 'WhatsApp', description: '通过 WhatsApp Web (Baileys) 接入', icon: '📱' },
  { id: 'slack', label: 'Slack', description: '通过 Slack Bot 接入工作区', icon: '💜' },
  { id: 'signal', label: 'Signal', description: '通过 signal-cli 守护进程接入', icon: '🔒' },
  { id: 'imessage', label: 'iMessage', description: '通过 macOS iMessage 接入', icon: '💬' },
  { id: 'web', label: 'Web', description: '内嵌网页对话框', icon: '🌐' },
  { id: 'googlechat', label: 'Google Chat', description: '通过 Google Chat API 接入', icon: '💚' },
  { id: 'msteams', label: 'Microsoft Teams', description: '通过 Azure Bot 接入 Teams', icon: '🟦' },
  { id: 'feishu', label: '飞书 / Lark', description: '通过飞书/Lark 机器人接入', icon: '📘' },
  { id: 'matrix', label: 'Matrix', description: '通过 Matrix 协议接入（支持 E2EE）', icon: '🔷' },
  { id: 'mattermost', label: 'Mattermost', description: '通过 Mattermost Bot 接入', icon: '🔵' },
  { id: 'irc', label: 'IRC', description: '通过 IRC 协议接入', icon: '📡' },
  { id: 'nostr', label: 'Nostr', description: '通过 Nostr 去中心化协议接入', icon: '🟣' },
  { id: 'bluebubbles', label: 'BlueBubbles', description: '通过 BlueBubbles 接入 iMessage', icon: '🫧' },
  { id: 'twitch', label: 'Twitch', description: '通过 Twitch IRC 接入直播聊天', icon: '💜' },
  { id: 'nextcloud-talk', label: 'Nextcloud Talk', description: '通过 Nextcloud Talk Bot 接入', icon: '☁️' },
  { id: 'synology-chat', label: 'Synology Chat', description: '通过 Synology Chat Bot 接入', icon: '🟢' },
  { id: 'zalo', label: 'Zalo', description: '通过 Zalo OA API 接入', icon: '🔵' },
  { id: 'qqbot', label: 'QQ', description: '通过 QQ 机器人接入（需安装 QQBot 插件）', icon: '🐧' },
  { id: 'wecom', label: '企业微信', description: '通过企业微信 AI Bot WebSocket 接入（需安装 WeCom 插件）', icon: '💼' },
  { id: 'dingtalk', label: '钉钉', description: '通过钉钉企业机器人接入（需安装 DingTalk 插件）', icon: '💙' },
]

const CHANNEL_ICONS: Record<string, string> = Object.fromEntries(
  CHANNEL_CATALOG.map((ch) => [ch.id, ch.icon]),
)

// DM policy options shared across channels
const DM_POLICY_OPTIONS = [
  { value: 'pairing', label: 'pairing — 需配对验证' },
  { value: 'allowlist', label: 'allowlist — 仅白名单用户' },
  { value: 'open', label: 'open — 所有人可用' },
  { value: 'disabled', label: 'disabled — 禁用私聊' },
]

const GROUP_POLICY_OPTIONS = [
  { value: 'open', label: 'open — 所有群组' },
  { value: 'allowlist', label: 'allowlist — 仅白名单群组' },
  { value: 'disabled', label: 'disabled — 禁用群聊' },
]

const STREAMING_OPTIONS = [
  { value: '', label: '（默认）' },
  { value: 'off', label: 'off — 关闭流式' },
  { value: 'partial', label: 'partial — 部分流式' },
  { value: 'block', label: 'block — 按块流式' },
  { value: 'progress', label: 'progress — 进度指示' },
]

type FieldType = 'text' | 'password' | 'boolean' | 'select' | 'textarea' | 'number'

interface ChannelField {
  key: string
  label: string
  type: FieldType
  hint?: string
  required?: boolean
  options?: Array<{ value: string; label: string }>
}

// Channel config fields based on actual OpenClaw source (types.*.ts)
const CHANNEL_CONFIG_FIELDS: Record<string, ChannelField[]> = {
  telegram: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, hint: '从 @BotFather 获取的 Bot Token' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS, hint: '控制谁可以私聊 Bot' },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 Telegram 用户 ID（数字）' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'groupAllowFrom', label: '允许的群组', type: 'text', hint: '逗号分隔的群组 ID' },
    { key: 'streaming', label: '流式输出', type: 'select', options: STREAMING_OPTIONS },
  ],
  discord: [
    { key: 'token', label: 'Bot Token', type: 'password', required: true, hint: 'Discord Developer Portal 中的 Bot Token' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 Discord 用户 ID' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'streaming', label: '流式输出', type: 'select', options: STREAMING_OPTIONS },
    { key: 'ackReaction', label: '确认表情', type: 'text', hint: '收到消息时回复的 emoji，如 👀' },
  ],
  slack: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, hint: 'xoxb-... 格式的 Bot Token' },
    { key: 'appToken', label: 'App Token', type: 'password', required: true, hint: 'xapp-... 格式（Socket Mode 需要）' },
    { key: 'mode', label: '连接模式', type: 'select', options: [
      { value: 'socket', label: 'socket — Socket Mode（推荐）' },
      { value: 'http', label: 'http — HTTP Webhook' },
    ] },
    { key: 'signingSecret', label: 'Signing Secret', type: 'password', hint: 'HTTP 模式下需要' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 Slack 用户 ID' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'streaming', label: '流式输出', type: 'select', options: STREAMING_OPTIONS },
  ],
  whatsapp: [
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的号码', type: 'text', hint: '逗号分隔的 E.164 格式号码，如 +8613800138000' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'groupAllowFrom', label: '允许的群组', type: 'text', hint: '逗号分隔的群组 ID' },
    { key: 'selfChatMode', label: '自聊模式', type: 'boolean', hint: '使用同一手机号对话' },
    { key: 'debounceMs', label: '消息防抖 (ms)', type: 'number', hint: '合并快速连续消息的等待毫秒数' },
  ],
  signal: [
    { key: 'account', label: '账号号码', type: 'text', required: true, hint: 'E.164 格式号码，如 +8613800138000' },
    { key: 'httpUrl', label: 'signal-cli HTTP 地址', type: 'text', hint: '如 http://localhost:8080，signal-cli daemon 地址' },
    { key: 'autoStart', label: '自动启动 daemon', type: 'boolean' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的号码', type: 'text', hint: '逗号分隔的 E.164 格式号码' },
  ],
  imessage: [
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'cliPath', label: 'imsg 路径', type: 'text', hint: 'imsg 二进制文件路径' },
    { key: 'dbPath', label: '数据库路径', type: 'text', hint: 'Messages.app 数据库路径（可选覆盖）' },
    { key: 'service', label: '服务类型', type: 'select', options: [
      { value: 'auto', label: 'auto — 自动选择' },
      { value: 'imessage', label: 'iMessage' },
      { value: 'sms', label: 'SMS' },
    ] },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的联系人', type: 'text', hint: '逗号分隔的 handle 或 chat_id' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'includeAttachments', label: '包含附件', type: 'boolean' },
  ],
  web: [
    { key: 'enabled', label: '启用', type: 'boolean' },
  ],
  googlechat: [
    { key: 'serviceAccountFile', label: '服务账号文件', type: 'text', required: true, hint: 'Service Account JSON 文件路径' },
    { key: 'audienceType', label: 'Audience 类型', type: 'select', options: [
      { value: 'app-url', label: 'app-url — 应用 URL' },
      { value: 'project-number', label: 'project-number — 项目编号' },
    ] },
    { key: 'audience', label: 'Audience', type: 'text', hint: '应用 URL 或 GCP 项目编号' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的用户 ID 或邮箱' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
  ],
  msteams: [
    { key: 'appId', label: 'Azure Bot App ID', type: 'text', required: true, hint: 'Azure Bot Registration 的 App ID' },
    { key: 'appPassword', label: 'App Password', type: 'password', required: true, hint: 'Azure Bot 的 App Password / Client Secret' },
    { key: 'tenantId', label: 'Tenant ID', type: 'text', hint: 'Azure AD Tenant ID（可选，限定租户）' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 AAD Object ID 或 UPN' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'requireMention', label: '群聊需要 @', type: 'boolean', hint: '群聊中是否需要 @ 提及才回复' },
  ],
  feishu: [
    { key: 'appId', label: 'App ID', type: 'text', required: true, hint: '飞书开放平台 App ID' },
    { key: 'appSecret', label: 'App Secret', type: 'password', required: true, hint: '飞书开放平台 App Secret' },
    { key: 'verificationToken', label: 'Verification Token', type: 'password', hint: '事件订阅验证 Token' },
    { key: 'encryptKey', label: 'Encrypt Key', type: 'password', hint: '消息加密密钥（可选）' },
    { key: 'domain', label: '域名', type: 'select', options: [
      { value: 'feishu', label: 'feishu — 飞书（国内）' },
      { value: 'lark', label: 'lark — Lark（海外）' },
    ] },
    { key: 'connectionMode', label: '连接方式', type: 'select', options: [
      { value: 'websocket', label: 'WebSocket（推荐）' },
      { value: 'webhook', label: 'Webhook' },
    ] },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的用户 ID' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
  ],
  matrix: [
    { key: 'homeserver', label: 'Homeserver URL', type: 'text', required: true, hint: '如 https://matrix.org' },
    { key: 'userId', label: '用户 ID', type: 'text', required: true, hint: '如 @bot:matrix.org' },
    { key: 'accessToken', label: 'Access Token', type: 'password', hint: '直接提供 Access Token（与密码二选一）' },
    { key: 'password', label: '密码', type: 'password', hint: '用于自动获取 Token（与 Access Token 二选一）' },
    { key: 'encryption', label: '端到端加密 (E2EE)', type: 'boolean' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'autoJoin', label: '自动加入', type: 'select', options: [
      { value: 'off', label: 'off — 不自动加入' },
      { value: 'allowlist', label: 'allowlist — 仅白名单房间' },
      { value: 'always', label: 'always — 自动加入所有邀请' },
    ] },
  ],
  mattermost: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, hint: 'Mattermost Bot Token' },
    { key: 'baseUrl', label: '服务器地址', type: 'text', required: true, hint: '如 https://mattermost.example.com' },
    { key: 'chatmode', label: '触发模式', type: 'select', options: [
      { value: 'oncall', label: 'oncall — @提及触发' },
      { value: 'onmessage', label: 'onmessage — 任何消息触发' },
      { value: 'onchar', label: 'onchar — 特定前缀触发' },
    ] },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的用户 ID 或 @username' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'requireMention', label: '需要 @提及', type: 'boolean' },
  ],
  irc: [
    { key: 'host', label: '服务器地址', type: 'text', required: true, hint: 'IRC 服务器主机名' },
    { key: 'port', label: '端口', type: 'number', hint: 'TLS 默认 6697，非 TLS 默认 6667' },
    { key: 'tls', label: '使用 TLS', type: 'boolean' },
    { key: 'nick', label: '昵称', type: 'text', required: true, hint: 'Bot 的 IRC 昵称' },
    { key: 'username', label: '用户名', type: 'text', hint: 'IRC USER 字段用户名' },
    { key: 'password', label: '服务器密码', type: 'password' },
    { key: 'channels', label: '频道', type: 'text', hint: '逗号分隔的频道名，如 #general,#bot' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 IRC 昵称' },
  ],
  nostr: [
    { key: 'privateKey', label: '私钥', type: 'password', required: true, hint: 'Nostr 私钥（hex 格式）' },
    { key: 'relays', label: 'Relay 地址', type: 'text', required: true, hint: '逗号分隔的 Relay URL，如 wss://relay.damus.io' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的公钥或 npub' },
  ],
  bluebubbles: [
    { key: 'serverUrl', label: '服务器 URL', type: 'text', required: true, hint: 'BlueBubbles API 地址' },
    { key: 'password', label: 'API 密码', type: 'password', required: true, hint: 'BlueBubbles API 密码' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的标识符' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
  ],
  twitch: [
    { key: 'username', label: '用户名', type: 'text', required: true, hint: 'Twitch 用户名' },
    { key: 'accessToken', label: 'Access Token', type: 'password', required: true, hint: 'OAuth Access Token' },
    { key: 'clientId', label: 'Client ID', type: 'text', required: true, hint: 'Twitch App Client ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', hint: 'Token 刷新需要' },
    { key: 'refreshToken', label: 'Refresh Token', type: 'password', hint: 'Token 自动刷新' },
    { key: 'channel', label: '频道名', type: 'text', required: true, hint: '要加入的 Twitch 频道名' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'requireMention', label: '需要 @提及', type: 'boolean' },
  ],
  'nextcloud-talk': [
    { key: 'baseUrl', label: 'Nextcloud URL', type: 'text', required: true, hint: '如 https://cloud.example.com' },
    { key: 'botSecret', label: 'Bot Secret', type: 'password', required: true, hint: 'Bot Shared Secret' },
    { key: 'apiUser', label: 'API 用户', type: 'text', hint: '用于 Room 查询的用户名' },
    { key: 'apiPassword', label: 'API 密码', type: 'password', hint: 'API 用户的密码' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
  ],
  'synology-chat': [
    { key: 'token', label: 'Bot Token', type: 'password', required: true },
    { key: 'incomingUrl', label: 'Incoming Webhook URL', type: 'text', required: true, hint: 'Synology Chat 的 Incoming Webhook URL' },
    { key: 'nasHost', label: 'NAS 主机名', type: 'text', required: true, hint: 'NAS 地址' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: [
      { value: 'open', label: 'open — 所有人可用' },
      { value: 'allowlist', label: 'allowlist — 仅白名单' },
      { value: 'disabled', label: 'disabled — 禁用' },
    ] },
    { key: 'botName', label: 'Bot 显示名', type: 'text' },
  ],
  zalo: [
    { key: 'botToken', label: 'Bot Token', type: 'password', required: true, hint: 'Zalo OA Bot Token' },
    { key: 'webhookUrl', label: 'Webhook URL', type: 'text', hint: '需要 HTTPS' },
    { key: 'webhookSecret', label: 'Webhook Secret', type: 'password' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的 Zalo 用户 ID' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
  ],
  qqbot: [
    { key: 'appId', label: 'App ID', type: 'text', required: true, hint: 'QQ 开放平台的机器人 App ID' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true, hint: 'QQ 开放平台的机器人密钥' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的用户 ID，* 表示所有人' },
  ],
  wecom: [
    { key: 'botId', label: 'Bot ID', type: 'text', required: true, hint: '企业微信 AI Bot 的 Bot ID' },
    { key: 'secret', label: 'Bot Secret', type: 'password', required: true, hint: '企业微信 AI Bot 的 Secret' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'websocketUrl', label: 'WebSocket 地址', type: 'text', hint: '默认 wss://openws.work.weixin.qq.com' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS, hint: '控制谁可以私聊 Bot' },
    { key: 'allowFrom', label: '允许的用户', type: 'text', hint: '逗号分隔的企业微信用户 ID' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'groupAllowFrom', label: '允许的群组', type: 'text', hint: '逗号分隔的群组 ID' },
    { key: 'sendThinkingMessage', label: '发送思考中提示', type: 'boolean', hint: '回复前显示"正在思考"占位消息' },
  ],
  dingtalk: [
    { key: 'clientId', label: 'Client ID', type: 'text', required: true, hint: '钉钉开放平台应用的 Client ID（AppKey）' },
    { key: 'clientSecret', label: 'Client Secret', type: 'password', required: true, hint: '钉钉开放平台应用的 Client Secret（AppSecret）' },
    { key: 'robotCode', label: 'Robot Code', type: 'text', required: true, hint: '钉钉机器人的 robotCode' },
    { key: 'corpId', label: 'Corp ID', type: 'text', hint: '企业的 corpId' },
    { key: 'agentId', label: 'Agent ID', type: 'text', hint: '钉钉应用的 agentId' },
    { key: 'enabled', label: '启用', type: 'boolean' },
    { key: 'dmPolicy', label: '私聊策略', type: 'select', options: DM_POLICY_OPTIONS, hint: '控制谁可以私聊机器人' },
    { key: 'groupPolicy', label: '群聊策略', type: 'select', options: GROUP_POLICY_OPTIONS },
    { key: 'messageType', label: '消息类型', type: 'select', options: [
      { value: 'text', label: 'text — 纯文本' },
      { value: 'markdown', label: 'markdown — Markdown 格式' },
    ], hint: '机器人回复的消息格式' },
    { key: 'debug', label: '调试模式', type: 'boolean', hint: '开启后输出详细日志' },
  ],
}

export default function Channels() {
  const [status, setStatus] = useState<ChannelsStatusResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)

  // Config modal state
  const [configChannel, setConfigChannel] = useState<string | null>(null)
  const [configData, setConfigData] = useState<Record<string, unknown>>({})
  const [configLoading, setConfigLoading] = useState(false)
  const [configSaving, setConfigSaving] = useState(false)

  // Expanded account details
  const [expandedChannel, setExpandedChannel] = useState<string | null>(null)

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Channels configured in openclaw.json (may not have gateway accounts yet)
  const [configuredTypes, setConfiguredTypes] = useState<string[]>([])

  // Show restart hint after saving channel config
  const [showRestartHint, setShowRestartHint] = useState(false)
  const navigate = useNavigate()

  const fetchStatus = useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true)
    setError('')
    try {
      const [statusResult, configuredResult] = await Promise.all([
        getChannelsStatus(true),
        getConfiguredChannels(),
      ])
      setStatus(statusResult)
      if (configuredResult.success && configuredResult.channels) {
        setConfiguredTypes(configuredResult.channels)
      }
    } catch (err: any) {
      setError(err?.message || '获取渠道状态失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus(true)
  }, [fetchStatus])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchStatus()
  }

  const openConfig = async (channelType: string) => {
    setConfigChannel(channelType)
    setConfigLoading(true)
    try {
      const result = await getChannelConfig(channelType)
      setConfigData(result.config || {})
    } catch {
      setConfigData({})
    } finally {
      setConfigLoading(false)
    }
  }

  const handleSaveConfig = async (dataOverride?: Record<string, unknown>) => {
    if (!configChannel) return
    setConfigSaving(true)
    try {
      await saveChannelConfig(configChannel, dataOverride ?? configData)
      setConfigChannel(null)
      setShowRestartHint(true)
      // Refresh status after config change
      await fetchStatus()
    } catch (err: any) {
      setError(err?.message || '保存配置失败')
    } finally {
      setConfigSaving(false)
    }
  }

  const handleDeleteChannel = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteChannelConfig(deleteTarget)
      setConfiguredTypes((prev) => prev.filter((t) => t !== deleteTarget))
      setDeleteTarget(null)
      await fetchStatus()
    } catch (err: any) {
      setError(err?.message || '删除渠道失败')
    } finally {
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={28} className="animate-spin text-accent-blue" />
      </div>
    )
  }

  // Build channel list from status data + config + static catalog
  const channelAccounts = status?.channelAccounts || {}
  const channelLabels = status?.channelLabels || {}

  // Channels with gateway accounts (actively running/configured in gateway)
  const gatewayChannels = (status?.channelOrder || []).filter(
    (ch) => channelAccounts[ch] && channelAccounts[ch].length > 0,
  )

  // Merge: channels from gateway + channels configured in openclaw.json
  const allConfiguredIds = new Set([...gatewayChannels, ...configuredTypes])
  const configuredChannels = Array.from(allConfiguredIds)

  // Available = static catalog entries not yet configured
  const availableChannels = CHANNEL_CATALOG.filter(
    (ch) => !allConfiguredIds.has(ch.id),
  )

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-dark-text">渠道管理</h1>
          <p className="mt-1 text-sm text-dark-text-secondary">
            管理 AI Agent 的消息接入渠道
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 rounded-lg border border-dark-border px-3 py-1.5 text-xs text-dark-text-secondary hover:text-dark-text transition-colors"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-accent-red/10 p-3 text-sm text-accent-red flex items-center gap-2">
          <AlertCircle size={16} />
          {error}
        </div>
      )}

      {showRestartHint && (
        <div className="mb-4 rounded-lg bg-accent-green/10 p-3 text-sm text-accent-green flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle size={16} />
            <span>渠道配置已保存，需要重启网关才能生效</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/settings')}
              className="rounded-lg bg-accent-green px-3 py-1 text-xs font-medium text-white hover:bg-accent-green/90 transition-colors"
            >
              前往系统设置重启网关
            </button>
            <button
              onClick={() => setShowRestartHint(false)}
              className="text-accent-green/60 hover:text-accent-green transition-colors"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* Configured channels */}
      {configuredChannels.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-3">
            已接入渠道
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {configuredChannels.map((channelId) => {
              const accounts = channelAccounts[channelId] || []
              const catalogEntry = CHANNEL_CATALOG.find((c) => c.id === channelId)
              const label = channelLabels[channelId] || catalogEntry?.label || channelId
              const icon = CHANNEL_ICONS[channelId] || catalogEntry?.icon || '💬'
              const isExpanded = expandedChannel === channelId

              return (
                <div
                  key={channelId}
                  className="rounded-xl border border-dark-border bg-dark-card overflow-hidden"
                >
                  {/* Channel header */}
                  <div className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-bg text-xl">
                        {icon}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-dark-text">{label}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {accounts.length > 0 ? (
                            accounts.map((acc) => (
                              <AccountStatusBadge key={acc.accountId} account={acc} />
                            ))
                          ) : (
                            <span className="flex items-center gap-1 text-xs text-dark-text-secondary">
                              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-400" />
                              已配置（需重启网关生效）
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openConfig(channelId)}
                        className="rounded-lg p-1.5 text-dark-text-secondary hover:text-dark-text hover:bg-dark-bg transition-colors"
                        title="配置"
                      >
                        <Settings size={15} />
                      </button>
                      <button
                        onClick={() => setExpandedChannel(isExpanded ? null : channelId)}
                        className="rounded-lg p-1.5 text-dark-text-secondary hover:text-dark-text hover:bg-dark-bg transition-colors"
                        title="详情"
                      >
                        {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                      </button>
                      <button
                        onClick={() => setDeleteTarget(channelId)}
                        className="rounded-lg p-1.5 text-dark-text-secondary hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  {/* Expanded account details */}
                  {isExpanded && (
                    <div className="border-t border-dark-border bg-dark-bg/30 px-4 py-3">
                      {accounts.map((acc) => (
                        <AccountDetail key={acc.accountId} account={acc} />
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Available channels (not yet configured) */}
      {availableChannels.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-dark-text-secondary uppercase tracking-wider mb-3">
            可用渠道
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {availableChannels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => openConfig(ch.id)}
                className="flex items-center gap-3 rounded-xl border border-dark-border bg-dark-card p-4 text-left hover:bg-dark-bg/50 transition-colors group"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-dark-bg text-xl opacity-50 group-hover:opacity-80 transition-opacity">
                  {ch.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-dark-text">{ch.label}</div>
                  <div className="text-xs text-dark-text-secondary mt-0.5 truncate">
                    {ch.description}
                  </div>
                </div>
                <Plus size={16} className="text-dark-text-secondary opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* No channels at all (shouldn't happen with static catalog, but just in case) */}
      {configuredChannels.length === 0 && availableChannels.length === 0 && !error && (
        <div className="text-center py-20 text-dark-text-secondary text-sm">
          加载中...
        </div>
      )}

      {/* Config modal */}
      {configChannel && (
        <ChannelConfigModal
          channelType={configChannel}
          channelLabel={channelLabels[configChannel] || CHANNEL_CATALOG.find((c) => c.id === configChannel)?.label || configChannel}
          configData={configData}
          loading={configLoading}
          saving={configSaving}
          onConfigChange={setConfigData}
          onSave={handleSaveConfig}
          onClose={() => setConfigChannel(null)}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="rounded-xl bg-dark-card border border-dark-border p-6 max-w-sm w-full mx-4 shadow-xl">
            <h3 className="text-base font-semibold text-dark-text mb-2">确认删除</h3>
            <p className="text-sm text-dark-text-secondary mb-4">
              确定要删除渠道 <span className="font-medium text-dark-text">{channelLabels[deleteTarget] || CHANNEL_CATALOG.find((c) => c.id === deleteTarget)?.label || deleteTarget}</span> 的配置？此操作不可撤销。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-dark-border px-4 py-1.5 text-sm text-dark-text-secondary hover:text-dark-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleDeleteChannel}
                disabled={deleting}
                className="rounded-lg bg-accent-red px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-red/90 transition-colors disabled:opacity-50"
              >
                {deleting ? <Loader2 size={14} className="animate-spin" /> : '删除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// --- Sub components ---

function AccountStatusBadge({ account }: { account: ChannelAccountSnapshot }) {
  const hasRecentTraffic = Boolean(account.lastInboundAt || account.lastOutboundAt)
  const probeOk =
    typeof account.probe === 'object' &&
    account.probe !== null &&
    'ok' in account.probe &&
    (account.probe as { ok?: unknown }).ok === true
  const isConnected = account.connected === true || hasRecentTraffic || probeOk
  const isRunning = account.running
  const hasError = !!account.lastError

  let color = 'bg-gray-500'
  let label = '未知'

  if (hasError) {
    color = 'bg-accent-red'
    label = '错误'
  } else if (isConnected) {
    color = 'bg-accent-green'
    label = '已连接'
  } else if (isRunning) {
    color = 'bg-accent-yellow animate-pulse'
    label = '连接中'
  } else if (account.configured) {
    color = 'bg-gray-400'
    label = '已配置'
  } else {
    label = '未配置'
  }

  return (
    <span className="flex items-center gap-1 text-xs text-dark-text-secondary">
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />
      {account.name || account.accountId}: {label}
    </span>
  )
}

function AccountDetail({ account }: { account: ChannelAccountSnapshot }) {
  const fields: Array<[string, unknown]> = []

  if (account.name) fields.push(['名称', account.name])
  fields.push(['账户 ID', account.accountId])
  if (account.mode) fields.push(['模式', account.mode])
  if (account.enabled !== undefined && account.enabled !== null) fields.push(['启用', account.enabled ? '是' : '否'])
  if (account.configured !== undefined && account.configured !== null) fields.push(['已配置', account.configured ? '是' : '否'])
  if (account.connected !== undefined && account.connected !== null) fields.push(['已连接', account.connected ? '是' : '否'])
  if (account.running !== undefined && account.running !== null) fields.push(['运行中', account.running ? '是' : '否'])
  if (account.webhookUrl) fields.push(['Webhook', account.webhookUrl])
  if (account.lastConnectedAt) fields.push(['上次连接', new Date(account.lastConnectedAt).toLocaleString()])
  if (account.lastError) fields.push(['错误', account.lastError])
  if (account.reconnectAttempts) fields.push(['重连次数', account.reconnectAttempts])

  return (
    <div className="mb-3 last:mb-0">
      <div className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-xs">
        {fields.map(([label, value]) => (
          <div key={label as string} className="contents">
            <span className="text-dark-text-secondary font-medium">{label as string}</span>
            <span className={`text-dark-text truncate ${label === '错误' ? 'text-accent-red' : ''}`}>
              {String(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

interface ChannelConfigModalProps {
  channelType: string
  channelLabel: string
  configData: Record<string, unknown>
  loading: boolean
  saving: boolean
  onConfigChange: (data: Record<string, unknown>) => void
  onSave: (dataOverride?: Record<string, unknown>) => void
  onClose: () => void
}

// Fields that store arrays (comma-separated in UI → array in JSON)
const ARRAY_FIELDS = new Set([
  'allowFrom', 'groupAllowFrom', 'channels', 'relays',
  'autoJoinAllowlist', 'allowedUserIds',
])

function ChannelConfigModal({
  channelType,
  channelLabel,
  configData,
  loading,
  saving,
  onConfigChange,
  onSave,
  onClose,
}: ChannelConfigModalProps) {
  const knownFields = CHANNEL_CONFIG_FIELDS[channelType]

  const updateField = (key: string, value: unknown) => {
    onConfigChange({ ...configData, [key]: value })
  }

  // For channels without predefined fields, allow raw JSON editing
  const [rawMode, setRawMode] = useState(!knownFields)
  const [rawJson, setRawJson] = useState(JSON.stringify(configData, null, 2))

  useEffect(() => {
    if (!knownFields) {
      setRawJson(JSON.stringify(configData, null, 2))
    }
  }, [configData, knownFields])

  const handleRawSave = () => {
    try {
      const parsed = JSON.parse(rawJson)
      onConfigChange(parsed)
      onSave(parsed)
    } catch {
      alert('JSON 格式错误')
    }
  }

  const getDisplayValue = (field: ChannelField): string => {
    const val = configData[field.key]
    if (val === undefined || val === null) return ''
    if (Array.isArray(val)) return val.join(', ')
    return String(val)
  }

  const handleTextChange = (field: ChannelField, raw: string) => {
    if (ARRAY_FIELDS.has(field.key)) {
      if (raw === '') {
        updateField(field.key, [])
      } else {
        updateField(field.key, raw.split(',').map((s) => s.trim()).filter(Boolean))
      }
    } else if (field.type === 'number') {
      const num = parseInt(raw, 10)
      updateField(field.key, isNaN(num) ? undefined : num)
    } else {
      updateField(field.key, raw)
    }
  }

  const renderField = (field: ChannelField) => {
    switch (field.type) {
      case 'boolean':
        return (
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={configData[field.key] !== false && configData[field.key] !== undefined}
              onChange={(e) => updateField(field.key, e.target.checked)}
              className="rounded border-dark-border"
            />
            <span className="text-sm text-dark-text">
              {configData[field.key] !== false && configData[field.key] !== undefined ? '启用' : '禁用'}
            </span>
          </label>
        )

      case 'select':
        return (
          <select
            value={(configData[field.key] as string) || ''}
            onChange={(e) => updateField(field.key, e.target.value || undefined)}
            className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue"
          >
            <option value="">（未设置）</option>
            {field.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )

      case 'textarea':
        return (
          <textarea
            value={getDisplayValue(field)}
            onChange={(e) => handleTextChange(field, e.target.value)}
            rows={4}
            placeholder={field.hint}
            className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text font-mono outline-none focus:border-accent-blue placeholder:text-dark-text-secondary resize-none"
          />
        )

      default:
        return (
          <input
            type={field.type === 'password' ? 'password' : 'text'}
            value={getDisplayValue(field)}
            onChange={(e) => handleTextChange(field, e.target.value)}
            placeholder={field.hint}
            className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text outline-none focus:border-accent-blue placeholder:text-dark-text-secondary"
          />
        )
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="rounded-xl bg-dark-card border border-dark-border max-w-lg w-full mx-4 shadow-xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-dark-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xl">{CHANNEL_ICONS[channelType] || '💬'}</span>
            <h3 className="text-base font-semibold text-dark-text">
              配置 {channelLabel}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-dark-text-secondary hover:text-dark-text transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-accent-blue" />
            </div>
          ) : rawMode ? (
            <div>
              <label className="block text-xs font-medium text-dark-text-secondary mb-1">
                JSON 配置
              </label>
              <textarea
                value={rawJson}
                onChange={(e) => setRawJson(e.target.value)}
                rows={16}
                className="w-full rounded-lg border border-dark-border bg-dark-bg px-3 py-2 text-sm text-dark-text font-mono outline-none focus:border-accent-blue placeholder:text-dark-text-secondary resize-none"
                placeholder="{}"
              />
              {knownFields && (
                <button
                  onClick={() => setRawMode(false)}
                  className="mt-2 text-xs text-accent-blue hover:underline"
                >
                  切换到表单模式
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {knownFields?.map((field) => (
                <div key={field.key}>
                  <label className="block text-xs font-medium text-dark-text-secondary mb-1">
                    {field.label}
                    {field.required && <span className="text-accent-red ml-0.5">*</span>}
                  </label>
                  {renderField(field)}
                  {field.hint && field.type !== 'boolean' && field.type !== 'select' && (
                    <p className="mt-0.5 text-[11px] text-dark-text-secondary">{field.hint}</p>
                  )}
                </div>
              ))}
              <button
                onClick={() => {
                  setRawJson(JSON.stringify(configData, null, 2))
                  setRawMode(true)
                }}
                className="text-xs text-accent-blue hover:underline"
              >
                切换到 JSON 模式（高级）
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-dark-border shrink-0">
          <button
            onClick={onClose}
            className="rounded-lg border border-dark-border px-4 py-1.5 text-sm text-dark-text-secondary hover:text-dark-text transition-colors"
          >
            取消
          </button>
          <button
            onClick={rawMode ? handleRawSave : () => onSave()}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-accent-blue px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-blue/90 transition-colors disabled:opacity-50"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Save size={14} />
            )}
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
