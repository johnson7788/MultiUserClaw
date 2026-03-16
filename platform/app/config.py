"""Platform gateway configuration."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Platform configuration loaded from environment variables."""

    # Database
    database_url: str = "postgresql+asyncpg://nanobot:nanobot@localhost:5432/nanobot_platform"

    # JWT
    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60 * 24  # 24 hours
    jwt_refresh_token_expire_days: int = 30

    # LLM Provider API Keys (platform-level, never exposed to containers)
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    deepseek_api_key: str = ""
    openrouter_api_key: str = ""
    dashscope_api_key: str = ""
    aihubmix_api_key: str = ""
    moonshot_api_key: str = ""
    kimi_api_key: str = ""
    zhipu_api_key: str = ""
    doubao_api_key: str = ""

    # Self-hosted vLLM / OpenAI-compatible local model
    hosted_vllm_api_key: str = ""
    hosted_vllm_api_base: str = ""  # e.g. "http://117.133.60.219:8900/v1"

    # Default model for new users
    default_model: str = "claude-sonnet-4-5"

    # Docker
    openclaw_image: str = "openclaw:latest"
    container_network: str = "openclaw-internal"
    user_container_publish_ports: bool = True
    user_container_bind_ip: str = "0.0.0.0"
    container_tz: str = "Asia/Shanghai"
    # 🟢 提升资源限制（适合浏览器/agent）
    container_memory_limit: str = "2g"  # 原来 512m
    container_cpu_limit: float = 4.0  # 原来 1.0
    container_pids_limit: int = 1024  # 原来 100

    # 建议增加 shm（非常重要，防止 Chromium 崩溃）
    container_shm_size: str = "1g"
    container_data_dir: str = "/data/openclaw-users"

    # Idle management
    container_idle_pause_minutes: int = 30
    container_idle_archive_days: int = 30

    # Quotas (tokens per day)
    quota_free: int = 20000000
    quota_basic: int = 1_000_000
    quota_pro: int = 10_000_000

    # Admin account (auto-created on first startup)
    admin_username: str = ""
    admin_password: str = ""

    # Platform gateway
    host: str = "0.0.0.0"
    port: int = 8080

    # Local dev: set to e.g. "http://127.0.0.1:18080" to skip Docker containers
    dev_openclaw_url: str = ""

    # Local dev: OpenClaw Gateway WS URL for direct WS proxy (e.g. "ws://127.0.0.1:18789")
    dev_gateway_url: str = ""

    model_config = {"env_prefix": "PLATFORM_"}


settings = Settings()
