"""PostgreSQL database client for Inventory Demo."""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime
from typing import Generator
from uuid import UUID

import structlog
from sqlalchemy import case, create_engine, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from inventory_demo.config import get_settings
from inventory_demo.db.schemas import Base, ReplenishmentSignal, ScanEvent

logger = structlog.get_logger()


class PostgresDB:
    """PostgreSQL database client using SQLAlchemy."""

    def __init__(self, connection_string: str | None = None):
        """Initialize database connection.

        Args:
            connection_string: SQLAlchemy connection string. If None, uses settings.
        """
        if connection_string is None:
            settings = get_settings()
            connection_string = settings.lakebase.connection_string

        self._engine = create_engine(
            connection_string,
            pool_pre_ping=True,
            pool_size=5,
            max_overflow=10,
        )
        self._session_factory = sessionmaker(bind=self._engine)

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        """Get a database session context manager."""
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def create_tables(self) -> None:
        """Create all tables if they don't exist."""
        Base.metadata.create_all(self._engine)
        logger.info("database_tables_created")

    def health_check(self) -> bool:
        """Check database connectivity."""
        try:
            with self.session() as session:
                session.execute(text("SELECT 1"))
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
        event = ScanEvent(
            event_type=event_type,
            station_id=station_id,
            barcode_raw=barcode_raw,
            item_id=item_id,
            qty=qty,
            user_email=user_email,
        )
        with self.session() as session:
            session.add(event)
            session.flush()
            # Refresh to get generated values
            session.refresh(event)
            # Detach from session before returning
            session.expunge(event)
        return event

    def get_recent_events(self, limit: int = 20) -> list[ScanEvent]:
        """Get recent scan events ordered by timestamp desc."""
        with self.session() as session:
            stmt = select(ScanEvent).order_by(ScanEvent.event_ts.desc()).limit(limit)
            events = list(session.scalars(stmt).all())
            # Detach from session
            for event in events:
                session.expunge(event)
            return events

    # Inventory operations

    def get_inventory_item(self, item_id: str) -> dict | None:
        """Get current inventory for a specific item."""
        with self.session() as session:
            stmt = select(
                ScanEvent.item_id,
                func.sum(
                    case((ScanEvent.event_type == "INTAKE", ScanEvent.qty), else_=0)
                ).label("intake_total"),
                func.sum(
                    case((ScanEvent.event_type == "CONSUME", ScanEvent.qty), else_=0)
                ).label("consume_total"),
                func.max(ScanEvent.event_ts).label("last_activity_ts"),
            ).where(ScanEvent.item_id == item_id).group_by(ScanEvent.item_id)

            result = session.execute(stmt).first()
            if result is None:
                return None

            intake = result.intake_total or 0
            consume = result.consume_total or 0
            return {
                "item_id": result.item_id,
                "intake_total": intake,
                "consume_total": consume,
                "on_hand_qty": intake - consume,
                "last_activity_ts": result.last_activity_ts,
            }

    def get_all_inventory(self, limit: int = 100) -> list[dict]:
        """Get current inventory for all items."""
        with self.session() as session:
            stmt = (
                select(
                    ScanEvent.item_id,
                    func.sum(
                        case((ScanEvent.event_type == "INTAKE", ScanEvent.qty), else_=0)
                    ).label("intake_total"),
                    func.sum(
                        case((ScanEvent.event_type == "CONSUME", ScanEvent.qty), else_=0)
                    ).label("consume_total"),
                    func.max(ScanEvent.event_ts).label("last_activity_ts"),
                )
                .group_by(ScanEvent.item_id)
                .order_by(ScanEvent.item_id)
                .limit(limit)
            )

            results = []
            for row in session.execute(stmt).all():
                intake = row.intake_total or 0
                consume = row.consume_total or 0
                results.append({
                    "item_id": row.item_id,
                    "intake_total": intake,
                    "consume_total": consume,
                    "on_hand_qty": intake - consume,
                    "last_activity_ts": row.last_activity_ts,
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
        """Create a replenishment signal if one doesn't already exist for this item.

        Returns None if an OPEN signal already exists for the item.
        """
        signal = ReplenishmentSignal(
            item_id=item_id,
            current_qty=current_qty,
            trigger_event_id=trigger_event_id,
            reorder_point=reorder_point,
            reorder_qty=reorder_qty,
            status="OPEN",
        )
        try:
            with self.session() as session:
                session.add(signal)
                session.flush()
                session.refresh(signal)
                session.expunge(signal)
            logger.info("replenishment_signal_created", item_id=item_id, current_qty=current_qty)
            return signal
        except IntegrityError:
            # Unique constraint violation - OPEN signal already exists
            logger.debug("replenishment_signal_exists", item_id=item_id)
            return None

    def get_signals(self, status: str | None = None, limit: int = 50) -> list[ReplenishmentSignal]:
        """Get replenishment signals, optionally filtered by status."""
        with self.session() as session:
            stmt = select(ReplenishmentSignal).order_by(ReplenishmentSignal.created_ts.desc())
            if status:
                stmt = stmt.where(ReplenishmentSignal.status == status)
            stmt = stmt.limit(limit)

            signals = list(session.scalars(stmt).all())
            for signal in signals:
                session.expunge(signal)
            return signals

    def update_signal_status(self, signal_id: UUID, status: str) -> ReplenishmentSignal | None:
        """Update a signal's status."""
        with self.session() as session:
            signal = session.get(ReplenishmentSignal, signal_id)
            if signal is None:
                return None
            signal.status = status
            session.flush()
            session.refresh(signal)
            session.expunge(signal)
            return signal

    def has_open_signal(self, item_id: str) -> bool:
        """Check if an OPEN signal exists for the item."""
        with self.session() as session:
            stmt = select(ReplenishmentSignal).where(
                ReplenishmentSignal.item_id == item_id,
                ReplenishmentSignal.status == "OPEN",
            )
            return session.scalar(stmt) is not None


# Global database instance
_db: PostgresDB | None = None


def get_db() -> PostgresDB:
    """Get the global database instance."""
    global _db
    if _db is None:
        _db = PostgresDB()
    return _db
