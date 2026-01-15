"""Inventory service with business logic for scan events and replenishment."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import structlog

from inventory_demo.api.barcode_parser import parse_barcode
from inventory_demo.config import get_settings
from inventory_demo.core.models import EventType
from inventory_demo.db.postgres import PostgresDB, get_db
from inventory_demo.db.schemas import ReplenishmentSignal, ScanEvent

logger = structlog.get_logger()


class DuplicateScanError(Exception):
    """Raised when a scan is rejected due to debounce."""

    pass


class InventoryService:
    """Business logic for inventory operations."""

    def __init__(self, db: PostgresDB | None = None):
        """Initialize inventory service.

        Args:
            db: Database client. If None, uses global instance.
        """
        self.db = db or get_db()
        self._settings = get_settings().inventory
        # In-memory debounce cache: barcode_raw -> last scan time
        self._last_scans: dict[str, datetime] = {}

    def _check_debounce(self, barcode_raw: str) -> None:
        """Check if barcode was scanned within debounce window.

        Args:
            barcode_raw: The raw barcode string

        Raises:
            DuplicateScanError: If scan is within debounce window
        """
        now = datetime.now(timezone.utc)
        last_scan = self._last_scans.get(barcode_raw)

        if last_scan is not None:
            elapsed = (now - last_scan).total_seconds()
            if elapsed < self._settings.debounce_seconds:
                logger.debug(
                    "scan_debounced",
                    barcode=barcode_raw,
                    elapsed_seconds=elapsed,
                    debounce_seconds=self._settings.debounce_seconds,
                )
                raise DuplicateScanError(
                    f"Duplicate scan rejected. Wait {self._settings.debounce_seconds - elapsed:.1f}s"
                )

        self._last_scans[barcode_raw] = now

        # Clean up old entries (older than 1 minute)
        cutoff = now - timedelta(minutes=1)
        self._last_scans = {k: v for k, v in self._last_scans.items() if v > cutoff}

    def create_intake_event(
        self, station_id: str, barcode_raw: str, user_email: str | None = None
    ) -> tuple[ScanEvent, int]:
        """Create an INTAKE scan event.

        Args:
            station_id: Identifier for the scanning station
            barcode_raw: Raw barcode string
            user_email: Email of the user performing the scan

        Returns:
            Tuple of (created event, new on-hand quantity)

        Raises:
            BarcodeParseError: If barcode format is invalid
            DuplicateScanError: If scan is within debounce window
        """
        # Check debounce
        self._check_debounce(barcode_raw)

        # Parse barcode
        parsed = parse_barcode(barcode_raw)

        # Create event
        event = self.db.create_event(
            event_type=EventType.INTAKE.value,
            station_id=station_id,
            barcode_raw=barcode_raw,
            item_id=parsed.item_id,
            qty=parsed.qty,
            user_email=user_email,
        )

        # Get updated inventory
        on_hand_qty = self.db.get_on_hand_qty(parsed.item_id)

        logger.info(
            "intake_event_created",
            event_id=str(event.event_id),
            item_id=parsed.item_id,
            qty=parsed.qty,
            on_hand_qty=on_hand_qty,
        )

        # Auto-fulfill any OPEN replenishment signals if inventory is above reorder point
        if on_hand_qty > self._settings.reorder_point:
            self.db.fulfill_open_signals(parsed.item_id, event.event_id)

        return event, on_hand_qty

    def create_consume_event(
        self, station_id: str, barcode_raw: str, user_email: str | None = None
    ) -> tuple[ScanEvent, int, ReplenishmentSignal | None]:
        """Create a CONSUME scan event and check for replenishment.

        Args:
            station_id: Identifier for the scanning station
            barcode_raw: Raw barcode string
            user_email: Email of the user performing the scan

        Returns:
            Tuple of (created event, new on-hand quantity, replenishment signal if created)

        Raises:
            BarcodeParseError: If barcode format is invalid
            DuplicateScanError: If scan is within debounce window
        """
        # Check debounce
        self._check_debounce(barcode_raw)

        # Parse barcode
        parsed = parse_barcode(barcode_raw)

        # Create event
        event = self.db.create_event(
            event_type=EventType.CONSUME.value,
            station_id=station_id,
            barcode_raw=barcode_raw,
            item_id=parsed.item_id,
            qty=parsed.qty,
            user_email=user_email,
        )

        # Get updated inventory
        on_hand_qty = self.db.get_on_hand_qty(parsed.item_id)

        logger.info(
            "consume_event_created",
            event_id=str(event.event_id),
            item_id=parsed.item_id,
            qty=parsed.qty,
            on_hand_qty=on_hand_qty,
        )

        # Check if replenishment is needed
        signal = None
        if on_hand_qty <= self._settings.reorder_point:
            signal = self.db.create_signal(
                item_id=parsed.item_id,
                current_qty=on_hand_qty,
                trigger_event_id=event.event_id,
                reorder_point=self._settings.reorder_point,
                reorder_qty=self._settings.reorder_qty,
            )
            if signal:
                logger.info(
                    "replenishment_triggered",
                    item_id=parsed.item_id,
                    on_hand_qty=on_hand_qty,
                    reorder_point=self._settings.reorder_point,
                )

        return event, on_hand_qty, signal


# Global service instance
_service: InventoryService | None = None


def get_service() -> InventoryService:
    """Get the global inventory service instance."""
    global _service
    if _service is None:
        _service = InventoryService()
    return _service
