"""Lakebase Autoscaling infrastructure provisioner."""

from __future__ import annotations

from dataclasses import dataclass

import structlog
from databricks.sdk import WorkspaceClient
from databricks.sdk.errors import NotFound, AlreadyExists
from databricks.sdk.service.postgres import (
    Branch,
    BranchSpec,
    Endpoint,
    EndpointSpec,
    EndpointType,
    Project,
    ProjectSpec,
    Role,
    RoleAuthMethod,
    RoleIdentityType,
    RoleRoleSpec,
)

logger = structlog.get_logger()


@dataclass
class ProvisionResult:
    """Result of provisioning Lakebase infrastructure."""

    project_name: str
    branch_name: str
    endpoint_name: str
    host: str
    database: str


class LakebaseProvisioner:
    """Idempotent provisioner for Lakebase Autoscaling resources."""

    def __init__(self, w: WorkspaceClient | None = None):
        self._w = w or WorkspaceClient()

    def ensure_project(self, project_id: str) -> Project:
        """Get or create a Lakebase project."""
        name = f"projects/{project_id}"
        try:
            project = self._w.postgres.get_project(name=name)
            logger.info("project_exists", project=name)
            return project
        except NotFound:
            pass

        logger.info("creating_project", project=name)
        try:
            op = self._w.postgres.create_project(
                project=Project(
                    spec=ProjectSpec(pg_version=17),
                ),
                project_id=project_id,
            )
            project = op.wait()
            logger.info("project_created", project=project.name)
            return project
        except AlreadyExists:
            return self._w.postgres.get_project(name=name)

    def ensure_branch(self, project_id: str, branch_id: str) -> Branch:
        """Get or create a branch in the project."""
        parent = f"projects/{project_id}"
        name = f"{parent}/branches/{branch_id}"
        try:
            branch = self._w.postgres.get_branch(name=name)
            logger.info("branch_exists", branch=name)
            return branch
        except NotFound:
            pass

        logger.info("creating_branch", branch=name)
        try:
            op = self._w.postgres.create_branch(
                parent=parent,
                branch=Branch(
                    spec=BranchSpec(no_expiry=True),
                ),
                branch_id=branch_id,
            )
            branch = op.wait()
            logger.info("branch_created", branch=branch.name)
            return branch
        except AlreadyExists:
            return self._w.postgres.get_branch(name=name)

    def ensure_endpoint(
        self,
        project_id: str,
        branch_id: str,
        endpoint_id: str,
        *,
        min_cu: float = 0.5,
        max_cu: float = 2.0,
        suspend_timeout: str = "300s",
    ) -> Endpoint:
        """Get or create a read-write endpoint on the branch."""
        parent = f"projects/{project_id}/branches/{branch_id}"
        name = f"{parent}/endpoints/{endpoint_id}"
        try:
            endpoint = self._w.postgres.get_endpoint(name=name)
            logger.info("endpoint_exists", endpoint=name)
            return endpoint
        except NotFound:
            pass

        logger.info("creating_endpoint", endpoint=name)
        try:
            op = self._w.postgres.create_endpoint(
                parent=parent,
                endpoint=Endpoint(
                    spec=EndpointSpec(
                        endpoint_type=EndpointType.ENDPOINT_TYPE_READ_WRITE,
                        autoscaling_limit_min_cu=min_cu,
                        autoscaling_limit_max_cu=max_cu,
                        suspend_timeout_duration=suspend_timeout,
                    ),
                ),
                endpoint_id=endpoint_id,
            )
            endpoint = op.wait()
            logger.info("endpoint_created", endpoint=endpoint.name)
            return endpoint
        except AlreadyExists:
            return self._w.postgres.get_endpoint(name=name)

    def ensure_role(
        self,
        project_id: str,
        branch_id: str,
        postgres_role: str,
        identity_type: RoleIdentityType,
    ) -> Role:
        """Get or create a role on the branch with OAuth auth."""
        parent = f"projects/{project_id}/branches/{branch_id}"
        # Role IDs are derived from the postgres_role name
        role_id = postgres_role.replace("@", "-").replace(".", "-").lower()
        name = f"{parent}/roles/{role_id}"
        try:
            role = self._w.postgres.get_role(name=name)
            logger.info("role_exists", role=name)
            return role
        except NotFound:
            pass

        logger.info("creating_role", role=name, postgres_role=postgres_role)
        try:
            op = self._w.postgres.create_role(
                parent=parent,
                role=Role(
                    spec=RoleRoleSpec(
                        postgres_role=postgres_role,
                        identity_type=identity_type,
                        auth_method=RoleAuthMethod.LAKEBASE_OAUTH_V1,
                    ),
                ),
                role_id=role_id,
            )
            role = op.wait()
            logger.info("role_created", role=role.name)
            return role
        except AlreadyExists:
            return self._w.postgres.get_role(name=name)

    def provision_all(
        self,
        user_email: str,
        *,
        project_id: str = "linesync",
        branch_id: str = "main",
        endpoint_id: str = "default",
    ) -> ProvisionResult:
        """Provision all Lakebase infrastructure and return connection details."""
        self.ensure_project(project_id)
        self.ensure_branch(project_id, branch_id)
        endpoint = self.ensure_endpoint(project_id, branch_id, endpoint_id)
        self.ensure_role(project_id, branch_id, user_email, RoleIdentityType.USER)

        host = endpoint.status.host if endpoint.status else ""
        endpoint_name = f"projects/{project_id}/branches/{branch_id}/endpoints/{endpoint_id}"

        return ProvisionResult(
            project_name=f"projects/{project_id}",
            branch_name=f"projects/{project_id}/branches/{branch_id}",
            endpoint_name=endpoint_name,
            host=host,
            database="postgres",
        )
