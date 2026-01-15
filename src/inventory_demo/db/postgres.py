"""PostgreSQL database client for Inventory Demo."""

from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Generator
from uuid import UUID

import psycopg
import structlog

from inventory_demo.db.schemas import ReplenishmentSignal, ScanEvent

logger = structlog.get_logger()


class LakebaseConnectionFactory:
    """Factory for creating Lakebase connections with OAuth authentication."""

    def __init__(self):
        """Initialize connection factory.

        In Databricks Apps:
        - PGHOST and PGDATABASE are automatically set by the Lakebase resource
        - Service principal credentials are injected

        Locally:
        - Use settings from .env file
        - Use generate_database_credential() for OAuth tokens
        """
        # Check if we're in Databricks Apps by looking for PGHOST
        # (automatically set by Lakebase resource)
        pghost = os.getenv("PGHOST")

        if pghost:
            # Running in Databricks Apps
            from databricks.sdk import WorkspaceClient
            from databricks.sdk.core import Config

            self._config = Config()
            self._workspace_client = WorkspaceClient()

            self._postgres_username = self._config.client_id
            self._postgres_host = pghost
            self._postgres_database = os.getenv("PGDATABASE", "databricks_postgres")
            self._use_databricks_apps = True

            logger.info(
                "lakebase_factory_initialized",
                host=self._postgres_host,
                database=self._postgres_database,
                username=self._postgres_username,
                auth="databricks_apps_oauth",
            )
        else:
            # Local development - use settings from .env
            from inventory_demo.config import get_settings

            self._use_databricks_apps = False
            settings = get_settings()
            self._postgres_host = settings.lakebase.host
            self._postgres_database = settings.lakebase.database
            self._postgres_username = settings.lakebase.user
            self._local_settings = settings

            logger.info(
                "lakebase_factory_initialized",
                host=self._postgres_host,
                database=self._postgres_database,
                auth="local_oauth",
            )

    def get_connection(self) -> psycopg.Connection:
        """Get a new database connection with fresh OAuth token."""
        if self._use_databricks_apps:
            # Databricks Apps: use service principal OAuth token
            token = self._workspace_client.config.oauth_token().access_token

            return psycopg.connect(
                host=self._postgres_host,
                port=5432,
                dbname=self._postgres_database,
                user=self._postgres_username,
                password=token,
                sslmode="require",
            )
        else:
            # Local development: use generate_database_credential()
            from inventory_demo.config import _token_manager

            token = _token_manager.get_token(
                instance_name=self._local_settings.lakebase.instance_name,
                workspace_host=self._local_settings.databricks.host,
            )

            return psycopg.connect(
                host=self._postgres_host,
                port=5432,
                dbname=self._postgres_database,
                user=self._postgres_username,
                password=token,
                sslmode="require",
            )

    def get_connection_string(self) -> str:
        """Get SQLAlchemy connection string (for local dev only)."""
        if self._use_databricks_apps:
            raise RuntimeError(
                "Cannot use connection string with Databricks OAuth. "
                "Use get_connection() instead."
            )
        return self._local_settings.lakebase.connection_string


# Global connection factory
_factory: LakebaseConnectionFactory | None = None


def get_factory() -> LakebaseConnectionFactory:
    """Get the global connection factory."""
    global _factory
    if _factory is None:
        _factory = LakebaseConnectionFactory()
    return _factory


