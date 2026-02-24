from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # === Core ===
    database_url: str | None = None
    hmac_secret: str = "change-me-in-production"
    base_url: str = "http://localhost:8000"  # Public URL of this proxy

    # === Ozon Seller API ===
    ozon_client_id: str | None = None
    ozon_api_key: str | None = None

    # === Admin ERP ===
    admin_bootstrap_username: str = "admin"
    admin_bootstrap_password: str | None = None
    admin_token_ttl_hours: int = 24
    admin_cors_origins: str | None = None

    # === Logto (OIDC/OAuth2) — optional ===
    logto_endpoint: str | None = None
    logto_api_resource: str | None = None
    logto_spa_app_id: str | None = None  # SPA app for admin-ui login
    logto_mcp_client_id: str | None = None  # SPA app for MCP OAuth DCR

    @property
    def admin_cors_origins_list(self) -> list[str]:
        if not self.admin_cors_origins:
            return []
        return [origin.strip() for origin in self.admin_cors_origins.split(",") if origin.strip()]

    # === TMAPI (1688 API) — optional ===
    tmapi_api_token: str | None = None

    # === Anthropic (for AI features) — optional ===
    anthropic_api_key: str | None = None

    # === S3 Storage — optional ===
    s3_endpoint_url: str | None = None
    s3_bucket: str | None = None
    s3_access_key: str | None = None
    s3_secret_key: str | None = None


settings = Settings()
