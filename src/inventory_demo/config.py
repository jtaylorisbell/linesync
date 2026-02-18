"""Configuration management for Inventory Demo."""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache
from typing import ClassVar
from urllib.parse import quote_plus

import structlog
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = structlog.get_logger()


class OAuthTokenManager:
    """Manages OAuth tokens for Lakebase with automatic refresh."""

    _instance: ClassVar["OAuthTokenManager | None"] = None
    _token: str | None = None
    _expires_at: datetime | None = None
    _endpoint_name: str | None = None

    def __new__(cls) -> "OAuthTokenManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def get_token(
        self,
        endpoint_name: str,
        workspace_host: str | None = None,
        force_refresh: bool = False,
    ) -> str | None:
        """Get a valid OAuth token, refreshing if necessary.

        Args:
            endpoint_name: The Lakebase endpoint resource name
                (e.g. projects/linesync/branches/main/endpoints/default)
            workspace_host: The Databricks workspace host
            force_refresh: Force token refresh even if not expired

        Returns:
            OAuth token string, or None if generation fails
        """
        if not endpoint_name:
            logger.debug("no_endpoint_name_provided")
            return None

        # Check if we have a valid cached token (with 5 min buffer)
        if (
            not force_refresh
            and self._token
            and self._endpoint_name == endpoint_name
            and self._expires_at
            and datetime.now() < self._expires_at - timedelta(minutes=5)
        ):
            return self._token

        # Generate new token
        try:
            from databricks.sdk import WorkspaceClient

            logger.info("generating_oauth_token", endpoint=endpoint_name, workspace=workspace_host)
            w = WorkspaceClient(host=workspace_host) if workspace_host else WorkspaceClient()
            cred = w.postgres.generate_database_credential(endpoint=endpoint_name)

            self._token = cred.token
            self._endpoint_name = endpoint_name
            # Tokens expire after 1 hour, we'll refresh at 55 minutes
            self._expires_at = datetime.now() + timedelta(minutes=55)

            logger.info(
                "oauth_token_generated",
                endpoint=endpoint_name,
                expires_at=self._expires_at.isoformat(),
            )
            return self._token

        except ImportError:
            logger.warning("databricks_sdk_not_installed")
            return None
        except Exception as e:
            logger.error("oauth_token_generation_failed", error=str(e))
            return None


# Global token manager instance
_token_manager = OAuthTokenManager()


class DatabricksSettings(BaseSettings):
    """Databricks workspace connection settings."""

    model_config = SettingsConfigDict(
        env_prefix="DATABRICKS_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = ""

    @property
    def is_configured(self) -> bool:
        """Check if Databricks connection is configured."""
        return bool(self.host)


class LakebaseSettings(BaseSettings):
    """Lakebase (Postgres) database configuration."""

    model_config = SettingsConfigDict(
        env_prefix="LAKEBASE_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    host: str = "localhost"
    port: int = 5432
    database: str = "postgres"
    user: str = "lakebase"
    password: str = ""
    sslmode: str = "require"
    # Lakebase Autoscaling resource identifiers
    project_id: str = "linesync"
    branch_id: str = "main"
    endpoint_id: str = "default"

    @property
    def endpoint_name(self) -> str:
        """Full Lakebase endpoint resource name."""
        return f"projects/{self.project_id}/branches/{self.branch_id}/endpoints/{self.endpoint_id}"

    def get_password(self, workspace_host: str | None = None) -> str:
        """Get password, auto-generating OAuth token if needed.

        Args:
            workspace_host: Databricks workspace host for OAuth token generation.

        Returns:
            Password string (either static password or OAuth token)
        """
        # If password is explicitly set, use it
        if self.password:
            return self.password

        # Try to generate OAuth token using endpoint_name
        if self.project_id:
            if workspace_host is None:
                databricks = DatabricksSettings()
                workspace_host = databricks.host or None
            token = _token_manager.get_token(
                endpoint_name=self.endpoint_name,
                workspace_host=workspace_host,
            )
            if token:
                return token

        return self.password

    @property
    def connection_string(self) -> str:
        """Get SQLAlchemy connection string."""
        user_encoded = quote_plus(self.user)
        password_encoded = quote_plus(self.get_password())

        return (
            f"postgresql+psycopg2://{user_encoded}:{password_encoded}"
            f"@{self.host}:{self.port}/{self.database}"
            f"?sslmode={self.sslmode}"
        )


class InventorySettings(BaseSettings):
    """Inventory business logic settings."""

    model_config = SettingsConfigDict(
        env_prefix="INVENTORY_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    reorder_point: int = 10
    reorder_qty: int = 24
    debounce_seconds: int = 3


class UserSettings(BaseSettings):
    """User identification settings for dev/prod environments."""

    model_config = SettingsConfigDict(
        env_prefix="USER_",
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # For local development - set USER_EMAIL in .env
    email: str = ""
    name: str = ""


class Settings(BaseSettings):
    """Application settings."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    log_level: str = "INFO"

    @property
    def lakebase(self) -> LakebaseSettings:
        """Get Lakebase (Postgres) settings."""
        return LakebaseSettings()

    @property
    def databricks(self) -> DatabricksSettings:
        """Get Databricks settings."""
        return DatabricksSettings()

    @property
    def inventory(self) -> InventorySettings:
        """Get inventory business logic settings."""
        return InventorySettings()

    @property
    def user(self) -> UserSettings:
        """Get user identification settings."""
        return UserSettings()


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()


def refresh_oauth_token(
    endpoint_name: str | None = None, workspace_host: str | None = None
) -> str | None:
    """Force refresh the OAuth token.

    Args:
        endpoint_name: Lakebase endpoint resource name. If None, uses configured settings.
        workspace_host: Databricks workspace host. If None, uses DatabricksSettings.

    Returns:
        New OAuth token, or None if refresh fails
    """
    settings = get_settings()
    if endpoint_name is None:
        endpoint_name = settings.lakebase.endpoint_name
    if workspace_host is None:
        workspace_host = settings.databricks.host or None
    return _token_manager.get_token(
        endpoint_name=endpoint_name,
        workspace_host=workspace_host,
        force_refresh=True,
    )
