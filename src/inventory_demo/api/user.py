"""User identification from HTTP headers (Databricks Apps) or environment."""

from dataclasses import dataclass

from fastapi import Request

from inventory_demo.config import get_settings


@dataclass
class CurrentUser:
    """Current user information."""

    email: str | None
    name: str | None

    @property
    def display_name(self) -> str:
        """Get display name, falling back to email or 'Unknown'."""
        if self.name:
            return self.name
        if self.email:
            # Extract username from email
            return self.email.split("@")[0]
        return "Unknown"

    @property
    def is_authenticated(self) -> bool:
        """Check if user is authenticated (has email)."""
        return bool(self.email)


def get_current_user(request: Request) -> CurrentUser:
    """Extract current user from request headers or environment.

    In Databricks Apps, user info is provided via HTTP headers:
    - X-Forwarded-Email: user email from IdP
    - X-Forwarded-Preferred-Username: username from IdP
    - X-Forwarded-User: user identifier from IdP

    In development, falls back to USER_EMAIL and USER_NAME env vars.
    """
    # Try Databricks Apps headers first (prod)
    email = request.headers.get("X-Forwarded-Email")
    name = request.headers.get("X-Forwarded-Preferred-Username")

    # Fall back to environment variables (dev)
    if not email:
        settings = get_settings()
        email = settings.user.email or None
        name = name or settings.user.name or None

    return CurrentUser(email=email, name=name)
