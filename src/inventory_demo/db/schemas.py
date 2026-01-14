"""SQLAlchemy ORM models for Inventory Demo."""

from datetime import datetime, timezone
from uuid import UUID, uuid4


def _utc_now() -> datetime:
    """Get current UTC time."""
    return datetime.now(timezone.utc)

from sqlalchemy import CheckConstraint, ForeignKey, Index, Text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """SQLAlchemy declarative base."""

    pass


class ScanEvent(Base):
    """Scan event record for intake and consumption."""

    __tablename__ = "scan_events"

    event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    event_ts: Mapped[datetime] = mapped_column(default=_utc_now)
    event_type: Mapped[str] = mapped_column(Text, nullable=False)
    station_id: Mapped[str] = mapped_column(Text, nullable=False)
    barcode_raw: Mapped[str] = mapped_column(Text, nullable=False)
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    qty: Mapped[int] = mapped_column(nullable=False)
    user_email: Mapped[str | None] = mapped_column(Text, nullable=True)

    __table_args__ = (
        CheckConstraint("event_type IN ('INTAKE', 'CONSUME')", name="ck_event_type"),
        CheckConstraint("qty > 0", name="ck_qty_positive"),
        Index("idx_scan_events_item_id", "item_id", "event_ts"),
        Index("idx_scan_events_ts", "event_ts"),
    )


class ReplenishmentSignal(Base):
    """Replenishment signal triggered when inventory is low."""

    __tablename__ = "replenishment_signals"

    signal_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), primary_key=True, default=uuid4
    )
    created_ts: Mapped[datetime] = mapped_column(default=_utc_now)
    item_id: Mapped[str] = mapped_column(Text, nullable=False)
    current_qty: Mapped[int] = mapped_column(nullable=False)
    reorder_point: Mapped[int] = mapped_column(default=10)
    reorder_qty: Mapped[int] = mapped_column(default=24)
    trigger_event_id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True), ForeignKey("scan_events.event_id"), nullable=False
    )
    status: Mapped[str] = mapped_column(Text, default="OPEN")

    __table_args__ = (
        CheckConstraint(
            "status IN ('OPEN', 'ACKNOWLEDGED', 'FULFILLED')", name="ck_signal_status"
        ),
        Index("idx_replenishment_signals_item_status", "item_id", "status"),
    )