class PostgresDB:
    """PostgreSQL database client using psycopg with OAuth."""

    def __init__(self):
        """Initialize database client."""
        self._factory = get_factory()

    @contextmanager
    def session(self) -> Generator[psycopg.Connection, None, None]:
        """Get a database connection context manager."""
        conn = self._factory.get_connection()
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def health_check(self) -> bool:
        """Check database connectivity."""
        try:
            with self.session() as conn:
                with conn.cursor() as cur:
                    cur.execute("SELECT 1")
            return True
        except Exception as e:
            logger.error("database_health_check_failed", error=str(e))
            return False

    # Event operations

    def create_event(
        self,
        event_type: str,
        station_id: str,
        barcode_raw: str,
        item_id: str,
        qty: int,
        user_email: str | None = None,
    ) -> ScanEvent:
        """Create a new scan event."""
        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO scan_events
                        (event_type, station_id, barcode_raw, item_id, qty, user_email)
                    VALUES (%s, %s, %s, %s, %s, %s)
                    RETURNING event_id, event_ts, event_type, station_id,
                              barcode_raw, item_id, qty, user_email
                    """,
                    (event_type, station_id, barcode_raw, item_id, qty, user_email),
                )
                row = cur.fetchone()

        # Create ScanEvent object from row
        event = ScanEvent(
            event_type=row[2],
            station_id=row[3],
            barcode_raw=row[4],
            item_id=row[5],
            qty=row[6],
            user_email=row[7],
        )
        event.event_id = row[0]
        event.event_ts = row[1]
        return event

    def get_recent_events(self, limit: int = 20) -> list[ScanEvent]:
        """Get recent scan events ordered by timestamp desc."""
        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT event_id, event_ts, event_type, station_id,
                           barcode_raw, item_id, qty, user_email
                    FROM scan_events
                    ORDER BY event_ts DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()

        events = []
        for row in rows:
            event = ScanEvent(
                event_type=row[2],
                station_id=row[3],
                barcode_raw=row[4],
                item_id=row[5],
                qty=row[6],
                user_email=row[7],
            )
            event.event_id = row[0]
            event.event_ts = row[1]
            events.append(event)
        return events

    # Inventory operations

    def get_inventory_item(self, item_id: str) -> dict | None:
        """Get current inventory for a specific item."""
        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        item_id,
                        COALESCE(SUM(CASE WHEN event_type = 'INTAKE'
                                     THEN qty ELSE 0 END), 0) AS intake_total,
                        COALESCE(SUM(CASE WHEN event_type = 'CONSUME'
                                     THEN qty ELSE 0 END), 0) AS consume_total,
                        MAX(event_ts) AS last_activity_ts
                    FROM scan_events
                    WHERE item_id = %s
                    GROUP BY item_id
                    """,
                    (item_id,),
                )
                row = cur.fetchone()

        if row is None:
            return None

        intake = row[1] or 0
        consume = row[2] or 0
        return {
            "item_id": row[0],
            "intake_total": intake,
            "consume_total": consume,
            "on_hand_qty": intake - consume,
            "last_activity_ts": row[3],
        }

    def get_all_inventory(self, limit: int = 100) -> list[dict]:
        """Get current inventory for all items."""
        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT
                        item_id,
                        COALESCE(SUM(CASE WHEN event_type = 'INTAKE'
                                     THEN qty ELSE 0 END), 0) AS intake_total,
                        COALESCE(SUM(CASE WHEN event_type = 'CONSUME'
                                     THEN qty ELSE 0 END), 0) AS consume_total,
                        MAX(event_ts) AS last_activity_ts
                    FROM scan_events
                    GROUP BY item_id
                    ORDER BY item_id
                    LIMIT %s
                    """,
                    (limit,),
                )
                rows = cur.fetchall()

        results = []
        for row in rows:
            intake = row[1] or 0
            consume = row[2] or 0
            results.append({
                "item_id": row[0],
                "intake_total": intake,
                "consume_total": consume,
                "on_hand_qty": intake - consume,
                "last_activity_ts": row[3],
            })
        return results

    def get_on_hand_qty(self, item_id: str) -> int:
        """Get current on-hand quantity for an item."""
        inventory = self.get_inventory_item(item_id)
        if inventory is None:
            return 0
        return inventory["on_hand_qty"]

    # Replenishment signal operations

    def create_signal(
        self,
        item_id: str,
        current_qty: int,
        trigger_event_id: UUID,
        reorder_point: int = 10,
        reorder_qty: int = 24,
    ) -> ReplenishmentSignal | None:
        """Create a replenishment signal if one doesn't already exist (OPEN) for this item.

        This is an append-only table. Each signal creation inserts a new row.
        """
        # First check if there's already an OPEN signal for this item
        if self.has_open_signal(item_id):
            logger.debug("replenishment_signal_exists", item_id=item_id)
            return None

        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO replenishment_signals
                        (item_id, triggered_at_qty, trigger_event_id,
                         reorder_point, reorder_qty, status)
                    VALUES (%s, %s, %s, %s, %s, 'OPEN')
                    RETURNING id, signal_id, created_ts, item_id, triggered_at_qty,
                              reorder_point, reorder_qty, status
                    """,
                    (item_id, current_qty, str(trigger_event_id),
                     reorder_point, reorder_qty),
                )
                row = cur.fetchone()

        signal = ReplenishmentSignal(
            item_id=row[3],
            triggered_at_qty=row[4],
            reorder_point=row[5],
            reorder_qty=row[6],
            status=row[7],
            trigger_event_id=trigger_event_id,
        )
        signal.id = row[0]
        signal.signal_id = row[1]
        signal.created_ts = row[2]
        logger.info(
            "replenishment_signal_created",
            item_id=item_id,
            triggered_at_qty=current_qty
        )
        return signal

    def get_signals(
        self, status: str | None = None, limit: int = 50
    ) -> list[dict]:
        """Get replenishment signals with LIVE inventory, optionally filtered by status.

        This uses window functions to get the latest state of each signal (append-only pattern)
        and joins with live inventory calculations for accurate current_qty.

        Returns list of dicts with signal data + live current_qty.
        """
        with self.session() as conn:
            with conn.cursor() as cur:
                # Query uses:
                # 1. Window function to get latest row per signal_id
                # 2. Join with live inventory calculation for accurate current_qty
                query = """
                    WITH latest_signals AS (
                        SELECT *,
                               ROW_NUMBER() OVER (
                                   PARTITION BY signal_id
                                   ORDER BY created_ts DESC
                               ) as rn
                        FROM replenishment_signals
                    ),
                    live_inventory AS (
                        SELECT
                            item_id,
                            COALESCE(SUM(CASE WHEN event_type = 'INTAKE'
                                         THEN qty ELSE 0 END), 0) -
                            COALESCE(SUM(CASE WHEN event_type = 'CONSUME'
                                         THEN qty ELSE 0 END), 0) AS on_hand_qty
                        FROM scan_events
                        GROUP BY item_id
                    )
                    SELECT
                        s.signal_id, s.created_ts, s.item_id,
                        COALESCE(i.on_hand_qty, 0) AS current_qty,
                        s.triggered_at_qty,
                        s.reorder_point, s.reorder_qty, s.status
                    FROM latest_signals s
                    LEFT JOIN live_inventory i ON s.item_id = i.item_id
                    WHERE s.rn = 1
                """
                if status:
                    query += " AND s.status = %s ORDER BY s.created_ts DESC LIMIT %s"
                    cur.execute(query, (status, limit))
                else:
                    query += " ORDER BY s.created_ts DESC LIMIT %s"
                    cur.execute(query, (limit,))
                rows = cur.fetchall()

        signals = []
        for row in rows:
            signals.append({
                "signal_id": row[0],
                "created_ts": row[1],
                "item_id": row[2],
                "current_qty": row[3],  # LIVE inventory value
                "triggered_at_qty": row[4],  # Historical snapshot
                "reorder_point": row[5],
                "reorder_qty": row[6],
                "status": row[7],
            })
        return signals

    def update_signal_status(
        self, signal_id: UUID, new_status: str
    ) -> dict | None:
        """Update a signal's status by inserting a new row (append-only pattern).

        Returns dict with signal data including live current_qty.
        """
        with self.session() as conn:
            with conn.cursor() as cur:
                # First get the current signal data
                cur.execute(
                    """
                    WITH latest AS (
                        SELECT *,
                               ROW_NUMBER() OVER (
                                   PARTITION BY signal_id ORDER BY created_ts DESC
                               ) as rn
                        FROM replenishment_signals
                        WHERE signal_id = %s
                    )
                    SELECT signal_id, item_id, triggered_at_qty, reorder_point,
                           reorder_qty, trigger_event_id
                    FROM latest WHERE rn = 1
                    """,
                    (str(signal_id),),
                )
                existing = cur.fetchone()

                if existing is None:
                    return None

                # Insert new row with updated status
                cur.execute(
                    """
                    INSERT INTO replenishment_signals
                        (signal_id, item_id, triggered_at_qty, reorder_point,
                         reorder_qty, trigger_event_id, status)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, signal_id, created_ts, item_id, triggered_at_qty,
                              reorder_point, reorder_qty, status
                    """,
                    (str(existing[0]), existing[1], existing[2], existing[3],
                     existing[4], str(existing[5]), new_status),
                )
                row = cur.fetchone()

                # Get live inventory for this item
                cur.execute(
                    """
                    SELECT
                        COALESCE(SUM(CASE WHEN event_type = 'INTAKE' THEN qty ELSE 0 END), 0) -
                        COALESCE(SUM(CASE WHEN event_type = 'CONSUME' THEN qty ELSE 0 END), 0)
                    FROM scan_events WHERE item_id = %s
                    """,
                    (existing[1],),
                )
                inv_row = cur.fetchone()
                live_qty = inv_row[0] if inv_row else 0

        return {
            "signal_id": row[1],
            "created_ts": row[2],
            "item_id": row[3],
            "current_qty": live_qty,
            "triggered_at_qty": row[4],
            "reorder_point": row[5],
            "reorder_qty": row[6],
            "status": row[7],
        }

    def has_open_signal(self, item_id: str) -> bool:
        """Check if an OPEN signal currently exists for the item.

        Uses window function to check the latest state of each signal.
        """
        with self.session() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    WITH latest AS (
                        SELECT signal_id, status,
                               ROW_NUMBER() OVER (
                                   PARTITION BY signal_id ORDER BY created_ts DESC
                               ) as rn
                        FROM replenishment_signals
                        WHERE item_id = %s
                    )
                    SELECT 1 FROM latest
                    WHERE rn = 1 AND status = 'OPEN'
                    LIMIT 1
                    """,
                    (item_id,),
                )
                return cur.fetchone() is not None

    def fulfill_open_signals(
        self, item_id: str, fulfill_event_id: UUID
    ) -> list[dict]:
        """Fulfill all OPEN signals for an item by inserting FULFILLED rows.

        This is append-only: instead of UPDATE, we INSERT new rows with status='FULFILLED'.

        Args:
            item_id: The item whose signals to fulfill
            fulfill_event_id: The intake event that fulfilled the signals

        Returns:
            List of fulfilled signal dicts
        """
        with self.session() as conn:
            with conn.cursor() as cur:
                # Find all currently OPEN signals for this item
                cur.execute(
                    """
                    WITH latest AS (
                        SELECT *,
                               ROW_NUMBER() OVER (
                                   PARTITION BY signal_id ORDER BY created_ts DESC
                               ) as rn
                        FROM replenishment_signals
                        WHERE item_id = %s
                    )
                    SELECT signal_id, item_id, triggered_at_qty, reorder_point,
                           reorder_qty
                    FROM latest
                    WHERE rn = 1 AND status = 'OPEN'
                    """,
                    (item_id,),
                )
                open_signals = cur.fetchall()

                if not open_signals:
                    return []

                # Insert FULFILLED rows for each open signal
                fulfilled = []
                for sig in open_signals:
                    cur.execute(
                        """
                        INSERT INTO replenishment_signals
                            (signal_id, item_id, triggered_at_qty, reorder_point,
                             reorder_qty, trigger_event_id, status)
                        VALUES (%s, %s, %s, %s, %s, %s, 'FULFILLED')
                        RETURNING id, signal_id, created_ts, item_id, triggered_at_qty,
                                  reorder_point, reorder_qty, status
                        """,
                        (str(sig[0]), sig[1], sig[2], sig[3], sig[4],
                         str(fulfill_event_id)),
                    )
                    row = cur.fetchone()
                    fulfilled.append({
                        "signal_id": row[1],
                        "created_ts": row[2],
                        "item_id": row[3],
                        "triggered_at_qty": row[4],
                        "reorder_point": row[5],
                        "reorder_qty": row[6],
                        "status": row[7],
                    })

        if fulfilled:
            logger.info(
                "replenishment_signals_fulfilled",
                item_id=item_id,
                count=len(fulfilled),
                fulfill_event_id=str(fulfill_event_id),
            )

        return fulfilled


# Global database instance
_db: PostgresDB | None = None


def get_db() -> PostgresDB:
    """Get the global database instance."""
    global _db
    if _db is None:
        _db = PostgresDB()
    return _db
